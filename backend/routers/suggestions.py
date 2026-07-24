"""태그 규칙 연결 제안함 라우터 (F21, 설계 §4.9)."""
from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database import get_db
from schemas.suggestion import SuggestionApplyRequest, SuggestionApplyResult, SuggestionOut
from services import suggestion_service

router = APIRouter(prefix="/api/suggestions", tags=["suggestions"])


@router.get("", response_model=List[SuggestionOut])
def list_suggestions(db: Session = Depends(get_db)) -> List[SuggestionOut]:
    return [SuggestionOut(**row) for row in suggestion_service.list_pending_suggestions(db)]


@router.post("/apply", response_model=SuggestionApplyResult)
def apply_suggestions(
    payload: SuggestionApplyRequest, db: Session = Depends(get_db)
) -> SuggestionApplyResult:
    result = suggestion_service.apply_suggestions(
        db, approve=payload.approve, reject=payload.reject
    )
    return SuggestionApplyResult(**result)
