"""복습(SRS) 라우터 (설계 §4.7).

- GET /api/srs/today : 오늘의 복습 큐 (우선순위·상한 적용)
- POST /api/srs/answer : 플래시카드 자가판정 (attempts 없이 SM-2만 갱신)

퀴즈·문제 풀이의 SM-2 갱신은 attempts 경로(서버 내부)에서 처리되므로 여기 없다.
"""
from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database import get_db
from schemas.srs import SrsAnswerRequest, SrsAnswerResult, SrsCardOut
from services import srs_service

router = APIRouter(prefix="/api/srs", tags=["srs"])


@router.get("/today", response_model=List[SrsCardOut])
def get_today(db: Session = Depends(get_db)) -> List[SrsCardOut]:
    return srs_service.get_today_queue(db)


@router.post("/answer", response_model=SrsAnswerResult)
def post_answer(
    payload: SrsAnswerRequest, db: Session = Depends(get_db)
) -> SrsAnswerResult:
    return srs_service.answer_flashcard(db, payload)
