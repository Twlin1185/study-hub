"""학습 진도 · 이어하기 비즈니스 로직."""
from __future__ import annotations

import datetime as dt
from typing import List

from sqlalchemy import select
from sqlalchemy.orm import Session

import models
from exceptions import NotFoundError
from schemas.study import (
    ContinueCard,
    StudyEventRequest,
    StudyTrackDocument,
    StudyTrackResponse,
)
from services import category_service
from services.tree_utils import category_path


def _get_document_or_404(db: Session, document_id: int) -> models.Document:
    document = db.get(models.Document, document_id)
    if document is None:
        raise NotFoundError(
            "문서를 찾을 수 없습니다", detail={"document_id": document_id}
        )
    return document


def get_study_track(db: Session, category_id: int) -> StudyTrackResponse:
    category = category_service.get_category_or_404(db, category_id)

    links = db.execute(
        select(models.CategoryDocument, models.Document)
        .join(models.Document, models.Document.id == models.CategoryDocument.document_id)
        .where(
            models.CategoryDocument.category_id == category_id,
            models.Document.is_active == 1,
        )
        .order_by(models.CategoryDocument.sort_order, models.CategoryDocument.document_id)
    ).all()

    progress_rows = db.execute(
        select(models.StudyProgress).where(models.StudyProgress.category_id == category_id)
    ).scalars().all()
    status_by_doc = {row.document_id: row.status for row in progress_rows}

    items = [
        StudyTrackDocument(
            document_id=doc.id,
            doc_no=doc.doc_no,
            type=doc.type,
            title=doc.title,
            status=status_by_doc.get(doc.id, "not_started"),
            sort_order=link.sort_order,
        )
        for link, doc in links
    ]

    resume = db.get(models.ResumePoint, category_id)
    resume_document_id = resume.document_id if resume is not None else None

    return StudyTrackResponse(
        category_id=category.id,
        category_name=category.name,
        items=items,
        resume_document_id=resume_document_id,
    )


def record_event(db: Session, payload: StudyEventRequest) -> None:
    category_service.get_category_or_404(db, payload.category_id)
    _get_document_or_404(db, payload.document_id)

    now = dt.datetime.utcnow()

    if payload.action == "complete":
        progress = db.get(
            models.StudyProgress,
            {"category_id": payload.category_id, "document_id": payload.document_id},
        )
        if progress is None:
            progress = models.StudyProgress(
                category_id=payload.category_id, document_id=payload.document_id
            )
            db.add(progress)
        progress.status = "done"
        progress.completed_at = now
        db.commit()
        return

    # action == "position"
    resume = db.get(models.ResumePoint, payload.category_id)
    if resume is None:
        resume = models.ResumePoint(category_id=payload.category_id)
        db.add(resume)
    resume.document_id = payload.document_id
    resume.updated_at = now  # SQLite에는 onupdate 트리거가 없어 앱에서 직접 갱신
    db.commit()


def get_continue_cards(db: Session, limit: int = 3) -> List[ContinueCard]:
    resumes = db.execute(
        select(models.ResumePoint)
        .where(models.ResumePoint.document_id.is_not(None))
        .order_by(models.ResumePoint.updated_at.desc())
        .limit(limit)
    ).scalars().all()

    if not resumes:
        return []

    progress_map = category_service.subtree_progress(db)

    cards: List[ContinueCard] = []
    for resume in resumes:
        document = db.get(models.Document, resume.document_id)
        if document is None or not document.is_active:
            continue
        done, total = progress_map.get(resume.category_id, (0, 0))
        cards.append(
            ContinueCard(
                category_id=resume.category_id,
                path=category_path(db, resume.category_id),
                document_id=document.id,
                document_title=document.title,
                document_type=document.type,
                done=done,
                total=total,
            )
        )
    return cards
