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
import re
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
from services import preview_store, tag_rule_service
from services.document_service import _generate_doc_no
from services.tag_service import get_or_create_tag

SOURCES_DIR = BASE_DIR / "sources"
QUESTION_TYPES = {"question", "past_question"}
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
def _find_child(
    db: Session, parent_id: Optional[int], name: str
) -> Optional[models.Category]:
    cond = (
        models.Category.parent_id.is_(None)
        if parent_id is None
        else models.Category.parent_id == parent_id
    )
    return db.execute(
        select(models.Category).where(cond, models.Category.name == name)
    ).scalars().first()


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
# 항목별 규격 검증 (§8.3)
# ---------------------------------------------------------------------------
def _validate_item(raw: object) -> Tuple[Optional[dict], List[str]]:
    """반입 문서 1건을 검증. (정규화 dict, errors) 반환. errors 있으면 dict=None."""
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

    answer = raw.get("answer")
    if isinstance(doc_type, str) and doc_type in QUESTION_TYPES:
        if answer is None or (isinstance(answer, str) and not answer.strip()):
            errors.append("문제 타입 문서는 정답('answer')이 필요합니다")

    choices = raw.get("choices")
    if choices is not None:
        if not isinstance(choices, list) or not all(
            isinstance(c, str) for c in choices
        ):
            errors.append("'choices'는 문자열 배열이어야 합니다")

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

    suggest_categories = raw.get("suggest_categories") or []
    if not isinstance(suggest_categories, list) or not all(
        isinstance(s, str) for s in suggest_categories
    ):
        errors.append("'suggest_categories'는 문자열 배열이어야 합니다")
        suggest_categories = []

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
        "content": raw.get("content"),
        "choices": choices,
        "answer": answer.strip() if isinstance(answer, str) else answer,
        "explanation": raw.get("explanation"),
        "difficulty": difficulty,
        "tags": norm_tags,
        "source_detail": raw.get("source_detail"),
        "suggest_categories": [s.strip() for s in suggest_categories if s.strip()],
        "suggest_relations": [s.strip() for s in suggest_relations if s.strip()],
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


def create_preview(
    db: Session,
    *,
    json_bytes: bytes,
    source_filename: Optional[str],
    source_bytes: Optional[bytes],
    preview_id: Optional[str] = None,
    preserve: bool = False,
    recovered: bool = False,
) -> PreviewResponse:
    """반입 JSON → preview 리포트.

    S13(F40-①):
      - `preserve=True`(convert·fetch 잡 경로)면 성공한 반입 JSON을 `import/auto/`에 보존한다.
      - `preview_id` 지정 = 디스크 복구 재생성(같은 preview_id 유지), `recovered=True`는
        "복구된 미리보기 — 중복 판정은 현재 DB 기준" 소표기용 플래그다.
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

    # --- 항목별 검증 + 중복 + 제안 해석 ---
    existing_hashes = _existing_hash_map(db)
    items: List[PreviewItem] = []
    cache_items: List[dict] = []

    for idx, raw in enumerate(envelope.documents):
        norm, errors = _validate_item(raw)
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
            SuggestCategoryResult(path=path, category_id=cid, exists=exists)
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

    if preserve:
        # LLM 비용을 치른 산출물이므로 캐시(TTL 1h)와 별개로 디스크에 남긴다(설계 §4.3).
        preview_store.save(
            preview_id,
            json_bytes,
            source_filename=source_filename,
            source_hash=source_hash,
        )

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
            path = approval.strip()
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

            if decision.action == "new":
                document = _create_document(db, citem["doc"], source_id)
                created += 1
                new_docs.append(
                    NewDocumentRef(
                        id=document.id, doc_no=document.doc_no, title=document.title
                    )
                )
                target_id = document.id
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
                _merge_document(db, target, citem["doc"], source_id)
                merged += 1
                target_id = target.id
            else:
                raise ValidationAppError(
                    f"알 수 없는 action: {decision.action!r}",
                    detail={"index": idx, "action": decision.action},
                )

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
