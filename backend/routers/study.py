"""학습 진도 · 이어하기 라우터 (설계 §4.4)."""
from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from database import get_db
from schemas.study import ContinueCard, StudyEventRequest
from services import study_service

router = APIRouter(prefix="/api/study", tags=["study"])


@router.get("/continue", response_model=List[ContinueCard])
def get_continue(db: Session = Depends(get_db)) -> List[ContinueCard]:
    return study_service.get_continue_cards(db, limit=3)


@router.post("/events", status_code=status.HTTP_204_NO_CONTENT)
def post_event(payload: StudyEventRequest, db: Session = Depends(get_db)) -> None:
    study_service.record_event(db, payload)
