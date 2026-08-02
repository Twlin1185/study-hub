"""반입 자기 개선 루프 라우터 (S20 — F46, 설계 §4.22). 신규 엔드포인트 13개.

경로 등록 순서 주의: 리터럴 경로(`/cases`·`/gen/prepare`·`/proposals`·`/regression/prepare`)
는 `{id}` 파라미터 경로보다 **앞에** 등록한다(`applied_exam.py`의 `GET /history` 전례).
"""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from database import get_db
from schemas.common import Page
from schemas.improve import (
    CaseDetail,
    CaseSummary,
    GenGenerateRequest,
    GenGenerateStart,
    GenPrepareRequest,
    GenPrepareResult,
    GenStatus,
    ProposalApplyResult,
    ProposalDetail,
    ProposalRejectResult,
    ProposalSummary,
    RegPrepareRequest,
    RegPrepareResult,
    RegRunRequest,
    RegRunStart,
    RegStatus,
)
from services import improve_service

router = APIRouter(prefix="/api/improve", tags=["improve"])


# ---------------------------------------------------------------------------
# ① 실패 사례 (cases)
# ---------------------------------------------------------------------------
@router.get("/cases", response_model=Page[CaseSummary])
def list_cases(
    page: int = Query(default=1, ge=1),
    size: int = Query(default=20, ge=1, le=100),
    kind: Optional[str] = Query(default=None),
) -> Page[CaseSummary]:
    records, total = improve_service.list_cases(kind, page, size)
    items = [CaseSummary(**improve_service.case_summary_dict(r)) for r in records]
    return Page[CaseSummary](items=items, total=total, page=page, size=size)


@router.get("/cases/{case_id}", response_model=CaseDetail)
def get_case(case_id: str) -> CaseDetail:
    record = improve_service.get_case_or_404(case_id)
    return CaseDetail(**improve_service.case_detail_dict(record))


@router.delete("/cases/{case_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_case(case_id: str) -> None:
    improve_service.delete_case(case_id)


# ---------------------------------------------------------------------------
# ② 제안 생성 (gen)
# ---------------------------------------------------------------------------
@router.post("/gen/prepare", response_model=GenPrepareResult)
def gen_prepare(payload: GenPrepareRequest) -> GenPrepareResult:
    """입력 조립·견적만(LLM 0 · 비용 0). 결과는 인메모리 TTL 1시간."""
    return GenPrepareResult(**improve_service.prepare_gen(payload.case_ids))


@router.post("/gen/{gen_id}/generate", response_model=GenGenerateStart, status_code=status.HTTP_202_ACCEPTED)
def gen_generate(
    gen_id: str, payload: GenGenerateRequest, db: Session = Depends(get_db)
) -> GenGenerateStart:
    """제안 생성 잡 시작(convert 잡 큐 재사용 — kind='improve_proposal', 동시 1개)."""
    job_id = improve_service.start_generation(db, gen_id, engine=payload.engine)
    return GenGenerateStart(job_id=job_id)


@router.get("/gen/{gen_id}", response_model=GenStatus)
def gen_status(gen_id: str) -> GenStatus:
    return GenStatus(**improve_service.get_gen_status(gen_id))


# ---------------------------------------------------------------------------
# ③ 제안함 (proposals) — apply가 이 기능의 유일한 파일 쓰기 경로
#
# 목록은 §3 페이지 봉투가 아니라 **평평한 배열**이다(설계 §4.22 엔드포인트 표 — cases와
# 달리 "§3 페이지 봉투" 표기 없음. proposals도 최근 50건 상한이라 페이지네이션 불필요,
# 프론트 `useImproveProposals`가 배열을 그대로 소비한다). `status=all`은 필터 없음.
# ---------------------------------------------------------------------------
@router.get("/proposals", response_model=List[ProposalSummary])
def list_proposals(
    status_: Optional[str] = Query(default="pending", alias="status"),
) -> List[ProposalSummary]:
    filter_status = None if status_ in (None, "", "all") else status_
    records, _total = improve_service.list_proposals(
        filter_status, page=1, size=improve_service.KEEP_MAX
    )
    return [ProposalSummary(**r) for r in records]


@router.get("/proposals/{proposal_id}", response_model=ProposalDetail)
def get_proposal(proposal_id: str) -> ProposalDetail:
    record = improve_service.get_proposal_or_404(proposal_id)
    return ProposalDetail(**improve_service.build_proposal_detail(record))


@router.post("/proposals/{proposal_id}/apply", response_model=ProposalApplyResult)
def apply_proposal(proposal_id: str) -> ProposalApplyResult:
    return ProposalApplyResult(**improve_service.apply_proposal(proposal_id))


@router.post("/proposals/{proposal_id}/reject", response_model=ProposalRejectResult)
def reject_proposal(proposal_id: str) -> ProposalRejectResult:
    return ProposalRejectResult(**improve_service.reject_proposal(proposal_id))


# ---------------------------------------------------------------------------
# ④ 회귀 재검증 (regression)
# ---------------------------------------------------------------------------
@router.post("/regression/prepare", response_model=RegPrepareResult)
def regression_prepare(payload: RegPrepareRequest) -> RegPrepareResult:
    """회귀 견적만(LLM 0). 1~10건·`user_report` 포함 시 422."""
    return RegPrepareResult(**improve_service.prepare_regression(payload.case_ids))


@router.post(
    "/regression/{reg_id}/run", response_model=RegRunStart, status_code=status.HTTP_202_ACCEPTED
)
def regression_run(
    reg_id: str, payload: RegRunRequest, db: Session = Depends(get_db)
) -> RegRunStart:
    job_id = improve_service.start_regression(db, reg_id, engine=payload.engine)
    return RegRunStart(job_id=job_id)


@router.get("/regression/{reg_id}", response_model=RegStatus)
def regression_status(reg_id: str) -> RegStatus:
    return RegStatus(**improve_service.get_reg_status(reg_id))
