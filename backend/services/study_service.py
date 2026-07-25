"""학습 진도 · 이어하기 비즈니스 로직."""
from __future__ import annotations

import datetime as dt
from typing import List, Optional

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
from services.tree_utils import category_path, collect_descendant_ids_ordered


def _get_document_or_404(db: Session, document_id: int) -> models.Document:
    document = db.get(models.Document, document_id)
    if document is None:
        raise NotFoundError(
            "문서를 찾을 수 없습니다", detail={"document_id": document_id}
        )
    return document


def get_study_track(
    db: Session,
    category_id: int,
    *,
    deep: bool = False,
    types: Optional[List[str]] = None,
) -> StudyTrackResponse:
    """학습 트랙 (설계 §4.4 / S9 §4.12 확장).

    `deep`·`types` 둘 다 기본값(False/None)이면 기존(S3) 동작과 바이트 수준으로 동일
    — 단일 카테고리 범위 + 필터 없음 + (sort_order, document_id) 정렬.

    `deep=1`이면 하위 트리 전체 문서를 포함하고, 정렬은 "트리 순회(분류 sort_order) →
    링크 sort_order"(설계 §4.12) — 같은 문서가 서브트리 내 여러 분류에 연결돼도 트리
    순회상 먼저 만난 링크 하나만 남긴다(중복 제거).
    """
    category = category_service.get_category_or_404(db, category_id)

    category_ids = (
        collect_descendant_ids_ordered(db, category_id) if deep else [category_id]
    )
    order_index = {cid: idx for idx, cid in enumerate(category_ids)}

    stmt = (
        select(models.CategoryDocument, models.Document)
        .join(models.Document, models.Document.id == models.CategoryDocument.document_id)
        .where(
            models.CategoryDocument.category_id.in_(category_ids),
            models.Document.is_active == 1,
        )
    )
    if types:
        stmt = stmt.where(models.Document.type.in_(types))

    links = db.execute(stmt).all()
    links_sorted = sorted(
        links,
        key=lambda pair: (
            order_index.get(pair[0].category_id, 0),
            pair[0].sort_order,
            pair[0].document_id,
        ),
    )

    seen_document_ids = set()
    deduped: List[tuple] = []
    for link, doc in links_sorted:
        if doc.id in seen_document_ids:
            continue
        seen_document_ids.add(doc.id)
        deduped.append((link, doc))

    progress_rows = db.execute(
        select(models.StudyProgress).where(
            models.StudyProgress.category_id.in_(category_ids)
        )
    ).scalars().all()
    status_map = {(row.category_id, row.document_id): row.status for row in progress_rows}

    items = [
        StudyTrackDocument(
            document_id=doc.id,
            doc_no=doc.doc_no,
            type=doc.type,
            title=doc.title,
            status=status_map.get((link.category_id, doc.id), "not_started"),
            sort_order=link.sort_order,
        )
        for link, doc in deduped
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
