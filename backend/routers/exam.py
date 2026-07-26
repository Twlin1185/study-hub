"""모의고사 라우터 (설계 §4.14, F25).

exam/session 응답에는 정답·해설이 없다(불변 규칙 1). exam/submit은 배치 전체가 한
트랜잭션(exam_service.submit_exam이 트랜잭션 경계를 소유, 불변 규칙 2).
"""
from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from database import get_db
from schemas.exam import (
    ExamHistoryItem,
    ExamSessionRequest,
    ExamSessionResponse,
    ExamSubmitReport,
    ExamSubmitRequest,
)
from services import exam_service

router = APIRouter(prefix="/api/exam", tags=["exam"])


@router.post("/session", response_model=ExamSessionResponse)
def create_exam_session(
    payload: ExamSessionRequest, db: Session = Depends(get_db)
) -> ExamSessionResponse:
    return exam_service.build_exam_session(db, payload)


@router.post("/submit", response_model=ExamSubmitReport)
def submit_exam(
    payload: ExamSubmitRequest, db: Session = Depends(get_db)
) -> ExamSubmitReport:
    return exam_service.submit_exam(db, payload)


@router.get("/history", response_model=List[ExamHistoryItem])
def get_exam_history(
    limit: int = Query(default=20, ge=1, le=100), db: Session = Depends(get_db)
) -> List[ExamHistoryItem]:
    return exam_service.get_exam_history(db, limit=limit)
