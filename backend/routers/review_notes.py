"""오답노트 라우터 (설계 §4.6)."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from database import get_db
from schemas.common import Page
from schemas.review_note import ReviewNoteOut, ReviewNoteUpdate
from services import review_note_service

router = APIRouter(prefix="/api/review-notes", tags=["review-notes"])


@router.get("", response_model=Page[ReviewNoteOut])
def list_review_notes(
    resolved: Optional[bool] = None,
    wrong_reason: Optional[str] = None,
    category_id: Optional[int] = None,
    page: int = Query(default=1, ge=1),
    size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
) -> Page[ReviewNoteOut]:
    items, total = review_note_service.list_review_notes(
        db,
        resolved=resolved,
        wrong_reason=wrong_reason,
        category_id=category_id,
        page=page,
        size=size,
    )
    return Page[ReviewNoteOut](items=items, total=total, page=page, size=size)


@router.patch("/{review_note_id}", response_model=ReviewNoteOut)
def update_review_note(
    review_note_id: int, payload: ReviewNoteUpdate, db: Session = Depends(get_db)
) -> ReviewNoteOut:
    return review_note_service.update_review_note(db, review_note_id, payload)
