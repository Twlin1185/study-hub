"""반입(Import) 파이프라인 비즈니스 로직.

흐름:
  preview  — JSON 파싱·항목별 규격 검증 → 중복 감지 → 분류/관계 제안 해석 →
             (원본 파일 있으면 sources/ 저장 + SHA-256로 duplicate_source 판정) →
             리포트 생성 + 서버 메모리 캐시(TTL 1시간)에 보관.
  commit   — 캐시된 preview + 항목별 결정(new/skip/merge)으로 실제 반입.
             문서 생성/병합 · 분류 연결 · 관계 생성 · 태그 · sources 기록을
             **단일 트랜잭션**으로 처리 (불변 규칙 4).

불변 규칙:
  1. sources/ 원본은 저장만 — 수정·삭제하지 않는다 (기존 파일 덮어쓰기 금지).
  3. 스키마는 계획서 §6.2 단일 출처 — 테이블/컬럼 추가 없음.
  4. commit = 트랜잭션 1개 (전부 성공 or 전부 롤백).
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import logging
import re
import unicodedata
import uuid
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from sqlalchemy import func, select
from sqlalchemy.orm import Session

import models
from database import BASE_DIR
from exceptions import ConflictError, NotFoundError, ValidationAppError
from schemas.document import DOCUMENT_TYPES
from schemas.import_schema import (
    CommitRequest,
    CommitResult,
    DuplicateOf,
    ImportEnvelope,
    NewDocumentRef,
    PreviewItem,
    PreviewResponse,
    PreviewSource,
    PreviewSummary,
    SuggestCategoryResult,
    SuggestRelationResult,
)
from services import embed_service, preview_store, source_match, tag_rule_service
from services.document_service import _generate_doc_no
from services.tag_service import get_or_create_tag

_LOGGER = logging.getLogger(__name__)

SOURCES_DIR = BASE_DIR / "sources"
QUESTION_TYPES = {"question", "past_question"}
# §8.2 v1.1 — `content` 필수 대상(개념·문제). flashcard는 앞/뒷면 쌍이라 제외.
CONTENT_REQUIRED_TYPES = {"concept", "question", "past_question"}
# §8.2 v1.1 — 정답 출처. 누락은 직접 업로드에서만 허용(=original 간주).
ANSWER_SOURCES = {"original", "solved"}
PREVIEW_TTL = dt.timedelta(hours=1)

# preview 상태 = 서버 메모리 (TTL 1시간). 프로세스 재시작 시 소실 —
# S13(F40-①)부터 convert·fetch 잡 산출 JSON은 `import/auto/`에 보존되므로,
# 캐시 미스는 404/409가 아니라 **디스크 복구**를 먼저 시도한다(설계 §4.3).
_PREVIEW_CACHE: Dict[str, dict] = {}

# 커밋을 마친 preview_id (프로세스 메모리) — 보존 파일은 커밋 후에도 남으므로,
# 같은 preview를 디스크에서 **복구**해 두 번 커밋하는 사고를 이 기록으로 막는다.
# 설계 §4.3: "커밋 완료된 preview_id는 복구 대상에서 제외하고 409" — 따라서 조회
# (get_preview)·커밋(commit_import) **양쪽 모든 경로**에서 먼저 검사한다. 조회가
# 캐시를 되살리면 커밋의 가드가 무력화되기 때문이다.
# dict를 순서 있는 집합으로 사용(삽입 순서 보장) — 상한 초과 시 오래된 것부터 밀어낸다
# (_PREVIEW_CACHE의 TTL 정리와 같은 취지의 최소 정리. 값은 진단용 커밋 시각).
_COMMITTED_MAX = 500
_COMMITTED: Dict[str, dt.datetime] = {}


def _mark_committed(preview_id: str) -> None:
    _COMMITTED.pop(preview_id, None)  # 재삽입 시 순서를 최신으로
    _COMMITTED[preview_id] = dt.datetime.now()
    while len(_COMMITTED) > _COMMITTED_MAX:
        _COMMITTED.pop(next(iter(_COMMITTED)), None)


def _ensure_not_committed(preview_id: str) -> None:
    """커밋을 마친 preview면 409 (설계 §4.3). 보존 파일은 지우지 않으므로
    `GET /api/import/preview/{id}/json` 내려받기 탈출구는 그대로 살아 있다."""
    if preview_id in _COMMITTED:
        raise ConflictError(
            "이미 반입이 완료된 미리보기입니다. 다시 반입하려면 미리보기를 새로 실행하세요",
            detail={"preview_id": preview_id},
        )


# ---------------------------------------------------------------------------
# 유틸: 정규화 해시 · 파일
# ---------------------------------------------------------------------------
def _normalize_hash(title: Optional[str], content: Optional[str]) -> str:
    """제목+내용을 공백 정규화 + casefold 후 SHA-256 (문서 단위 중복 감지)."""
    combined = f"{title or ''}\n{content or ''}"
    normalized = re.sub(r"\s+", " ", combined).strip().casefold()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _safe_name(name: str) -> str:
    """경로 순회 방지 — 파일명만 남기고 위험 문자 정리."""
    base = Path(name).name  # 디렉터리 성분 제거
    base = base.replace("\\", "_").replace("/", "_").strip()
    return base or "source"


def _file_type(name: str) -> Optional[str]:
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext == "pdf":
        return "pdf"
    if ext in ("md", "markdown"):
        return "md"
    if ext in ("xlsx", "xls"):
        return "xlsx"
    if ext in ("png", "jpg", "jpeg", "gif", "webp", "bmp"):
        return "image"
    return ext or None


def _save_source_file(original_name: str, data: bytes, file_hash: str) -> str:
    """sources/ 에 저장하고 sources.filename에 넣을 상대 파일명을 반환.

    같은 내용(해시)은 같은 파일명으로 수렴하며, 이미 존재하면 덮어쓰지 않는다
    (불변 규칙 1 — 원본 파일 수정 금지)."""
    SOURCES_DIR.mkdir(exist_ok=True)
    saved = f"{file_hash[:12]}_{_safe_name(original_name)}"
    path = SOURCES_DIR / saved
    if not path.exists():
        path.write_bytes(data)
    return saved


def save_source_file(original_name: str, data: bytes) -> str:
    """원본 보존 공개 진입점 (S14) — 반입 미리보기와 무관하게 확보한 원본(큐넷 첨부 전량)을
    같은 규칙(`{해시12}_{안전한이름}`)으로 sources/에 저장한다. 이미 있으면 덮어쓰지
    않는다(원본 불변 — 새 파일만 생성)."""
    return _save_source_file(original_name, data, _sha256_bytes(data))


# ---------------------------------------------------------------------------
# 유틸: 분류 경로 매칭 / 생성
# ---------------------------------------------------------------------------
def _category_name_key(name: str) -> str:
    """B4-S5(설계 §4.11 추기) — 분류명 비교 키: NFC 정규화·strip·대소문자 무시.
    공백·유니코드 결합형·대소문자만 다른 형제 분류가 중복 생성되는 것을 막는다.
    저장은 이 키가 아니라 원문(정규화·strip)을 그대로 쓴다 — 표시 형태는 바꾸지 않는다."""
    return unicodedata.normalize("NFC", name).strip().casefold()


def _find_child(
    db: Session, parent_id: Optional[int], name: str
) -> Optional[models.Category]:
    """B4-S5 — 정확 일치(`==`) 대신 NFC·strip·대소문자 무시 비교(파이썬 쪽에서 수행 —
    SQLite `lower()`는 비ASCII 폴딩을 보장하지 않는다). 같은 부모 아래 자식 수는 적어
    전수 비교 비용이 무시할 만하다."""
    cond = (
        models.Category.parent_id.is_(None)
        if parent_id is None
        else models.Category.parent_id == parent_id
    )
    siblings = db.execute(select(models.Category).where(cond)).scalars().all()
    key = _category_name_key(name)
    for sibling in siblings:
        if _category_name_key(sibling.name) == key:
            return sibling
    return None


def _path_names(path: str) -> List[str]:
    return [seg.strip() for seg in path.split("/") if seg.strip()]


def _resolve_category_path(db: Session, path: str) -> Tuple[Optional[int], bool]:
    """경로 문자열 → (leaf category_id, exists). 전부 존재해야 exists=True."""
    names = _path_names(path)
    if not names:
        return None, False
    parent_id: Optional[int] = None
    node: Optional[models.Category] = None
    for name in names:
        node = _find_child(db, parent_id, name)
        if node is None:
            return None, False
        parent_id = node.id
    return (node.id if node else None), True


def _has_child_categories(db: Session, category_id: int) -> bool:
    """category_id가 다른 분류의 부모(=자식이 있는 컨테이너 노드)인지 여부."""
    return (
        db.execute(
            select(models.Category.id)
            .where(models.Category.parent_id == category_id)
            .limit(1)
        ).scalar_one_or_none()
        is not None
    )


def _create_category_path(db: Session, path: str) -> int:
    """누락 구간 노드를 생성하며 leaf category_id를 반환 (commit 트랜잭션 내부 호출)."""
    names = _path_names(path)
    if not names:
        raise ValidationAppError("빈 분류 경로는 생성할 수 없습니다", detail={"path": path})
    parent_id: Optional[int] = None
    node: Optional[models.Category] = None
    for name in names:
        node = _find_child(db, parent_id, name)
        if node is None:
            max_sort = db.execute(
                select(func.max(models.Category.sort_order)).where(
                    models.Category.parent_id.is_(None)
                    if parent_id is None
                    else models.Category.parent_id == parent_id
                )
            ).scalar()
            node = models.Category(
                parent_id=parent_id,
                name=name,
                sort_order=(max_sort or 0) + 1,
            )
            db.add(node)
            db.flush()
        parent_id = node.id
    assert node is not None
    return node.id


def _link_category(db: Session, category_id: int, document_id: int) -> None:
    """분류-문서 연결 upsert. 이미 있으면 그대로 둔다. 신규는 sort_order를 뒤에 붙여
    반입 순서(인터리브 배치)를 유지한다."""
    existing = db.get(
        models.CategoryDocument,
        {"category_id": category_id, "document_id": document_id},
    )
    if existing is not None:
        return
    max_sort = db.execute(
        select(func.max(models.CategoryDocument.sort_order)).where(
            models.CategoryDocument.category_id == category_id
        )
    ).scalar()
    db.add(
        models.CategoryDocument(
            category_id=category_id,
            document_id=document_id,
            sort_order=(max_sort or 0) + 1,
        )
    )


# ---------------------------------------------------------------------------
# 항목별 규격 검증 (§8.3 — v1.1 강화, 설계 §4.17 ⑤)
# ---------------------------------------------------------------------------
def _normalize_choice_answer(
    answer: str, choices: List[str], *, strict: bool, errors: List[str]
) -> str:
    """객관식 정답을 1-base 보기 번호 문자열로 확정한다(§8.2 v1.1).

    - `"1"`~`"n"` **범위의** 숫자 문자열 = **항상 번호**(보기 텍스트가 숫자여도 번호로 해석).
    - **범위 밖 숫자는 번호가 아니다** — 수치형 보기의 값일 수 있으므로 아래 텍스트 경로로
      내려간다(§8.2 v1.1 / 설계 §4.17 ⑤ — PoC I2의 사례: `choices:["10","20","30"]`,
      `answer:"20"` → `"2"`). 텍스트와도 일치하지 않을 때만 오류.
    - 텍스트: 변환 파이프라인(strict)에서는 오류, 직접 업로드에서는 보기와
      **전체 문자열 일치(트림 후)** 하는 보기가 **정확히 하나**일 때만 번호로 정규화한다.
      일치가 없거나 둘 이상이면 오류(조용한 추측 매칭 금지)."""
    text = answer.strip()
    n = len(choices)
    is_digit = text.isdigit()
    if is_digit:
        value = int(text)
        if 1 <= value <= n:
            return str(value)
        # 범위 밖 = 번호로 해석하지 않는다 → 보기 텍스트 일치 경로로 내려간다.
    if strict:
        errors.append(
            f"객관식 'answer'는 보기 번호(\"1\"~\"{n}\") 범위여야 합니다: {text!r}"
            if is_digit
            else f"객관식 'answer'는 보기 번호 문자열(\"1\"~\"{n}\")만 허용됩니다: {text!r}"
        )
        return text
    matched = [i + 1 for i, choice in enumerate(choices) if choice.strip() == text]
    if len(matched) == 1:
        return str(matched[0])
    if not matched:
        errors.append(
            f"객관식 'answer'는 보기 번호(\"1\"~\"{n}\") 범위여야 합니다: {text!r}"
            if is_digit
            else f"'answer'가 보기 번호도 아니고 보기 문자열과도 일치하지 않습니다: {text!r}"
        )
    else:
        errors.append(f"'answer'와 일치하는 보기가 둘 이상입니다: {text!r}")
    return text


def _normalize_suggest_categories(raw_value: object) -> Tuple[List[str], List[str]]:
    """B4-S7/S1(설계 §4.11 추기) — `suggest_categories` 관대 회수.

    list가 아니거나 원소가 str이 아니어도 항목 전체를 error로 만들지 않는다(§4.17 ⑤
    부분 반입 정신). str 원소만 회수하고(dict면 `path` 키 문자열도 회수), 각 경로는
    사용자 입력과 같은 관대 정규화기(`convert_service.normalize_category_path_lenient` —
    구분자 통일·NFC·5단·60자)를 통과한 것만 채택한다. 형식 자체가 틀렸거나 정규화에
    실패한 원소가 하나라도 있으면 `'category_malformed'`, 최종 채택 경로가 0개면
    `'no_category'`를 반환한다(둘 다 항목 warning — errors 아님)."""
    # 순환 임포트 회피(convert_service가 import_service를 임포트한다) — 지연 임포트.
    from services import convert_service

    warnings: List[str] = []
    malformed = False
    if raw_value is None:
        raw_list: List[object] = []
    elif isinstance(raw_value, list):
        raw_list = raw_value
    else:
        raw_list = []
        malformed = True

    paths: List[str] = []
    for item in raw_list:
        candidate: Optional[str] = None
        if isinstance(item, str):
            candidate = item
        elif isinstance(item, dict) and isinstance(item.get("path"), str):
            candidate = item["path"]
        else:
            malformed = True
            continue
        normalized_path = convert_service.normalize_category_path_lenient(candidate)
        if normalized_path is None:
            malformed = True
            continue
        paths.append(normalized_path)

    if malformed:
        warnings.append("category_malformed")
    if not paths:
        warnings.append("no_category")
    return paths, warnings


def _validate_item(raw: object, *, strict: bool = False) -> Tuple[Optional[dict], List[str]]:
    """반입 문서 1건을 검증. (정규화 dict, errors) 반환. errors 있으면 dict=None.

    `strict=True` = **LLM 변환 파이프라인(convert·fetch) 산출물**에만 적용하는 §8.2 v1.1
    강화 규칙(`content` 필수 · 문제 타입 `answer_source` 필수 · 객관식 `answer`는 보기 번호만).
    `strict=False` = 사용자가 직접 올린 반입 JSON — 하위 호환(§8.2 v1.1 확정 규칙):
    `answer_source` 누락은 `original` 간주, 텍스트 `answer`는 보기와 **전체 일치**할 때만
    서버가 번호로 정규화해 수용한다(불일치는 오류 — 조용한 추측 매칭 금지)."""
    errors: List[str] = []
    if not isinstance(raw, dict):
        return None, ["문서 항목이 객체(JSON object)가 아닙니다"]

    doc_type = raw.get("type")
    if not doc_type or not isinstance(doc_type, str):
        errors.append("필수 필드 'type'이 없습니다")
    elif doc_type not in DOCUMENT_TYPES:
        errors.append(
            f"'type' 값이 올바르지 않습니다: {doc_type!r} (허용: {sorted(DOCUMENT_TYPES)})"
        )

    title = raw.get("title")
    if not title or not isinstance(title, str) or not title.strip():
        errors.append("필수 필드 'title'이 없습니다")

    content = raw.get("content")
    if content is not None and not isinstance(content, str):
        errors.append("'content'는 문자열이어야 합니다")
        content = None
    if (
        strict
        and isinstance(doc_type, str)
        and doc_type in CONTENT_REQUIRED_TYPES
        and not (content or "").strip()
    ):
        # §8.2 v1.1 (PoC E4) — 변환 산출물에서 본문 누락은 항목 오류.
        errors.append("필수 필드 'content'가 없습니다")

    answer = raw.get("answer")
    if isinstance(doc_type, str) and doc_type in QUESTION_TYPES:
        if answer is None or (isinstance(answer, str) and not answer.strip()):
            errors.append("문제 타입 문서는 정답('answer')이 필요합니다")

    # §8.2 v1.1 — `answer_source`(original|solved). 문제 타입은 변환 산출물에서 필수,
    # 직접 업로드는 누락 허용(=original 간주 — 기존 파일 무변경 통과).
    answer_source = raw.get("answer_source")
    if answer_source is not None and (
        not isinstance(answer_source, str) or answer_source not in ANSWER_SOURCES
    ):
        errors.append("'answer_source'는 \"original\" 또는 \"solved\"여야 합니다")
        answer_source = None
    if isinstance(doc_type, str) and doc_type in QUESTION_TYPES and answer_source is None:
        if strict:
            errors.append(
                "문제 타입 문서는 'answer_source'(\"original\" 또는 \"solved\")가 필요합니다"
            )
        else:
            answer_source = "original"

    choices = raw.get("choices")
    if choices is not None:
        if not isinstance(choices, list) or not all(
            isinstance(c, str) for c in choices
        ):
            errors.append("'choices'는 문자열 배열이어야 합니다")
            choices = None

    # §8.2 v1.1 — 객관식 `answer`는 **1-base 보기 번호 문자열만**. "1"~"n" 범위의 숫자
    # 문자열은 항상 번호로 해석한다(수치형 보기의 번호/텍스트 이중 해석 제거 — PoC I2).
    if choices and isinstance(answer, str) and answer.strip():
        answer = _normalize_choice_answer(answer, choices, strict=strict, errors=errors)

    difficulty = raw.get("difficulty")
    if difficulty is not None:
        if not isinstance(difficulty, int) or isinstance(difficulty, bool) or not (
            1 <= difficulty <= 5
        ):
            errors.append("'difficulty'는 1~5 사이의 정수여야 합니다")

    tags = raw.get("tags") or []
    if not isinstance(tags, list) or not all(isinstance(t, str) for t in tags):
        errors.append("'tags'는 문자열 배열이어야 합니다")
        tags = []

    # B4-S7/S1(설계 §4.11 추기) — 형식이 어긋나도 항목 전체를 error로 만들지 않는다
    # (§4.17 ⑤ 부분 반입 정신). 회수 가능한 경로만 관대 정규화기로 채택하고, 문제가
    # 있으면 항목 warning으로 강등한다(errors에는 절대 담지 않는다).
    suggest_categories, category_warnings = _normalize_suggest_categories(
        raw.get("suggest_categories")
    )

    suggest_relations = raw.get("suggest_relations") or []
    if not isinstance(suggest_relations, list) or not all(
        isinstance(s, str) for s in suggest_relations
    ):
        errors.append("'suggest_relations'는 문자열 배열이어야 합니다")
        suggest_relations = []

    if errors:
        return None, errors

    # 태그 정규화 + 중복 제거 (원 순서 유지)
    norm_tags: List[str] = []
    seen = set()
    for t in tags:
        clean = t.strip()
        if clean and clean not in seen:
            seen.add(clean)
            norm_tags.append(clean)

    normalized = {
        "type": doc_type,
        "title": title.strip(),
        "content": content,
        "choices": choices,
        "answer": answer.strip() if isinstance(answer, str) else answer,
        # 반입 게이트 신호 — DB에 저장하지 않는다(설계 §4.17 ⑤, DDL 0건).
        "answer_source": answer_source,
        "explanation": raw.get("explanation"),
        "difficulty": difficulty,
        "tags": norm_tags,
        "source_detail": raw.get("source_detail"),
        "suggest_categories": suggest_categories,
        "suggest_relations": [s.strip() for s in suggest_relations if s.strip()],
        # B4-S7/S1 — 'category_malformed'|'no_category'(내부 전달용, DB 미저장 —
        # create_preview가 PreviewItem.warnings로 옮긴다).
        "_category_warnings": category_warnings,
    }
    return normalized, []


# ---------------------------------------------------------------------------
# preview
# ---------------------------------------------------------------------------
def _existing_hash_map(db: Session) -> Dict[str, Tuple[int, str, str]]:
    rows = db.execute(
        select(
            models.Document.id,
            models.Document.doc_no,
            models.Document.title,
            models.Document.content,
        ).where(models.Document.is_active == 1)
    ).all()
    mapping: Dict[str, Tuple[int, str, str]] = {}
    for row in rows:
        h = _normalize_hash(row.title, row.content)
        mapping.setdefault(h, (row.id, row.doc_no, row.title))
    return mapping


def _purge_expired() -> None:
    now = dt.datetime.now()
    stale = [
        key
        for key, state in _PREVIEW_CACHE.items()
        if now - state["created_at"] > PREVIEW_TTL
    ]
    for key in stale:
        _PREVIEW_CACHE.pop(key, None)


def _item_warnings(
    norm: dict, *, matcher: Optional[source_match.SourceMatcher], gate: bool
) -> List[str]:
    """항목별 변환 신뢰 게이트 경고(설계 §4.17 ⑤·⑥ — `warnings` 필드).

    - `solved_answer`: LLM이 스스로 풀어 채운 정답(`answer_source: "solved"`).
    - `fabrication_suspect`: 지문·보기 중 1건이라도 원본에 없음(창작 의심).
    - `match_unavailable`: 원본 텍스트 추출 불가 → 대조 자체를 못 함(조용한 통과 금지).

    대상은 **문제 타입만**이다 — 개념(concept)은 요약·재구조화가 본질이라 부분 일치가
    성립하지 않는다(설계 §4.17 ⑥, G2 실증). 서버는 경고만 싣고 "기본 반입 제외"는
    프론트가 warnings를 보고 처리한다(설계 §4.17 ⑤ — 이중 구현 금지)."""
    warnings: List[str] = []
    if norm["type"] not in QUESTION_TYPES:
        return warnings
    if norm.get("answer_source") == "solved":
        warnings.append("solved_answer")
    if gate and matcher is not None:
        if not matcher.available:
            warnings.append("match_unavailable")
        else:
            candidates = [norm.get("content"), *(norm.get("choices") or [])]
            if not matcher.all_match(candidates):
                warnings.append("fabrication_suspect")
    return warnings


def create_preview(
    db: Session,
    *,
    json_bytes: bytes,
    source_filename: Optional[str],
    source_bytes: Optional[bytes],
    preview_id: Optional[str] = None,
    preserve: bool = False,
    recovered: bool = False,
    gate: bool = False,
    strict: bool = False,
    source_text: Optional[str] = None,
    warnings_override: Optional[Dict[int, List[str]]] = None,
) -> PreviewResponse:
    """반입 JSON → preview 리포트.

    S13(F40-①):
      - `preserve=True`(convert·fetch 잡 경로)면 성공한 반입 JSON을 `import/auto/`에 보존한다.
      - `preview_id` 지정 = 디스크 복구 재생성(같은 preview_id 유지), `recovered=True`는
        "복구된 미리보기 — 중복 판정은 현재 DB 기준" 소표기용 플래그다.

    S15(F41 — 변환 신뢰 게이트, 설계 §4.17 ⑤·⑥):
      - `gate=True` = 항목별 `warnings` 계산(원문 대조 + `answer_source`). 변환 파이프라인
        산출물(convert·fetch)과 그 보존본 복구 경로에서만 켠다 — 직접 업로드 JSON은 원본이
        서버에 없으므로 비적용(배지 없음).
      - `strict=True` = §8.2 v1.1 강화 검증(변환 파이프라인 산출물 전용 — `_validate_item`).
      - `source_text` = 대조용 원본 텍스트를 호출부가 이미 갖고 있을 때(사이트 반입의 구조화
        텍스트) 전달한다. 없으면 `source_bytes`에서 **잡당 1회** 추출한다(LLM 재호출·파일
        중복 저장 없음).
      - `warnings_override` = 보존본 복구 시 **최초 판정을 그대로 복원**한다(재판정 금지 —
        `import/auto/`의 `preview_warnings` 사이드카가 정본. 원본 파일이 없는 경로에서
        `fabrication_suspect`가 `match_unavailable`로 강등되던 구멍을 막는다).
    """
    _purge_expired()

    # --- JSON 파싱 + 봉투 검증 ---
    try:
        data = json.loads(json_bytes)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ValidationAppError(
            "반입 JSON을 파싱할 수 없습니다", detail={"reason": str(exc)}
        )
    if not isinstance(data, dict):
        raise ValidationAppError("반입 JSON 최상위는 객체여야 합니다")

    envelope = ImportEnvelope(
        format_version=data.get("format_version"),
        source=data.get("source") or {},
        documents=data.get("documents") if isinstance(data.get("documents"), list) else [],
    )
    if envelope.format_version != 1:
        raise ValidationAppError(
            f"지원하지 않는 format_version: {envelope.format_version} (지원: 1)",
            detail={"format_version": envelope.format_version},
        )
    if not isinstance(data.get("documents"), list):
        raise ValidationAppError("'documents'는 배열이어야 합니다")

    # --- 원본 파일 처리 (저장 + 해시 + duplicate_source) ---
    source_state: Optional[dict] = None
    source_hash: Optional[str] = None
    preview_source = PreviewSource(
        filename=source_filename or envelope.source.filename,
        duplicate_source=False,
    )
    if source_bytes is not None and source_filename:
        file_hash = _sha256_bytes(source_bytes)
        source_hash = file_hash
        existing = db.execute(
            select(models.Source).where(models.Source.file_hash == file_hash)
        ).scalars().first()
        if existing is not None:
            preview_source.duplicate_source = True
            source_state = {"mode": "existing", "source_id": existing.id}
        else:
            saved = _save_source_file(source_filename, source_bytes, file_hash)
            source_state = {
                "mode": "pending",
                "filename": saved,
                "file_type": _file_type(source_filename),
                "file_hash": file_hash,
                "note": envelope.source.note,
            }

    # --- 원문 대조기 준비 (설계 §4.17 ⑥ — 원본은 잡당 1회만 정규화) ---
    # 복구(warnings_override)에서도 대조기는 준비한다 — 사이드카에 **키가 없는 항목**
    # (최초에 판정되지 않은 error 항목)이 복구 시 유효 항목으로 살아날 수 있고, 그때는
    # 재계산이 필요하다("키 없음 = 판정 안 됨" — 조용한 통과 금지).
    matcher: Optional[source_match.SourceMatcher] = None
    if gate:
        text = source_text
        if text is None:
            text = source_match.extract_source_text(source_filename, source_bytes)
        matcher = source_match.SourceMatcher(text)

    # --- 항목별 검증 + 중복 + 제안 해석 ---
    existing_hashes = _existing_hash_map(db)
    items: List[PreviewItem] = []
    cache_items: List[dict] = []

    for idx, raw in enumerate(envelope.documents):
        norm, errors = _validate_item(raw, strict=strict)
        raw_title = (
            raw.get("title") if isinstance(raw, dict) and raw.get("title") else None
        )
        raw_type = raw.get("type") if isinstance(raw, dict) else None

        if errors:
            items.append(
                PreviewItem(
                    index=idx,
                    title=str(raw_title) if raw_title else f"(제목 없음 · 항목 {idx})",
                    type=raw_type if isinstance(raw_type, str) else None,
                    status="error",
                    errors=errors,
                )
            )
            cache_items.append({"index": idx, "status": "error"})
            continue

        assert norm is not None
        # 중복 감지
        h = _normalize_hash(norm["title"], norm["content"])
        dup = existing_hashes.get(h)

        # 분류 제안 해석
        sc_results = [
            SuggestCategoryResult(
                path=path,
                category_id=cid,
                exists=exists,
                container=(
                    True
                    if (exists and cid is not None and _has_child_categories(db, cid))
                    else None
                ),
            )
            for path in norm["suggest_categories"]
            for cid, exists in [_resolve_category_path(db, path)]
        ]
        # 관계 제안 해석
        sr_results = []
        for doc_no in norm["suggest_relations"]:
            found_id = db.execute(
                select(models.Document.id).where(models.Document.doc_no == doc_no)
            ).scalar_one_or_none()
            sr_results.append(
                SuggestRelationResult(
                    doc_no=doc_no, document_id=found_id, found=found_id is not None
                )
            )

        status = "duplicate_suspect" if dup else "ok"
        saved_item_warnings = (
            warnings_override.get(idx) if warnings_override is not None else None
        )
        base_warnings = (
            list(saved_item_warnings)
            if saved_item_warnings is not None
            # 사이드카에 **키가 있으면**(빈 배열 포함) 최초 판정이 정본, **키가 없으면**
            # 최초에 판정되지 않은 항목(당시 error)이므로 지금 판정한다.
            else _item_warnings(norm, matcher=matcher, gate=gate)
        )
        # B4-S7/S1(설계 §4.11 추기) — 'category_malformed'|'no_category'는 게이트
        # (gate·warnings_override)와 무관하게 항상 현재 doc 기준으로 얹는다(신뢰 게이트
        # 사이드카가 담당하는 신호가 아니다).
        category_warnings = norm.get("_category_warnings") or []
        item_warnings = base_warnings + [w for w in category_warnings if w not in base_warnings]
        items.append(
            PreviewItem(
                index=idx,
                title=norm["title"],
                type=norm["type"],
                status=status,
                duplicate_of=(
                    DuplicateOf(id=dup[0], doc_no=dup[1], title=dup[2]) if dup else None
                ),
                suggest_categories=sc_results,
                suggest_relations=sr_results,
                errors=[],
                warnings=item_warnings,
                # B3(설계 §4.3 추기) — 검토 단계 본문 열람용 정규화 본문(기본 None).
                content=norm.get("content"),
                choices=norm.get("choices"),
                answer=norm.get("answer"),
                explanation=norm.get("explanation"),
            )
        )
        cache_items.append(
            {
                "index": idx,
                "status": status,
                "doc": norm,
                "duplicate_of": dup[0] if dup else None,
                "suggest_categories": [r.model_dump() for r in sc_results],
                "suggest_relations": [r.model_dump() for r in sr_results],
            }
        )

    summary = PreviewSummary(
        total=len(items),
        ok=sum(1 for i in items if i.status == "ok"),
        duplicate_suspect=sum(1 for i in items if i.status == "duplicate_suspect"),
        error=sum(1 for i in items if i.status == "error"),
        # S15(설계 §4.17 ⑤) — 경고가 1개 이상인 항목 수(기본 0).
        warning=sum(1 for i in items if i.warnings),
    )

    preview_id = preview_id or f"imp_{uuid.uuid4().hex[:8]}"
    response = PreviewResponse(
        preview_id=preview_id,
        source=preview_source,
        summary=summary,
        items=items,
        recovered=recovered,
    )
    _PREVIEW_CACHE[preview_id] = {
        "created_at": dt.datetime.now(),
        "source": source_state,
        "items": cache_items,
        "response": response,
        "recovered": recovered,
    }

    saved_path = None
    if preserve:
        # LLM 비용을 치른 산출물이므로 캐시(TTL 1h)와 별개로 디스크에 남긴다(설계 §4.3).
        # S15: 이때 계산한 신뢰 게이트 경고도 함께 남겨, 복구가 **재판정 없이** 최초
        # 판정을 그대로 복원하게 한다(설계 §4.17 ⑤ — 원본 없는 경로의 강등 방지).
        # **판정된 항목은 경고가 없어도 `[]`로 명시 기록한다** — "키 없음"이 곧 "그때는
        # 판정하지 못한 항목(error)"이라는 뜻이 되어야, 복구 때 살아난 항목이 배지 없이
        # 조용히 통과하지 않는다(S15 검토 3차 지적).
        saved_path = preview_store.save(
            preview_id,
            json_bytes,
            source_filename=source_filename,
            source_hash=source_hash,
            warnings={
                item.index: item.warnings for item in items if item.status != "error"
            },
        )

    # S20(F46, 설계 §4.22 ① — 수집 훅 지점 2) — 신뢰 게이트 탈락(fabrication_suspect)
    # 수집. convert·fetch 잡 경로에서만(gate=True·preserve=True) — 잡 단위 1건, best-effort
    # (수집 실패가 preview 생성 자체를 막지 않는다). 직접 업로드 JSON(gate=False)·복구
    # 재생성(preserve=False)은 대상 아니다.
    if gate and preserve:
        fabrication_indices = [
            item.index for item in items if "fabrication_suspect" in (item.warnings or [])
        ]
        if fabrication_indices:
            try:
                from services import improve_service

                improve_service.collect_gate_case(
                    source_filename=source_filename,
                    source_bytes=source_bytes,
                    item_indices=fabrication_indices,
                    total_items=len(items),
                    preview_ref=saved_path.name if saved_path else None,
                )
            except Exception:  # noqa: BLE001 - 수집 실패가 preview 생성을 막으면 안 된다
                _LOGGER.warning("게이트 실패 사례 수집 중 오류(원 플로우 영향 없음)", exc_info=True)

    return response


# ---------------------------------------------------------------------------
# 복구 (S13 F40-① — 설계 §4.3 "LLM 비용이 증발하지 않게")
# ---------------------------------------------------------------------------
def recover_preview(db: Session, preview_id: str) -> Optional[PreviewResponse]:
    """캐시 미스 시 `import/auto/`의 보존 JSON으로 preview를 재생성한다(같은 preview_id 유지).

    원본 바이트는 보존 파일명의 해시로 `sources/`에서 되읽어 전달하므로 원본 연결·
    `duplicate_source` 판정이 최초와 동일하게 재구성된다. 항목 `index`는 같은 JSON·같은
    순서에서 나오므로 안정하고, `duplicate_of`·`suggest_*`는 **복구 시점 DB 기준**으로
    재계산된다. 보존 파일이 없으면 None(→ 호출부가 404/409).

    **커밋을 마친 preview는 복구하지 않는다**(설계 §4.3) — 호출부가 이미 검사하지만,
    되살아난 캐시가 재커밋 차단을 무력화하는 경로를 여기서도 원천 차단한다."""
    if preview_id in _COMMITTED:
        return None
    path = preview_store.find(preview_id)
    if path is None:
        return None
    try:
        json_bytes = path.read_bytes()
    except OSError:
        return None

    hash12, original_name = preview_store.parse_name(path)
    source_bytes = preview_store.read_source_bytes(hash12)
    # S15: 최초 판정(preview_warnings 사이드카)이 있으면 그것이 정본이다 — 복구는 상태
    # 복원이지 재판정이 아니다. 구버전 보존본(키 없음)은 None → 기존 재계산 동작 유지.
    saved_warnings = preview_store.load_warnings(json_bytes)
    # 원본을 되읽지 못했으면(nosrc이거나 sources/에서 사라짐) 원본 없는 preview로 복구한다
    # — 보존된 변환 결과를 잃는 것보다 낫다(원본 연결만 빠진다).
    source_filename = original_name if source_bytes is not None else None

    try:
        return create_preview(
            db,
            json_bytes=json_bytes,
            source_filename=source_filename,
            source_bytes=source_bytes,
            preview_id=preview_id,
            recovered=True,
            # S15: 보존본은 변환 파이프라인 산출물이므로 **신뢰 게이트를 유지**한다
            # (복구해도 경고 배지가 사라지지 않는다 — 설계 §4.17 ⑤).
            # 단 `strict`(§8.2 v1.1 강화 검증)는 켜지 않는다: 최초 preview에서 이미
            # 통과한 검증을 복구 때 다시 물리면, S15 이전에 만들어진 보존 파일
            # (`answer_source` 없음)이 전 항목 오류로 되살아나 "LLM 비용을 지키는"
            # 복구 계약(F40-①)을 깨뜨린다.
            gate=True,
            # 최초 판정이 정본(있으면 재계산하지 않는다 — 없으면 gate가 재계산).
            warnings_override=saved_warnings,
        )
    except ValidationAppError:
        return None  # 보존 파일이 손상된 경우 — 기존 404/409 안내로 떨어진다


def preserved_json_path(preview_id: str) -> Path:
    """보존된 반입 JSON 파일 경로 (`GET /api/import/preview/{id}/json` — 내려받기)."""
    path = preview_store.find(preview_id)
    if path is None:
        raise NotFoundError(
            "보존된 변환 JSON이 없습니다",
            detail={"preview_id": preview_id},
        )
    return path


def get_preview(db: Session, preview_id: str) -> PreviewResponse:
    """캐시된 미리보기 재조회 (설계 §4.3, S6) — convert 잡 완료 시 `result_preview_id`로
    반입 위저드에 연결하는 용도. S13(F40-①): 캐시 미스면 디스크 복구를 시도하고,
    보존 파일도 없을 때만 404.

    커밋을 마친 preview_id는 **복구 대상에서 제외**하고 409를 낸다(설계 §4.3) — 조회가
    보존본으로 캐시를 되살리면 `commit_import`의 재커밋 차단이 무력화되기 때문이다
    (다른 탭이 커밋 전 상태로 남아 있는 경우가 실제 도달 경로). 내려받기
    (`GET .../json`)는 이 검사를 타지 않으므로 탈출구는 그대로다."""
    _purge_expired()
    _ensure_not_committed(preview_id)
    state = _PREVIEW_CACHE.get(preview_id)
    if state is not None:
        return state["response"]

    recovered = recover_preview(db, preview_id)
    if recovered is not None:
        return recovered

    raise NotFoundError(
        "미리보기를 찾을 수 없습니다(만료되었을 수 있습니다). 다시 미리보기를 실행하세요",
        detail={"preview_id": preview_id},
    )


# ---------------------------------------------------------------------------
# 조각 미리보기 병합 (B2-2 — 설계 §4.3·§4.25 추기)
# ---------------------------------------------------------------------------
def _preview_state_or_404(db: Session, preview_id: str) -> dict:
    """`merge_previews` 전용 내부 조회 — `get_preview`와 같은 캐시 미스 복구 규칙(§4.3)을
    쓰되, `PreviewResponse`가 아니라 정규화 doc을 담은 내부 캐시 dict(state) 자체를
    반환한다(병합은 항목별 `doc`이 필요하다)."""
    _purge_expired()
    _ensure_not_committed(preview_id)
    state = _PREVIEW_CACHE.get(preview_id)
    if state is not None:
        return state
    if recover_preview(db, preview_id) is None:
        raise NotFoundError(
            "미리보기를 찾을 수 없습니다(만료되었을 수 있습니다)",
            detail={"preview_id": preview_id},
        )
    # recover_preview 성공 시 create_preview가 같은 preview_id로 캐시를 다시 채운다.
    return _PREVIEW_CACHE[preview_id]


def merge_previews(db: Session, preview_ids: List[str]) -> PreviewResponse:
    """`POST /api/import/preview/merge`(B2-2, 설계 §4.3·§4.25 추기) — 분할 반입 조각
    preview N개(≥2)의 정규화 문서(`items[i]["doc"]`)를 **주어진 순서로 연결**한 새 preview
    1개를 만든다(항목 재인덱스·경고 승계·보존 O). 원 조각 preview는 삭제하지 않는다
    (TTL 자연 만료).

    각 조각의 error 항목은 애초에 정규화 doc이 없어(이어 붙일 원문 자체가 없음) 병합
    결과에서 빠진다 — 그 오류는 이미 원 조각 preview에서 표면화됐다."""
    if not preview_ids or len(preview_ids) < 2:
        raise ValidationAppError(
            "preview_ids는 2개 이상이어야 합니다", detail={"preview_ids": preview_ids}
        )

    states = [_preview_state_or_404(db, pid) for pid in preview_ids]

    documents: List[dict] = []
    warnings_override: Dict[int, List[str]] = {}
    for state in states:
        response: PreviewResponse = state["response"]
        warnings_by_index = {item.index: item.warnings for item in response.items}
        for citem in state["items"]:
            if citem.get("status") == "error" or "doc" not in citem:
                continue
            # 내부 전용 키(`_`로 시작 — 예: `_category_warnings`)는 재이어붙임 원문에서
            # 제외한다(재검증 시 자체적으로 다시 계산된다).
            doc = {k: v for k, v in citem["doc"].items() if not k.startswith("_")}
            new_index = len(documents)
            documents.append(doc)
            warnings_override[new_index] = list(warnings_by_index.get(citem["index"]) or [])

    if not documents:
        raise ValidationAppError("병합할 유효한 문서가 없습니다(모든 조각이 오류 항목뿐입니다)")

    first_filename = states[0]["response"].source.filename or "분할 병합 원본"
    merged_json = json.dumps(
        {"format_version": 1, "source": {}, "documents": documents}, ensure_ascii=False
    ).encode("utf-8")

    return create_preview(
        db,
        json_bytes=merged_json,
        source_filename=f"{first_filename} (분할 병합 {len(states)}조각)",
        source_bytes=None,
        preserve=True,
        warnings_override=warnings_override,
    )


# ---------------------------------------------------------------------------
# commit
# ---------------------------------------------------------------------------
def _create_document(db: Session, doc: dict, source_id: Optional[int]) -> models.Document:
    document = models.Document(
        doc_no=_generate_doc_no(db),
        type=doc["type"],
        title=doc["title"],
        content=doc["content"],
        choices=(
            json.dumps(doc["choices"], ensure_ascii=False)
            if doc["choices"] is not None
            else None
        ),
        answer=doc["answer"],
        explanation=doc["explanation"],
        difficulty=doc["difficulty"],
        source_id=source_id,
        source_detail=doc["source_detail"],
    )
    db.add(document)
    db.flush()  # doc_no 채번이 다음 항목에 보이도록 + id 확보

    for tag_name in doc["tags"]:
        tag = get_or_create_tag(db, tag_name)
        exists = db.get(
            models.DocumentTag, {"document_id": document.id, "tag_id": tag.id}
        )
        if exists is None:
            db.add(models.DocumentTag(document_id=document.id, tag_id=tag.id))
    db.flush()
    return document


def _merge_document(
    db: Session, target: models.Document, doc: dict, source_id: Optional[int]
) -> None:
    """기존 문서에 태그·source_detail·source 링크만 병합. 본문(content/answer/
    explanation/choices)은 불변 (설계 §4.3, 불변 규칙)."""
    existing_tag_ids = set(
        db.execute(
            select(models.DocumentTag.tag_id).where(
                models.DocumentTag.document_id == target.id
            )
        ).scalars().all()
    )
    for tag_name in doc["tags"]:
        tag = get_or_create_tag(db, tag_name)
        if tag.id not in existing_tag_ids:
            db.add(models.DocumentTag(document_id=target.id, tag_id=tag.id))
            existing_tag_ids.add(tag.id)

    new_detail = doc.get("source_detail")
    if new_detail:
        if not target.source_detail:
            target.source_detail = new_detail
        elif new_detail not in target.source_detail:
            target.source_detail = f"{target.source_detail}; {new_detail}"

    if source_id is not None and target.source_id is None:
        target.source_id = source_id


def _apply_categories(
    db: Session,
    document_id: int,
    approvals: List,
    suggestions: List[dict],
) -> List[str]:
    """승인된 분류 제안을 연결. 미존재 경로(str 승인)는 노드 생성 후 연결.
    새로 생성된 경로 목록을 반환."""
    created_paths: List[str] = []

    for approval in approvals:
        if isinstance(approval, bool):
            continue  # JSON bool 방어 (bool은 int의 하위형)
        if isinstance(approval, int):
            category = db.get(models.Category, approval)
            if category is None:
                raise NotFoundError(
                    "승인한 분류를 찾을 수 없습니다",
                    detail={"category_id": approval},
                )
            _link_category(db, approval, document_id)
        elif isinstance(approval, str):
            # B4-S4/S6(설계 §4.11 추기) — 커밋 시점에도 관대 정규화기를 한 번 더 통과시킨다
            # (LLM 제안 경로가 그대로 승인됐을 수 있는 경로 — `>`·`\` 등 구분자 이형이나
            # 5단·60자 위반이 남아 있으면 조용히 건너뛴다. 커밋 트랜잭션 전체를 막지 않는다).
            from services import convert_service

            path = convert_service.normalize_category_path_lenient(approval)
            if not path:
                continue
            existed_id, existed = _resolve_category_path(db, path)
            if existed and existed_id is not None:
                _link_category(db, existed_id, document_id)
            else:
                leaf_id = _create_category_path(db, path)
                created_paths.append(path)
                _link_category(db, leaf_id, document_id)
    return created_paths


def _create_relation(db: Session, concept_doc_id: int, target_doc_id: int) -> bool:
    """관계 생성: from=참조된 기존 문서(개념), to=반입 대상 문서. relation='explains',
    created_by='import' (계획서 §6.2 주석 · §8.3)."""
    if concept_doc_id == target_doc_id:
        return False
    concept = db.get(models.Document, concept_doc_id)
    if concept is None:
        return False  # found:false 였거나 사라진 참조 — 조용히 무시
    existing = db.get(
        models.DocumentRelation,
        {
            "from_document_id": concept_doc_id,
            "to_document_id": target_doc_id,
            "relation": "explains",
        },
    )
    if existing is not None:
        return False
    db.add(
        models.DocumentRelation(
            from_document_id=concept_doc_id,
            to_document_id=target_doc_id,
            relation="explains",
            created_by="import",
        )
    )
    return True


def commit_import(db: Session, req: CommitRequest) -> CommitResult:
    _purge_expired()
    # 재커밋 차단은 **모든 경로 앞**에 둔다 — 캐시 미스 분기 안에만 두면, 그 사이의
    # `GET /api/import/preview/{id}` 한 번이 보존본으로 캐시를 되살려(=캐시 히트)
    # 가드를 통째로 건너뛰게 만든다(S13 검토 결함).
    _ensure_not_committed(req.preview_id)
    state = _PREVIEW_CACHE.get(req.preview_id)
    if state is None or dt.datetime.now() - state["created_at"] > PREVIEW_TTL:
        # S13(F40-①): 만료·재시작이면 디스크 보존본으로 **1회 복구**를 시도한 뒤 진행한다
        # (프론트 재조회 불요). 항목 index는 같은 JSON·같은 순서라 결정과 어긋나지 않고,
        # 중복 판정은 현재 DB 기준으로 재계산된다. 복구조차 실패하면 기존 409 안내 유지.
        _PREVIEW_CACHE.pop(req.preview_id, None)
        if recover_preview(db, req.preview_id) is None:
            raise ConflictError(
                "미리보기가 만료되었거나 존재하지 않습니다. 다시 미리보기를 실행하세요",
                detail={"preview_id": req.preview_id},
            )
        state = _PREVIEW_CACHE[req.preview_id]

    was_recovered = bool(state.get("recovered"))

    decisions_by_index = {d.index: d for d in req.decisions}
    cache_by_index = {c["index"]: c for c in state["items"]}

    created = 0
    merged = 0
    skipped = 0
    new_docs: List[NewDocumentRef] = []
    categories_created: List[str] = []
    relations_created = 0

    try:
        # --- 원본 sources 기록 (트랜잭션 내부) ---
        source_id: Optional[int] = None
        src = state.get("source")
        if src is not None:
            if src["mode"] == "existing":
                source_id = src["source_id"]
            elif src["mode"] == "pending":
                source = models.Source(
                    filename=src["filename"],
                    file_type=src.get("file_type"),
                    file_hash=src.get("file_hash"),
                    note=src.get("note"),
                )
                db.add(source)
                db.flush()
                source_id = source.id

        for idx, citem in cache_by_index.items():
            decision = decisions_by_index.get(idx)

            # 오류 항목은 결정과 무관하게 자동 제외 (부분 반입 — DoD 5)
            if citem["status"] == "error":
                skipped += 1
                continue
            if decision is None or decision.action == "skip":
                skipped += 1
                continue

            # B3(설계 §4.3 추기) — 검토 단계 편집분(override)을 정규화 doc에 얕은
            # 덮어쓰기한다(원본 citem["doc"]은 그대로 두고 사본에만 적용 — 같은 preview를
            # 다시 조회할 때 편집 전 상태가 보이게). merge에서는 `_merge_document`가
            # content/answer/explanation을 애초에 쓰지 않으므로(본문 불변 — 위 주석) title
            # 덮어쓰기도 영향이 없다(merge는 target.title을 바꾸지 않는다).
            doc = citem["doc"]
            if decision.override is not None:
                doc = dict(doc)
                override = decision.override
                if override.title is not None:
                    if not override.title.strip():
                        raise ValidationAppError(
                            "제목은 비울 수 없습니다", detail={"index": idx}
                        )
                    doc["title"] = override.title.strip()
                if override.content is not None:
                    doc["content"] = override.content
                if override.answer is not None:
                    doc["answer"] = override.answer
                if override.explanation is not None:
                    doc["explanation"] = override.explanation

            if decision.action == "new":
                document = _create_document(db, doc, source_id)
                created += 1
                new_docs.append(
                    NewDocumentRef(
                        id=document.id, doc_no=document.doc_no, title=document.title
                    )
                )
                target_id = document.id
                target_document = document
            elif decision.action == "merge":
                merge_into = decision.merge_into or citem.get("duplicate_of")
                if merge_into is None:
                    raise ValidationAppError(
                        "merge 대상(merge_into)이 지정되지 않았습니다",
                        detail={"index": idx},
                    )
                target = db.get(models.Document, merge_into)
                if target is None:
                    raise NotFoundError(
                        "병합 대상 문서를 찾을 수 없습니다",
                        detail={"merge_into": merge_into},
                    )
                _merge_document(db, target, doc, source_id)
                merged += 1
                target_id = target.id
                target_document = target
            else:
                raise ValidationAppError(
                    f"알 수 없는 action: {decision.action!r}",
                    detail={"index": idx, "action": decision.action},
                )

            # embeds 인덱스 동기화(§4.19 ⑥) — 커밋으로 생성·병합된 문서 전부, commit_import와
            # 같은 트랜잭션(트랜잭션 전체는 아래 db.commit()에서 한 번에 확정된다).
            embed_service.sync_embeds_for_document(db, target_document)

            categories_created.extend(
                _apply_categories(
                    db,
                    target_id,
                    decision.approve_categories,
                    citem.get("suggest_categories", []),
                )
            )
            for rel_doc_id in decision.approve_relations:
                if _create_relation(db, rel_doc_id, target_id):
                    relations_created += 1

            # 트리거 1: 반입 커밋 시 — 새로 생성·병합된 문서를 태그 자동 분류 규칙으로 스캔
            # (설계 §4.9, 계획서 §11). commit_import 트랜잭션 안에서 함께 처리한다.
            tag_rule_service.scan_document(db, target_id)

        db.commit()
    except Exception:
        db.rollback()
        raise

    # 성공 시 캐시 소거 (재커밋 방지) + 커밋 이력 기억(디스크 복구로 되살아나지 않도록)
    _PREVIEW_CACHE.pop(req.preview_id, None)
    _mark_committed(req.preview_id)

    return CommitResult(
        created=created,
        merged=merged,
        skipped=skipped,
        new_documents=new_docs,
        categories_created=sorted(set(categories_created)),
        relations_created=relations_created,
        recovered=was_recovered,
    )
