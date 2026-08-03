"""응용 모의고사 라우터 (S19 — F45, 설계 §4.21).

응시 구성은 기존 `POST /api/exam/session`을 그대로 재사용한다(신규 세션 API 없음) —
이 라우터에는 생성 파이프라인(prepare·generate·상태)과 제출·이력만 있다.

경로 등록 순서 주의: `GET /history`는 `GET /{gen_id}`보다 **앞에** 등록해야 한다
(`documents.py`의 `GET /batch` 전례 — 그렇지 않으면 "history"가 gen_id로 매칭된다).
"""
from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from database import get_db
from schemas.applied_exam import (
    AppliedExamGenerateRequest,
    AppliedExamGenerateStart,
    AppliedExamHistoryItem,
    AppliedExamPrepareRequest,
    AppliedExamPrepareResult,
    AppliedExamStatus,
    AppliedExamSubmitReport,
)
from schemas.exam import ExamSubmitRequest
from services import applied_exam_service

router = APIRouter(prefix="/api/applied-exam", tags=["applied-exam"])


@router.post("/prepare", response_model=AppliedExamPrepareResult)
def prepare(
    payload: AppliedExamPrepareRequest, db: Session = Depends(get_db)
) -> AppliedExamPrepareResult:
    """범위 수집·견적만(LLM 0 · 비용 0) — 결과는 인메모리 TTL 1시간."""
    return applied_exam_service.prepare(db, payload)


@router.post(
    "/{gen_id}/generate",
    response_model=AppliedExamGenerateStart,
    status_code=status.HTTP_202_ACCEPTED,
)
def generate(
    gen_id: str, payload: AppliedExamGenerateRequest, db: Session = Depends(get_db)
) -> AppliedExamGenerateStart:
    """생성 잡 시작 — convert 잡 큐 재사용(kind='applied_exam', 동시 1개). 검증 게이트 통과
    문항만 잡 말미 한 트랜잭션으로 저장한다(별도 승인 엔드포인트 없음 — 설계 §4.21 결정 ⑤).
    `mode`(S24 — F50 ①, 기본 accumulate)는 잡 레코드에 인메모리로만 보관된다."""
    job_id = applied_exam_service.start_generation(
        db, gen_id, engine=payload.engine, model=payload.model, mode=payload.mode
    )
    return AppliedExamGenerateStart(job_id=job_id)


@router.post("/submit", response_model=AppliedExamSubmitReport)
def submit(payload: ExamSubmitRequest, db: Session = Depends(get_db)) -> AppliedExamSubmitReport:
    """일괄 제출 채점 — 채점 코어 공유(attempt_service.grade_and_record), mode='applied_exam'
    기록, applied 루트 서브트리 검증(아니면 422), 배치 전체 한 트랜잭션(불변 규칙 2)."""
    return applied_exam_service.submit_applied_exam(db, payload)


@router.get("/history", response_model=List[AppliedExamHistoryItem])
def history(
    limit: int = Query(default=20, ge=1, le=100), db: Session = Depends(get_db)
) -> List[AppliedExamHistoryItem]:
    return applied_exam_service.get_applied_exam_history(db, limit=limit)


@router.get("/{gen_id}", response_model=AppliedExamStatus)
def get_status(gen_id: str) -> AppliedExamStatus:
    return applied_exam_service.get_status(gen_id)
