"""퀴즈 세션 · 풀이 채점 라우터 (설계 §4.5).

불변 규칙: /quiz/session 응답에는 정답·해설이 절대 포함되지 않는다.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database import get_db
from schemas.attempt import AttemptCreate, AttemptResult
from schemas.quiz import QuizSessionRequest, QuizSessionResponse
from services import attempt_service, quiz_service

router = APIRouter(tags=["quiz"])


@router.post("/api/quiz/session", response_model=QuizSessionResponse)
def create_quiz_session(
    payload: QuizSessionRequest, db: Session = Depends(get_db)
) -> QuizSessionResponse:
    return quiz_service.build_quiz_session(db, payload)


@router.post("/api/attempts", response_model=AttemptResult)
def create_attempt(payload: AttemptCreate, db: Session = Depends(get_db)) -> AttemptResult:
    return attempt_service.submit_attempt(db, payload)
