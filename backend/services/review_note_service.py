"""오답노트 비즈니스 로직 (F06)."""
from __future__ import annotations

from typing import List, Optional, Tuple

from sqlalchemy import func, select
from sqlalchemy.orm import Session

import models
from exceptions import NotFoundError
from schemas.review_note import (
    ReviewNoteDocSummary,
    ReviewNoteOut,
    ReviewNoteUpdate,
)
from services.tree_utils import collect_descendant_ids


def _to_out(note: models.ReviewNote, document: models.Document) -> ReviewNoteOut:
    return ReviewNoteOut(
        id=note.id,
        document_id=note.document_id,
        document=ReviewNoteDocSummary(
            id=document.id, doc_no=document.doc_no, title=document.title, type=document.type
        ),
        note=note.note,
        wrong_reason=note.wrong_reason,
        is_resolved=bool(note.is_resolved),
        created_at=note.created_at,
        updated_at=note.updated_at,
    )


def list_review_notes(
    db: Session,
    *,
    resolved: Optional[bool] = None,
    wrong_reason: Optional[str] = None,
    category_id: Optional[int] = None,
    page: int = 1,
    size: int = 50,
) -> Tuple[List[ReviewNoteOut], int]:
    id_query = select(models.ReviewNote.id).distinct()

    if resolved is not None:
        id_query = id_query.where(models.ReviewNote.is_resolved == (1 if resolved else 0))
    if wrong_reason is not None:
        id_query = id_query.where(models.ReviewNote.wrong_reason == wrong_reason)
    if category_id is not None:
        category_ids = collect_descendant_ids(db, category_id)
        id_query = id_query.join(
            models.CategoryDocument,
            models.CategoryDocument.document_id == models.ReviewNote.document_id,
        ).where(models.CategoryDocument.category_id.in_(category_ids))

    total = db.execute(select(func.count()).select_from(id_query.subquery())).scalar_one()

    ordered_ids = db.execute(id_query).scalars().all()

    rows = []
    if ordered_ids:
        rows = db.execute(
            select(models.ReviewNote, models.Document)
            .join(models.Document, models.Document.id == models.ReviewNote.document_id)
            .where(models.ReviewNote.id.in_(ordered_ids))
            .order_by(models.ReviewNote.updated_at.desc())
            .offset((page - 1) * size)
            .limit(size)
        ).all()

    items = [_to_out(note, document) for note, document in rows]
    return items, total


def update_review_note(
    db: Session, review_note_id: int, payload: ReviewNoteUpdate
) -> ReviewNoteOut:
    note = db.get(models.ReviewNote, review_note_id)
    if note is None:
        raise NotFoundError(
            "오답노트를 찾을 수 없습니다", detail={"review_note_id": review_note_id}
        )

    data = payload.model_dump(exclude_unset=True)
    if "is_resolved" in data:
        data["is_resolved"] = 1 if data["is_resolved"] else 0
    for field, value in data.items():
        setattr(note, field, value)

    db.commit()
    db.refresh(note)

    document = db.get(models.Document, note.document_id)
    return _to_out(note, document)
