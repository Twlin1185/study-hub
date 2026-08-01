"""답지·해설지 반입 (S18 — F44 ①, 설계 §4.20).

업로드(판별·추출만 — LLM 0) → LLM 가공 잡(convert 잡 큐 재사용, kind='answer_key') →
서버 결정론 매칭(원문 대조 게이트 포함) 미리보기 → 선택 apply(유일한 병합 쓰기, 빈 필드만
채움 — 덮어쓰기 없음, 멱등)까지 이 모듈이 담당한다. LLM은 "답지→{번호,정답,해설}" 구조화만
하고, 문항↔문서 매칭은 서버가 `source_detail` 말미 번호로 결정론 수행한다(R7·R8 — 조용한
오병합 0).

상태 보존은 인메모리 TTL 1시간(preview 캐시 관례) — `import/auto/` 디스크 보존은 하지 않는다
(원본은 sources/에 있어 자료 무손실).
"""
from __future__ import annotations

import datetime as dt
import json
import re
import threading
import uuid
from collections import defaultdict
from typing import Any, Dict, List, Optional, Sequence, Tuple

from sqlalchemy import select
from sqlalchemy.orm import Session

import models
from exceptions import ConflictError, NotFoundError, ValidationAppError
from schemas.answer_key import (
    AnswerKeyApplyResult,
    AnswerKeyEstimate,
    AnswerKeySkipped,
    AnswerKeyStatus,
    AnswerKeyTarget,
    AnswerKeyUploadResult,
)
from services import convert_service, import_service, source_match, tree_utils

KEY_TTL = dt.timedelta(hours=1)

_KEYS: Dict[str, dict] = {}
_KEYS_LOCK = threading.Lock()


def _purge_expired() -> None:
    now = dt.datetime.now()
    with _KEYS_LOCK:
        stale = [kid for kid, state in _KEYS.items() if now - state["created_at"] > KEY_TTL]
        for kid in stale:
            _KEYS.pop(kid, None)


def _get_key_or_404(key_id: str) -> dict:
    _purge_expired()
    with _KEYS_LOCK:
        state = _KEYS.get(key_id)
    if state is None:
        raise NotFoundError(
            "답지 반입 작업을 찾을 수 없습니다(만료되었을 수 있습니다)", detail={"key_id": key_id}
        )
    return state


# ---------------------------------------------------------------------------
# 대상 문서 집계 (범위 하위 포함 · 문제 타입 · is_active=1)
# ---------------------------------------------------------------------------
def _target_documents(db: Session, category_id: int) -> List[models.Document]:
    cat_ids = tree_utils.collect_descendant_ids(db, category_id)
    if not cat_ids:
        return []
    stmt = (
        select(models.Document)
        .join(models.CategoryDocument, models.CategoryDocument.document_id == models.Document.id)
        .where(
            models.CategoryDocument.category_id.in_(cat_ids),
            models.Document.type.in_(import_service.QUESTION_TYPES),
            models.Document.is_active == 1,
        )
        .distinct()
    )
    return list(db.execute(stmt).scalars().all())


def _compute_target(documents: Sequence[models.Document]) -> dict:
    total = len(documents)
    missing_answer = sum(1 for d in documents if not (d.answer and d.answer.strip()))
    missing_explanation = sum(1 for d in documents if not (d.explanation and d.explanation.strip()))
    return {
        "question_total": total,
        "missing_answer": missing_answer,
        "missing_explanation": missing_explanation,
    }


def _estimate_usage(*, extract_available: bool, extracted_chars: int, byte_size: int) -> dict:
    """`fetch_service.estimate_usage` 필드 관례(`approx_input_tokens`·`assumed`) 재사용 —
    답지는 문항 수가 아니라 답지 자체 텍스트 길이가 LLM 입력이라 별도 산식을 쓴다.
    한국어 혼합 텍스트는 토큰당 문자수가 평균 1.5자 안팎(영문 대비 과소추정 방지 —
    stage-reviewer 지적)이라 `chars // 3`보다 촘촘히 잡는다."""
    if extract_available and extracted_chars > 0:
        return {"approx_input_tokens": max(int(extracted_chars / 1.5), 1), "assumed": False}
    # 추출 불가(스캔 PDF·이미지) — 파일 바이트 크기 기반 대략치(가정치임을 명시).
    return {"approx_input_tokens": max(byte_size // 6, 1), "assumed": True}


# ---------------------------------------------------------------------------
# ① 업로드 — 판별·추출만(LLM 0)
# ---------------------------------------------------------------------------
def upload_answer_key(
    db: Session, *, filename: str, data: bytes, category_id: int
) -> AnswerKeyUploadResult:
    _purge_expired()
    if db.get(models.Category, category_id) is None:
        raise NotFoundError("분류를 찾을 수 없습니다", detail={"category_id": category_id})

    # 원본은 판별 결과와 무관하게 sources/에 저장(§4.3 관례 — 중복 해시는 save_source_file이
    # 처리. 판별 거부·추출 실패로 아래에서 종료해도 이미 저장된 뒤다 — §4.18 대칭).
    import_service.save_source_file(filename, data)

    try:
        detected = convert_service._detect_import_format(filename, data)
    except (
        convert_service.UnsupportedFormatError,
        convert_service.DocParseFailedError,
        convert_service.TooLargeError,
    ) as exc:
        # C군·판별 불가 = §3 에러(422) — §4.18 ⑥ 확정 문구 재사용(동기 에러라 error_info
        # 채널이 아니다).
        raise ValidationAppError(exc.public_message, detail={"action": exc.action}) from exc

    documents = _target_documents(db, category_id)
    target = _compute_target(documents)

    extract_available = detected.text is not None
    extracted_chars = len(detected.text) if detected.text is not None else 0
    estimate = _estimate_usage(
        extract_available=extract_available, extracted_chars=extracted_chars, byte_size=len(data)
    )

    key_id = f"akk_{uuid.uuid4().hex[:8]}"
    with _KEYS_LOCK:
        _KEYS[key_id] = {
            "created_at": dt.datetime.now(),
            "filename": filename,
            "file_type": detected.file_type,
            "category_id": category_id,
            "source_bytes": data,
            "extract_available": extract_available,
            "extracted_chars": extracted_chars,
            "target": target,
            "estimate": estimate,
            "job_id": None,
        }

    return AnswerKeyUploadResult(
        key_id=key_id,
        filename=filename,
        file_type=detected.file_type,
        extract_available=extract_available,
        extracted_chars=extracted_chars,
        target=AnswerKeyTarget(**target),
        estimate=AnswerKeyEstimate(**estimate),
    )


# ---------------------------------------------------------------------------
# ② LLM 가공 잡 시작·조회
# ---------------------------------------------------------------------------
def start_processing(db: Session, key_id: str, *, engine: str = "auto") -> str:
    state = _get_key_or_404(key_id)
    existing_job_id = state.get("job_id")
    if existing_job_id is not None:
        # 같은 key_id로 재호출 시 잡 2개가 큐잉되며 LLM 비용이 중복되는 사고 방지
        # (stage-reviewer 지적). 완료·실패 후 재실행(재가공)은 허용한다.
        try:
            existing_job = convert_service.get_answer_key_job(existing_job_id)
        except NotFoundError:
            existing_job = None
        if existing_job is not None and existing_job["status"] == "running":
            raise ConflictError(
                "이미 답지 가공이 진행 중입니다", detail={"job_id": existing_job_id}
            )
    job_id = convert_service.start_answer_key_job(
        db,
        source_filename=state["filename"],
        source_bytes=state["source_bytes"],
        engine=engine,
    )
    with _KEYS_LOCK:
        current = _KEYS.get(key_id)
        if current is not None:
            current["job_id"] = job_id
    return job_id


def get_status(db: Session, key_id: str) -> AnswerKeyStatus:
    state = _get_key_or_404(key_id)
    base: Dict[str, Any] = {
        "key_id": key_id,
        "filename": state["filename"],
        "file_type": state["file_type"],
        "extract_available": state["extract_available"],
        "extracted_chars": state["extracted_chars"],
        "target": AnswerKeyTarget(**state["target"]),
        "estimate": AnswerKeyEstimate(**state["estimate"]),
    }
    job_id = state.get("job_id")
    if job_id is None:
        return AnswerKeyStatus(
            status="uploaded", error=None, error_info=None, progress=None,
            matched=[], unmatched=None, **base,
        )

    job = convert_service.get_answer_key_job(job_id)
    if job["status"] != "done":
        return AnswerKeyStatus(
            status=job["status"],
            error=job.get("error"),
            error_info=job.get("error_info"),
            progress=job.get("progress"),
            matched=[],
            unmatched=None,
            **base,
        )

    items = job.get("items") or []
    documents = _target_documents(db, state["category_id"])
    matcher = source_match.SourceMatcher(
        source_match.extract_source_text(state["filename"], state["source_bytes"])
    )
    matched, unmatched = match_answer_key(documents, items, matcher)
    return AnswerKeyStatus(
        status="done",
        error=None,
        error_info=None,
        progress=job.get("progress"),
        matched=matched,
        unmatched=unmatched,
        **base,
    )


# ---------------------------------------------------------------------------
# ③ 서버 결정론 매칭 — source_detail 말미 번호 ↔ LLM 산출 items[no]
# ---------------------------------------------------------------------------
_NUMBER_RE = re.compile(r"(\d+)\s*번")

# apply가 병기하는 라벨 접두(`_merge_source_detail`과 공유) — 이 접두로 시작하는 조각은
# 번호 추출 대상에서 제외한다(stage-reviewer 지적: 답지 파일명에 "17번" 등이 들어 있으면
# 다음 반입 때 그 조각이 번호로 오매칭돼 문서가 영구 ambiguous로 빠지는 사고 방지).
_MERGE_LABEL_PREFIX = "정답/해설:"


def extract_numbers_from_source_detail(source_detail: Optional[str]) -> List[int]:
    """`source_detail`(자유 텍스트, `"; "` 병합)을 `';'`로 분할 → 각 조각의 **최말단**
    `(\\d+)\\s*번` 매치 번호 목록(설계 §4.20 ③). 조각마다 매치가 없으면 건너뛴다 —
    번호가 하나도 없으면 빈 목록(부재), 서로 다른 번호가 여럿이면 문서 자체가 모호하다는
    신호(호출부 `match_answer_key`가 판정). `apply`가 병기한 `"정답/해설: {파일명}"` 조각은
    문항 번호 출처가 아니므로 건너뛴다."""
    if not source_detail:
        return []
    numbers: List[int] = []
    for piece in source_detail.split(";"):
        if piece.strip().startswith(_MERGE_LABEL_PREFIX):
            continue
        found = _NUMBER_RE.findall(piece)
        if found:
            numbers.append(int(found[-1]))
    return numbers


def _distinct_numbers(source_detail: Optional[str]) -> List[int]:
    seen: List[int] = []
    for n in extract_numbers_from_source_detail(source_detail):
        if n not in seen:
            seen.append(n)
    return seen


def _unmatched_doc(doc: models.Document, reason: str) -> dict:
    return {"document_id": doc.id, "doc_no": doc.doc_no, "title": doc.title, "reason": reason}


def _build_matched_entry(
    doc: models.Document, no: int, item: dict, matcher: source_match.SourceMatcher
) -> dict:
    current = {
        "has_answer": bool(doc.answer and doc.answer.strip()),
        "has_explanation": bool(doc.explanation and doc.explanation.strip()),
    }
    proposed: Dict[str, str] = {}
    warnings: List[str] = []

    # 추출 불가 답지 = **전 항목** match_unavailable(설계 §4.20 ③ — explanation 유무와
    # 무관하게 대조 자체가 불가능하다는 사실을 매 항목에 알린다. stage-reviewer 지적).
    if not matcher.available:
        warnings.append("match_unavailable")

    explanation_val = item.get("explanation")
    if explanation_val:
        # 기계 검증 — 답지 추출 텍스트 기준 원문 대조(§4.17 ⑥ 알고리즘·임계 그대로).
        if matcher.available and not matcher.matches(explanation_val):
            warnings.append("fabrication_suspect")
        proposed["explanation"] = explanation_val

    answer_val = item.get("answer")
    if answer_val:
        choices = json.loads(doc.choices) if doc.choices else None
        if choices:
            n = len(choices)
            text = answer_val.strip()
            if text.isdigit() and 1 <= int(text) <= n:
                proposed["answer"] = text
            # 범위 밖 숫자·비숫자 = choices 1-base 강제 위반 → 병합 후보에서 제거(§4.20 ③).
        else:
            # 짧아 대조 생략(⑥-ⓐ 규칙) — choices 없는 문서는 그대로 채택.
            proposed["answer"] = answer_val.strip()

    conflicts: List[str] = []
    if current["has_answer"] and "answer" in proposed:
        conflicts.append("answer_exists")
    if current["has_explanation"] and "explanation" in proposed:
        conflicts.append("explanation_exists")

    return {
        "document_id": doc.id,
        "doc_no": doc.doc_no,
        "title": doc.title,
        "no": no,
        "current": current,
        "proposed": proposed,
        "conflicts": conflicts,
        "warnings": warnings,
    }


def match_answer_key(
    documents: Sequence[models.Document],
    items: Sequence[dict],
    matcher: source_match.SourceMatcher,
) -> Tuple[List[dict], dict]:
    """서버 결정론 매칭(설계 §4.20 ③) — LLM은 매칭 판단을 하지 않는다.

    - 문서 후보 번호가 0개 → `no_number`(부재).
    - 문서 후보 번호가 2개 이상(서로 다른 `"; "` 조각에서 다른 번호) → `ambiguous`.
    - 같은 번호가 후보 번호가 정확히 1개인 문서 2개 이상에 걸리면 그 문서들 전부 `ambiguous`.
    - 답지 산출 `items`에 같은 `no`가 2회 이상(중복 산출) → 그 번호 전체 무효(`ambiguous`).
    - 나머지 — 번호에 대응하는 산출 항목이 없으면 `no_item`, 있으면 매칭 성공.
    """
    items_by_no: Dict[int, List[dict]] = defaultdict(list)
    for raw in items:
        no = raw.get("no")
        if isinstance(no, int):
            items_by_no[no].append(raw)
    ambiguous_item_nos = {no for no, group in items_by_no.items() if len(group) > 1}

    doc_candidates: Dict[int, List[int]] = {doc.id: _distinct_numbers(doc.source_detail) for doc in documents}
    no_to_doc_ids: Dict[int, List[int]] = defaultdict(list)
    no_number_doc_ids: set = set()
    intrinsic_ambiguous_doc_ids: set = set()
    for doc in documents:
        nums = doc_candidates[doc.id]
        if not nums:
            no_number_doc_ids.add(doc.id)
        elif len(nums) > 1:
            intrinsic_ambiguous_doc_ids.add(doc.id)
        else:
            no_to_doc_ids[nums[0]].append(doc.id)

    collision_doc_ids: set = set()
    for no, doc_ids in no_to_doc_ids.items():
        if len(doc_ids) > 1:
            collision_doc_ids.update(doc_ids)

    matched: List[dict] = []
    unmatched_documents: List[dict] = []
    matched_nos: set = set()

    for doc in documents:
        if doc.id in no_number_doc_ids:
            unmatched_documents.append(_unmatched_doc(doc, "no_number"))
            continue
        if doc.id in intrinsic_ambiguous_doc_ids or doc.id in collision_doc_ids:
            unmatched_documents.append(_unmatched_doc(doc, "ambiguous"))
            continue
        no = doc_candidates[doc.id][0]
        if no in ambiguous_item_nos:
            unmatched_documents.append(_unmatched_doc(doc, "ambiguous"))
            continue
        if no not in items_by_no:
            unmatched_documents.append(_unmatched_doc(doc, "no_item"))
            continue
        item = items_by_no[no][0]
        matched.append(_build_matched_entry(doc, no, item, matcher))
        matched_nos.add(no)

    unmatched_numbers: List[dict] = []
    for no in items_by_no:
        if no in matched_nos:
            continue
        if no in ambiguous_item_nos or len(no_to_doc_ids.get(no) or []) > 1:
            unmatched_numbers.append({"no": no, "reason": "ambiguous"})
        else:
            unmatched_numbers.append({"no": no, "reason": "no_document"})

    return matched, {"numbers": unmatched_numbers, "documents": unmatched_documents}


# ---------------------------------------------------------------------------
# ④ apply — 선택 document_ids만, 빈 필드만 채움(멱등), source_detail 병기
# ---------------------------------------------------------------------------
def _merge_source_detail(current: Optional[str], filename: str) -> str:
    label = f"{_MERGE_LABEL_PREFIX} {filename}"
    if not current:
        return label
    if label in [p.strip() for p in current.split(";")]:
        return current  # 이미 병기되어 있으면 재추가하지 않는다(멱등).
    return f"{current}; {label}"


def apply_answer_key(db: Session, key_id: str, document_ids: Sequence[int]) -> AnswerKeyApplyResult:
    state = _get_key_or_404(key_id)
    job_id = state.get("job_id")
    if job_id is None:
        raise ConflictError("아직 답지 가공을 시작하지 않았습니다")
    job = convert_service.get_answer_key_job(job_id)
    if job["status"] != "done":
        raise ConflictError("답지 가공이 아직 끝나지 않았습니다", detail={"status": job["status"]})

    items = job.get("items") or []
    documents = _target_documents(db, state["category_id"])
    matcher = source_match.SourceMatcher(
        source_match.extract_source_text(state["filename"], state["source_bytes"])
    )
    matched, _unmatched = match_answer_key(documents, items, matcher)
    matched_by_doc = {m["document_id"]: m for m in matched}
    docs_by_id = {doc.id: doc for doc in documents}

    updated = 0
    skipped: List[dict] = []
    for doc_id in document_ids:
        entry = matched_by_doc.get(doc_id)
        document = docs_by_id.get(doc_id)
        if entry is None or document is None:
            skipped.append({"document_id": doc_id, "reason": "not_matched"})
            continue

        proposed = entry["proposed"]
        changed = False
        # 빈 필드만 채운다 — 기존 값이 있으면 건너뛴다(덮어쓰기 경로 없음, §4.20 ④).
        if "answer" in proposed and not (document.answer and document.answer.strip()):
            document.answer = proposed["answer"]
            changed = True
        if "explanation" in proposed and not (document.explanation and document.explanation.strip()):
            document.explanation = proposed["explanation"]
            changed = True

        if not changed:
            skipped.append({"document_id": doc_id, "reason": "no_blank_field"})
            continue

        document.source_detail = _merge_source_detail(document.source_detail, state["filename"])
        updated += 1

    db.commit()
    return AnswerKeyApplyResult(
        updated=updated, skipped=[AnswerKeySkipped(**s) for s in skipped]
    )
