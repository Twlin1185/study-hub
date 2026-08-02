"""응용 모의고사 — 범위 기반 LLM 응용 문항 생성·응시 (S19 — F45, 설계 §4.21).

생성 파이프라인: prepare(LLM 0, 범위 수집·견적) → generate(잡 kind='applied_exam',
convert 잡 큐 재사용 — 동시 1개) → 검증 게이트 → **잡 말미 한 트랜잭션 저장**. 이 기능은
사전 미리보기 승인이 원리상 불가능하다(시험 문제를 미리 보면 무의미, R7 최종 방어선
사용 불가) — 그래서 다른 LLM 잡(반입·재생성·답지·풀이)과 달리 **별도 apply 승인
엔드포인트가 없다**. 대신 쓰기 목적지를 예약 루트 분류("AI 응용 모의고사") 아래 런
분류로 한정해(격리 저장) 문서고 본류·SRS·통계를 오염시키지 않는다(R22).

응시 구성은 기존 `POST /api/exam/session`을 그대로 재사용한다(신규 세션 API 없음).
제출(`submit_applied_exam`)은 채점 코어(`attempt_service.grade_and_record`)를
`exam_service.submit_exam`과 공유하되(채점 규칙 이원화 금지), mode='applied_exam' 기록·
applied 루트 서브트리 검증·리포트 `basis[]`가 다르므로 별도 함수로 둔다(F25 계약
`exam_service.py`·`schemas/exam.py`는 손대지 않는다 — "F25 계약 변경 금지").
"""
from __future__ import annotations

import datetime as dt
import json
import threading
import uuid
from collections import defaultdict
from typing import Dict, List, Optional, Sequence, Tuple

from sqlalchemy import select
from sqlalchemy.orm import Session

import models
from database import SessionLocal
from exceptions import ConflictError, NotFoundError, ValidationAppError
from schemas.applied_exam import (
    AppliedExamBasisRef,
    AppliedExamDiscarded,
    AppliedExamEstimate,
    AppliedExamHistoryItem,
    AppliedExamPrepareRequest,
    AppliedExamPrepareResult,
    AppliedExamResult,
    AppliedExamResultItem,
    AppliedExamSourceCounts,
    AppliedExamStatus,
    AppliedExamSubmitReport,
)
from schemas.exam import ExamCut, ExamHistorySubject, ExamSubjectReport, ExamSubmitRequest, ExamTotal
from services import attempt_service, category_service, exam_scoring, llm_engine_service, settings_service, srs_service
from services import source_match, tree_utils
from services.document_service import _generate_doc_no

# ---------------------------------------------------------------------------
# 상수 (설계 §4.21 결정 ⑥ — 생성 규약 1)
# ---------------------------------------------------------------------------
MAX_COUNT = 20
MAX_CONTEXT_CHARS = 200_000
COLLECT_TYPES = ("past_question", "question", "concept")

GEN_TTL = dt.timedelta(hours=1)

ROOT_CATEGORY_NAME = "AI 응용 모의고사"
ROOT_CATEGORY_SETTING_KEY = "applied_exam.root_category_id"
MARKER_PREFIX = "[AI 생성 문항]"

DISCARD_INVALID_ITEM = "invalid_item"
DISCARD_INVALID_ANSWER = "invalid_answer"
DISCARD_MISSING_EXPLANATION = "missing_explanation"
DISCARD_BAD_BASIS = "bad_basis"
DISCARD_DUPLICATE = "duplicate_of_source"

# 폐기 사유 코드 → 한국어 라벨(검토 지적 ④ — 통과 0건 실패 메시지 합성용. §4.11 원문
# 미노출 원칙 — LLM 원문이 아니라 서버가 분류한 사유 코드만 사람 말로 번역한다).
_DISCARD_LABELS: Dict[str, str] = {
    DISCARD_INVALID_ITEM: "문항 형식 오류",
    DISCARD_INVALID_ANSWER: "정답 형식 위반",
    DISCARD_MISSING_EXPLANATION: "해설 누락",
    DISCARD_BAD_BASIS: "근거 불일치",
    DISCARD_DUPLICATE: "기출 복제 의심",
}


def _format_discard_summary(discard_counts: Dict[str, int]) -> str:
    """`{"bad_basis": 3, "invalid_answer": 2}` → "근거 불일치 3건·정답 형식 위반 2건"
    (원문 미노출 — 사유 코드를 한국어 라벨로 번역, §4.11 원칙)."""
    parts = [
        f"{_DISCARD_LABELS.get(reason, reason)} {count}건" for reason, count in discard_counts.items()
    ]
    return "·".join(parts)

_GENS: Dict[str, dict] = {}
_GENS_LOCK = threading.Lock()


# ---------------------------------------------------------------------------
# gen 상태 (인메모리 TTL 1시간 — prepare 캐시 관례, answer_key_service._KEYS 전례)
# ---------------------------------------------------------------------------
def _purge_expired() -> None:
    now = dt.datetime.now()
    with _GENS_LOCK:
        stale = [gid for gid, state in _GENS.items() if now - state["created_at"] > GEN_TTL]
        for gid in stale:
            _GENS.pop(gid, None)


def _get_gen_or_404(gen_id: str) -> dict:
    _purge_expired()
    with _GENS_LOCK:
        state = _GENS.get(gen_id)
    if state is None:
        raise NotFoundError(
            "응용 모의고사 생성 작업을 찾을 수 없습니다(만료되었을 수 있습니다)",
            detail={"gen_id": gen_id},
        )
    return state


# ---------------------------------------------------------------------------
# ① prepare — 범위 수집·견적만(LLM 0)
# ---------------------------------------------------------------------------
def _scope_label(db: Session, categories: Sequence[models.Category]) -> str:
    if len(categories) == 1:
        return tree_utils.category_path(db, categories[0].id)
    # 여러 범위를 동시에 고른 경우 — exam_service._exam_label의 "공통 조상 없음" 폴백과
    # 같은 방식으로 이름을 이어붙인다(공통 부모 파생은 F25 전용 개념이라 여기선 단순화).
    return " · ".join(cat.name for cat in categories)


def _collect_basis_documents(db: Session, category_ids: Sequence[int]) -> List[models.Document]:
    all_ids: set = set()
    for cid in category_ids:
        all_ids.update(tree_utils.collect_descendant_ids(db, cid))
    # 자기참조 증폭 차단(검토 지적 ① — R22 최상위) — 사용자가 지정한 범위에 예약 루트
    # ("AI 응용 모의고사") 서브트리가 섞여 있어도(직접 선택하거나 상위 노드 선택으로
    # 우연히 포함되는 경우 모두) 서버가 결정론으로 차집합 제거한다. AI 생성 문항이 다음
    # 생성의 근거가 되면 오류가 세대를 거치며 증폭될 수 있다(설계 §5.12 "실전 트리에서
    # 고른다" 문언 정합 — 실전/응용 교차 제출을 막는 submit 검증(applied_subtree_ids)과
    # 대칭). 범위 전체가 applied 서브트리였다면 이후 "생성 근거가 될 문서가 없습니다"
    # 422로 자연 귀결된다.
    all_ids -= applied_subtree_ids(db)
    if not all_ids:
        return []
    stmt = (
        select(models.Document)
        .join(models.CategoryDocument, models.CategoryDocument.document_id == models.Document.id)
        .where(
            models.CategoryDocument.category_id.in_(all_ids),
            models.Document.type.in_(COLLECT_TYPES),
            models.Document.is_active == 1,
        )
        .distinct()
    )
    return list(db.execute(stmt).scalars().all())


def _estimate_usage(total_chars: int) -> dict:
    """`answer_key_service._estimate_usage`와 같은 chars/1.5 보정(설계 §4.21 결정 ⑥) —
    DB 본문은 항상 텍스트로 존재하므로 `assumed`는 항상 False(추출 불가 분기가 없다)."""
    return {"approx_input_tokens": max(int(total_chars / 1.5), 1), "assumed": False}


def prepare(db: Session, payload: AppliedExamPrepareRequest) -> AppliedExamPrepareResult:
    _purge_expired()
    if not (1 <= payload.count <= MAX_COUNT):
        raise ValidationAppError(
            f"문항 수는 1~{MAX_COUNT}개 사이여야 합니다(1회 실행 상한 — 더 필요하면 분할 실행하세요)",
            detail={"count": payload.count, "max": MAX_COUNT},
        )

    categories = [category_service.get_category_or_404(db, cid) for cid in payload.category_ids]

    documents = _collect_basis_documents(db, payload.category_ids)
    counts = {"past_question": 0, "question": 0, "concept": 0}
    for doc in documents:
        counts[doc.type] = counts.get(doc.type, 0) + 1
    total_source = sum(counts.values())
    if total_source == 0:
        raise ValidationAppError(
            "생성 근거가 될 문서가 없습니다", detail={"category_ids": payload.category_ids}
        )

    total_chars = sum(len(doc.content or "") for doc in documents)
    if total_chars > MAX_CONTEXT_CHARS:
        raise ValidationAppError(
            "선택한 범위가 너무 커 처리할 수 없습니다. 범위를 좁혀 주세요",
            detail={"chars": total_chars, "limit": MAX_CONTEXT_CHARS},
        )

    scope_label = _scope_label(db, categories)
    estimate = _estimate_usage(total_chars)
    basis_docs = [
        {
            "id": doc.id,
            "doc_no": doc.doc_no,
            "type": doc.type,
            "title": doc.title,
            "content": doc.content or "",
            "choices": json.loads(doc.choices) if doc.choices else None,
            "answer": doc.answer,
        }
        for doc in documents
    ]

    gen_id = f"age_{uuid.uuid4().hex[:8]}"
    with _GENS_LOCK:
        _GENS[gen_id] = {
            "created_at": dt.datetime.now(),
            "category_ids": list(payload.category_ids),
            "scope_label": scope_label,
            "requested_count": payload.count,
            "basis_docs": basis_docs,
            "source_counts": counts,
            "estimate": estimate,
            "job_id": None,
        }

    return AppliedExamPrepareResult(
        gen_id=gen_id,
        scope_label=scope_label,
        source_counts=AppliedExamSourceCounts(**counts),
        requested_count=payload.count,
        estimate=AppliedExamEstimate(**estimate),
    )


# ---------------------------------------------------------------------------
# ② generate — 잡 시작·상태 조회 (convert 잡 큐 재사용, kind='applied_exam')
# ---------------------------------------------------------------------------
def start_generation(db: Session, gen_id: str, *, engine: str = "auto") -> str:
    from services import convert_service  # 지연 import — convert_service가 이 모듈을 되부르는
    # 순환(마무리 단계 finalize_generation)을 피한다.

    state = _get_gen_or_404(gen_id)
    existing_job_id = state.get("job_id")
    if existing_job_id is not None:
        try:
            existing_job = convert_service.get_applied_exam_job(gen_id, existing_job_id)
        except NotFoundError:
            existing_job = None
        if existing_job is not None and existing_job["status"] == "running":
            raise ConflictError("이미 생성이 진행 중입니다", detail={"job_id": existing_job_id})

    job_id = convert_service.start_applied_exam_job(
        db,
        gen_id=gen_id,
        scope_label=state["scope_label"],
        requested_count=state["requested_count"],
        basis_docs=state["basis_docs"],
        engine=engine,
    )
    with _GENS_LOCK:
        current = _GENS.get(gen_id)
        if current is not None:
            current["job_id"] = job_id
    return job_id


def get_status(gen_id: str) -> AppliedExamStatus:
    from services import convert_service

    state = _get_gen_or_404(gen_id)
    job_id = state.get("job_id")
    if job_id is None:
        return AppliedExamStatus(gen_id=gen_id, status="prepared")

    job = convert_service.get_applied_exam_job(gen_id, job_id)
    result_out: Optional[AppliedExamResult] = None
    raw_result = job.get("result")
    if job["status"] == "done" and raw_result:
        result_out = AppliedExamResult(
            run_category_id=raw_result["run_category_id"],
            requested=raw_result["requested"],
            generated=raw_result["generated"],
            discarded=[AppliedExamDiscarded(**d) for d in raw_result.get("discarded", [])],
            document_ids=raw_result.get("document_ids", []),
        )
    return AppliedExamStatus(
        gen_id=gen_id,
        status=job["status"],
        error=job.get("error"),
        progress=job.get("progress"),
        error_info=job.get("error_info"),
        result=result_out,
    )


# ---------------------------------------------------------------------------
# ③ 검증 게이트 (설계 §4.21 생성 규약 3 — 단위 테스트 대상, DB·잡 상태 비의존 순수 함수)
# ---------------------------------------------------------------------------
def validate_items(
    items: Sequence[dict],
    basis_by_doc_no: Dict[str, dict],
    matcher: "source_match.SourceMatcher",
) -> Tuple[List[dict], Dict[str, int]]:
    """문항 단위 기계 검증. 통과 문항 목록 + 사유별 폐기 건수를 돌려준다.

    ⓐ content·choices(정확히 4개)·explanation 필수 — 부분 위반은 `invalid_item`,
       explanation만 없으면 `missing_explanation`(설계가 별도 사유로 구분).
    ⓑ answer는 1~4 범위의 1-base 번호 문자열만 허용 — 위반 = **문항 전체 폐기**
       (`invalid_answer`, F44 "answer만 제거" 해석은 여기 부적용 — 정답 없는 생성 문항은
       채점 불가라 응시에 쓸 수 없다).
    ⓒ basis의 각 doc_no가 prepare 수집 집합에 실재해야 한다(부재·범위 밖 = `bad_basis`,
       LLM의 매칭 판단을 신뢰하지 않는다 — F44 결정 ② 관례).
    ⓓ 복제 검출 — `content`가 근거 corpus에 커버리지 ≥0.6로 실재하면 `duplicate_of_source`
       (`SourceMatcher.matches` 재사용 — §4.17 ⑥ 역적용). corpus가 너무 짧아 "대조 불가"
       상태(`matcher.available=False`)면 판정을 생략한다(오탐으로 전량 폐기되는 사고 방지).
       **반전 가드**: `SourceMatcher.matches()`는 정규화 길이가 `MIN_CANDIDATE_CHARS`(10)
       미만이면 원 용도(반입 대조 — 상투구 오탐 방지)에서 무조건 True(통과)를 돌려준다.
       이 역적용(생성 — True=복제 폐기)에서 그대로 쓰면 10자 미만의 짧은 생성 지문이
       전부 오폐기되므로, 같은 임계값 미만이면 복제 판정 자체를 건너뛴다(검토 지적 ②
       — `source_match`의 정규화 함수·상수를 그대로 재사용, 중복 구현 금지).
    """
    passed: List[dict] = []
    discard_counts: Dict[str, int] = defaultdict(int)

    for raw in items:
        content = raw.get("content")
        choices = raw.get("choices")
        explanation = raw.get("explanation")
        answer = raw.get("answer")
        basis = raw.get("basis")

        if not isinstance(content, str) or not content.strip():
            discard_counts[DISCARD_INVALID_ITEM] += 1
            continue
        if (
            not isinstance(choices, list)
            or len(choices) != 4
            or not all(isinstance(c, str) and c.strip() for c in choices)
        ):
            discard_counts[DISCARD_INVALID_ITEM] += 1
            continue
        if not isinstance(explanation, str) or not explanation.strip():
            discard_counts[DISCARD_MISSING_EXPLANATION] += 1
            continue
        if not isinstance(answer, str) or answer.strip() not in {"1", "2", "3", "4"}:
            discard_counts[DISCARD_INVALID_ANSWER] += 1
            continue
        if (
            not isinstance(basis, list)
            or not basis
            or any(not isinstance(b, str) or b not in basis_by_doc_no for b in basis)
        ):
            # basis 원소가 문자열이 아니면(예: LLM이 {"doc_no": "..."} 객체로 응답) `in`
            # 판정 전에 타입부터 걸러 TypeError(unhashable dict)를 막는다 — 검토 지적:
            # 여기서 죽으면 validate_items 자체가 예외로 끝나 잡 전체가 실패하고 통과
            # 가능했던 다른 문항까지 전량 손실된다(설계 §4.21 생성 규약 3-ⓒ는 "해당
            # 문항만 bad_basis 폐기"가 의도).
            discard_counts[DISCARD_BAD_BASIS] += 1
            continue
        if (
            matcher.available
            and len(source_match.normalize(content)) >= source_match.MIN_CANDIDATE_CHARS
            and matcher.matches(content)
        ):
            discard_counts[DISCARD_DUPLICATE] += 1
            continue

        passed.append(
            {
                "content": content.strip(),
                "choices": [c.strip() for c in choices],
                "answer": answer.strip(),
                "explanation": explanation.strip(),
                "basis": list(basis),
            }
        )

    return passed, dict(discard_counts)


# ---------------------------------------------------------------------------
# ④ 저장(잡 말미 한 트랜잭션) — 마커 부착 + 격리 분류 연결 + 근거 relations
# ---------------------------------------------------------------------------
def _build_question_marker(engine: str) -> str:
    """마커 라인(F44 결정 ③ 상속, 설계 §4.21 결정 ③) — 날짜·엔진 label은 서버가 채운다."""
    label = llm_engine_service.ENGINE_REGISTRY.get(engine, {}).get("label", engine)
    today = dt.date.today().isoformat()
    return (
        f"> {MARKER_PREFIX} {today} · {label} — 기출 원본이 아닌 LLM 응용 생성 문항입니다. "
        "오류가 보이면 오류 신고로 재생성하세요."
    )


def _derive_title(content: str, index: int) -> str:
    """생성 JSON에 title 필드가 없다(고정 스키마 — 설계 §4.21 생성 규약 2) — content 첫
    줄에서 서버가 합성한다. documents.title은 NOT NULL(계획 §6.2)이라 빈 값을 허용하지 않는다."""
    first_line = (content or "").strip().splitlines()[0] if content else ""
    snippet = first_line.strip()[:40]
    if not snippet:
        return f"AI 응용 문항 {index}"
    suffix = "…" if len(first_line.strip()) > 40 else ""
    return f"{snippet}{suffix}"


def _ensure_root_category(db: Session) -> models.Category:
    """예약 루트 분류 find-or-create + settings 포인터(부재·삭제 시 재생성·갱신,
    설계 §4.21 결정 ①). **db.commit()을 호출하지 않는다** — 잡 말미 한 트랜잭션의 일부로
    호출자가 커밋을 소유한다(settings_service.update_settings는 자체 커밋을 하므로 여기서
    쓰지 않고 Setting 행을 직접 다룬다)."""
    row = db.get(models.Setting, ROOT_CATEGORY_SETTING_KEY)
    if row is not None and row.value:
        try:
            cat_id = json.loads(row.value)
        except (TypeError, ValueError):
            cat_id = None
        if cat_id is not None:
            cat = db.get(models.Category, cat_id)
            if cat is not None:
                return cat

    existing = db.execute(
        select(models.Category).where(
            models.Category.parent_id.is_(None), models.Category.name == ROOT_CATEGORY_NAME
        )
    ).scalars().first()
    if existing is not None:
        _set_root_pointer(db, existing.id)
        return existing

    cat = models.Category(parent_id=None, name=ROOT_CATEGORY_NAME, sort_order=0)
    db.add(cat)
    db.flush()
    _set_root_pointer(db, cat.id)
    return cat


def _set_root_pointer(db: Session, category_id: int) -> None:
    row = db.get(models.Setting, ROOT_CATEGORY_SETTING_KEY)
    encoded = json.dumps(category_id)
    if row is None:
        db.add(models.Setting(key=ROOT_CATEGORY_SETTING_KEY, value=encoded))
    else:
        row.value = encoded


def _save_generated(db: Session, job: dict, passed_items: List[dict]) -> dict:
    basis_docs = job.get("_basis_docs") or []
    basis_id_by_doc_no = {d["doc_no"]: d["id"] for d in basis_docs}
    engine = job.get("_engine") or llm_engine_service.ENGINE_CLAUDE_CLI
    scope_label = job["_scope_label"]
    requested = job["_requested_count"]
    marker = _build_question_marker(engine)
    today = dt.date.today().isoformat()

    document_ids: List[int] = []
    try:
        root = _ensure_root_category(db)
        run_name = f"{scope_label} — {dt.datetime.now().strftime('%Y-%m-%d %H:%M')}"
        run_category = models.Category(parent_id=root.id, name=run_name, sort_order=0)
        db.add(run_category)
        db.flush()

        for idx, item in enumerate(passed_items, start=1):
            document = models.Document(
                doc_no=_generate_doc_no(db),
                type="question",
                title=_derive_title(item["content"], idx),
                content=f"{marker}\n\n{item['content']}",
                choices=json.dumps(item["choices"], ensure_ascii=False),
                answer=item["answer"],
                explanation=item["explanation"],
                source_id=None,
                # "N번" 패턴 금지(F44 답지 매칭 키 오염 방지, 설계 §4.21 생성 규약 4).
                source_detail=f"AI 응용 생성 {today}",
                is_active=1,
            )
            db.add(document)
            db.flush()  # id 확보 — category_documents·document_relations가 참조

            db.add(
                models.CategoryDocument(
                    category_id=run_category.id,
                    document_id=document.id,
                    sort_order=idx,
                    linked_by="applied_exam",
                )
            )
            for basis_no in item["basis"]:
                to_id = basis_id_by_doc_no.get(basis_no)
                if to_id is None:
                    continue  # validate_items가 이미 걸렀어야 하나 방어적으로 한 번 더
                db.add(
                    models.DocumentRelation(
                        from_document_id=document.id,
                        to_document_id=to_id,
                        relation="derived_from",
                        created_by="applied_exam",
                    )
                )
            document_ids.append(document.id)

        db.commit()
    except Exception:
        db.rollback()
        raise

    return {
        "run_category_id": run_category.id,
        "requested": requested,
        "generated": len(document_ids),
        "document_ids": document_ids,
    }


def finalize_generation(job: dict, items: List[dict]) -> dict:
    """LLM 산출 직후(백그라운드 워커 스레드) 검증 게이트 → 저장까지 마친다 — 별도 승인
    엔드포인트가 없다(설계 §4.21 결정 ⑤). `convert_service._do_applied_exam_job`이 지연
    import로 호출한다."""
    basis_docs = job.get("_basis_docs") or []
    basis_by_doc_no = {d["doc_no"]: d for d in basis_docs}
    combined_source_text = "\n".join(d.get("content") or "" for d in basis_docs)
    matcher = source_match.SourceMatcher(combined_source_text)

    passed, discard_counts = validate_items(items, basis_by_doc_no, matcher)
    if not passed:
        # 검토 지적 ④ — ValidationAppError.detail은 `_fallback_error_info`의 generic
        # 분기(§4.11)에서 사용자 응답에 실리지 않고 버려진다. 사유 요약을 메시지 문자열
        # 자체에 합성해 "왜 전량 폐기됐는지"가 사용자에게 보이게 한다(원문 미노출 —
        # 사유 코드→한국어 라벨만 사용).
        summary = _format_discard_summary(discard_counts)
        suffix = f" — {summary}." if summary else "."
        raise ValidationAppError(
            f"생성된 문항 전체가 검증에서 폐기되었습니다{suffix} "
            "범위를 좁히거나 문항 수를 줄여 다시 시도해 보세요.",
            detail={"discarded": discard_counts},
        )

    db = SessionLocal()
    try:
        result = _save_generated(db, job, passed)
    finally:
        db.close()

    result["discarded"] = [{"reason": r, "count": c} for r, c in discard_counts.items()]
    return result


# ---------------------------------------------------------------------------
# ⑤ 격리 서브트리 판정 — submit 검증에 사용
# ---------------------------------------------------------------------------
def applied_subtree_ids(db: Session) -> set:
    root_id = settings_service.get_setting(db, ROOT_CATEGORY_SETTING_KEY, None)
    if root_id is None:
        return set()
    root = db.get(models.Category, root_id)
    if root is None:
        return set()
    return set(tree_utils.collect_descendant_ids(db, root_id))


# ---------------------------------------------------------------------------
# ⑥ 제출 — 채점 코어 공유(attempt_service.grade_and_record), mode='applied_exam',
#     applied 루트 서브트리 검증, 리포트 basis[] 추가 (설계 §4.21 응시·제출·리포트)
# ---------------------------------------------------------------------------
def _load_basis(db: Session, document_id: int) -> List[AppliedExamBasisRef]:
    to_ids = db.execute(
        select(models.DocumentRelation.to_document_id).where(
            models.DocumentRelation.from_document_id == document_id,
            models.DocumentRelation.relation == "derived_from",
        )
    ).scalars().all()
    if not to_ids:
        return []
    docs = db.execute(select(models.Document).where(models.Document.id.in_(to_ids))).scalars().all()
    return [
        AppliedExamBasisRef(document_id=d.id, doc_no=d.doc_no, title=d.title, type=d.type) for d in docs
    ]


def submit_applied_exam(db: Session, payload: ExamSubmitRequest) -> AppliedExamSubmitReport:
    if not payload.answers:
        raise ValidationAppError("제출할 답안이 없습니다")

    cut = payload.cut or ExamCut()
    applied_ids = applied_subtree_ids(db)

    document_ids = [a.document_id for a in payload.answers]
    documents = db.execute(
        select(models.Document).where(models.Document.id.in_(document_ids))
    ).scalars().all()
    doc_by_id: Dict[int, models.Document] = {doc.id: doc for doc in documents}

    subject_ids: List[int] = list(dict.fromkeys(a.subject_category_id for a in payload.answers))
    category_by_id: Dict[int, models.Category] = {}
    subtree_by_id: Dict[int, set] = {}
    for cid in subject_ids:
        if cid not in applied_ids:
            raise ValidationAppError(
                "응용 모의고사 분류가 아닙니다 — 실전 모의고사와 혼용해 제출할 수 없습니다",
                detail={"subject_category_id": cid},
            )
        category = category_service.get_category_or_404(db, cid)
        category_by_id[cid] = category
        subtree_by_id[cid] = set(tree_utils.collect_descendant_ids(db, cid))

    for ans in payload.answers:
        doc = doc_by_id.get(ans.document_id)
        if doc is None or not doc.is_active:
            raise ValidationAppError(
                "존재하지 않거나 비활성화된 문서가 포함되어 있습니다",
                detail={"document_id": ans.document_id},
            )
        linked = db.execute(
            select(models.CategoryDocument.category_id).where(
                models.CategoryDocument.document_id == doc.id,
                models.CategoryDocument.category_id.in_(subtree_by_id[ans.subject_category_id]),
            ).limit(1)
        ).first()
        if linked is None:
            raise ValidationAppError(
                "문서가 해당 과목 분류에 속하지 않습니다",
                detail={"document_id": ans.document_id, "subject_category_id": ans.subject_category_id},
            )

    run_key = srs_service.utc_now()  # 배치 공통 answered_at — 응시 런 키(F25 §4.14 전례)
    tallies: Dict[int, exam_scoring.SubjectTally] = {
        cid: exam_scoring.SubjectTally(category_id=cid, name=category_by_id[cid].name)
        for cid in subject_ids
    }
    results: List[AppliedExamResultItem] = []

    try:
        for ans in payload.answers:
            doc = doc_by_id[ans.document_id]
            graded = attempt_service.grade_and_record(
                db,
                document=doc,
                my_answer=ans.my_answer,
                category_id=ans.subject_category_id,
                time_spent=ans.time_spent,
                mode="applied_exam",
                answered_at=run_key,
            )
            tally = tallies[ans.subject_category_id]
            tally.count += 1
            if graded.is_correct:
                tally.correct += 1
            results.append(
                AppliedExamResultItem(
                    document_id=doc.id,
                    subject_category_id=ans.subject_category_id,
                    is_correct=graded.is_correct,
                    my_answer=ans.my_answer,
                    answer=doc.answer,
                    explanation=doc.explanation,
                    review_note_id=graded.review_note_id,
                    basis=_load_basis(db, doc.id),
                )
            )
        db.commit()
    except Exception:
        db.rollback()
        raise

    subject_scores = exam_scoring.grade_subjects(
        [tallies[cid] for cid in subject_ids], subject_min=cut.subject_min
    )
    total = exam_scoring.total_score(subject_scores)
    passed = exam_scoring.is_passed(subject_scores, total, pass_avg=cut.pass_avg)
    total_correct = sum(t.correct for t in tallies.values())
    total_items = sum(t.count for t in tallies.values())

    return AppliedExamSubmitReport(
        taken_at=run_key,
        passed=passed,
        cut=cut,
        total=ExamTotal(score=total, correct=total_correct, count=total_items),
        elapsed_seconds=payload.elapsed_seconds,
        subjects=[
            ExamSubjectReport(
                category_id=s.category_id, name=s.name, score=s.score, correct=s.correct,
                count=s.count, failed=s.failed,
            )
            for s in subject_scores
        ],
        results=results,
    )


# ---------------------------------------------------------------------------
# ⑦ 이력 — attempts(mode='applied_exam') 그룹 파생(exam/history 로직 재사용, 저장 없음)
# ---------------------------------------------------------------------------
def get_applied_exam_history(db: Session, limit: int = 20) -> list:
    run_keys = db.execute(
        select(models.Attempt.answered_at)
        .where(models.Attempt.mode == "applied_exam")
        .distinct()
        .order_by(models.Attempt.answered_at.desc())
        .limit(limit)
    ).scalars().all()

    items: List[AppliedExamHistoryItem] = []
    for run_key in run_keys:
        rows = db.execute(
            select(models.Attempt.category_id, models.Attempt.is_correct).where(
                models.Attempt.mode == "applied_exam", models.Attempt.answered_at == run_key
            )
        ).all()

        tallies: Dict[int, exam_scoring.SubjectTally] = {}
        subject_order: List[int] = []
        for category_id, is_correct in rows:
            if category_id is None:
                continue
            if category_id not in tallies:
                cat = db.get(models.Category, category_id)
                name = cat.name if cat is not None else "(삭제된 분류)"
                tallies[category_id] = exam_scoring.SubjectTally(category_id=category_id, name=name)
                subject_order.append(category_id)
            tally = tallies[category_id]
            tally.count += 1
            if is_correct:
                tally.correct += 1

        if not subject_order:
            continue

        subject_scores = exam_scoring.grade_subjects(
            [tallies[cid] for cid in subject_order], subject_min=exam_scoring.DEFAULT_SUBJECT_MIN
        )
        total = exam_scoring.total_score(subject_scores)
        passed = exam_scoring.is_passed(
            subject_scores, total, pass_avg=exam_scoring.DEFAULT_PASS_AVG
        )
        total_correct = sum(t.correct for t in tallies.values())
        total_items = sum(t.count for t in tallies.values())

        # applied 제출은 항상 단일 과목(=런 분류) — 라벨은 그 분류 이름 그대로
        # (exam/history의 공통 조상 경로 파생과 달리 파생이 필요 없다, 설계 §4.21).
        label = tallies[subject_order[0]].name

        items.append(
            AppliedExamHistoryItem(
                taken_at=run_key,
                label=label,
                passed=passed,
                total=ExamTotal(score=total, correct=total_correct, count=total_items),
                subjects=[
                    ExamHistorySubject(
                        category_id=s.category_id, name=s.name, score=s.score, failed=s.failed
                    )
                    for s in subject_scores
                ],
            )
        )
    return items
