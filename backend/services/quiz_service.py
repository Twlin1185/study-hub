"""퀴즈 세션 구성 로직.

정답·해설은 이 모듈에서 절대 응답에 담지 않는다 (서버 채점 원칙 — 설계 §8).
"""
from __future__ import annotations

import json
import random
from typing import List, Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

import models
from exceptions import ValidationAppError
from schemas.quiz import QuizQuestionOut, QuizSessionRequest, QuizSessionResponse
from services import category_service, settings_service
from services.tree_utils import collect_descendant_ids

QUESTION_TYPES = ("question", "past_question")


def _sequential_order(
    db: Session, doc_ids: List[int], category_ids: Optional[List[int]]
) -> List[int]:
    """category_documents.sort_order 최솟값 기준 정렬(동률이면 document_id).

    문서 하나가 여러 분류에 동시에 연결될 수 있으므로(다대다), 정렬 기준이 되는
    sort_order는 반드시 이번 조회 범위(category_ids)로 좁혀서 집계해야 한다.
    그렇지 않으면 다른 분류 맥락의 sort_order가 섞여 순서가 뒤틀린다.
    범위(category_id)를 지정하지 않은 경우에는 sort_order 맥락이 모호하므로
    document_id 순으로만 정렬한다.
    """
    if not doc_ids:
        return []
    if category_ids is None:
        return sorted(doc_ids)

    rows = db.execute(
        select(
            models.CategoryDocument.document_id,
            func.min(models.CategoryDocument.sort_order).label("min_sort"),
        )
        .where(
            models.CategoryDocument.document_id.in_(doc_ids),
            models.CategoryDocument.category_id.in_(category_ids),
        )
        .group_by(models.CategoryDocument.document_id)
    ).all()
    order_map = {row.document_id: row.min_sort for row in rows}
    return sorted(doc_ids, key=lambda d: (order_map.get(d, 0), d))


def _eligible_ids(
    db: Session, *, category_ids: Optional[List[int]], wrong_only: bool
) -> List[int]:
    stmt = select(models.Document.id).where(
        models.Document.is_active == 1, models.Document.type.in_(QUESTION_TYPES)
    )
    if wrong_only:
        stmt = stmt.join(
            models.ReviewNote, models.ReviewNote.document_id == models.Document.id
        ).where(models.ReviewNote.is_resolved == 0)
    if category_ids is not None:
        stmt = stmt.join(
            models.CategoryDocument,
            models.CategoryDocument.document_id == models.Document.id,
        ).where(models.CategoryDocument.category_id.in_(category_ids))
    return db.execute(stmt.distinct()).scalars().all()


def build_quiz_session(db: Session, payload: QuizSessionRequest) -> QuizSessionResponse:
    if payload.mode == "bookmarked":
        raise ValidationAppError(
            "bookmarked 모드는 아직 지원하지 않습니다 (S4 예정)",
            detail={"mode": payload.mode},
        )

    category_ids: Optional[List[int]] = None
    if payload.category_id is not None:
        category_service.get_category_or_404(db, payload.category_id)
        category_ids = collect_descendant_ids(db, payload.category_id)

    doc_ids = _eligible_ids(
        db, category_ids=category_ids, wrong_only=(payload.mode == "wrong_only")
    )

    if payload.document_ids is not None:
        # 오답노트 개별 재도전 등: 모드 필터(doc_ids)와 요청한 document_ids의 교집합만
        # 남기고, 순서는 요청(document_ids)에 지정된 순서를 그대로 따른다.
        eligible_set = set(doc_ids)
        seen = set()
        doc_ids = []
        for doc_id in payload.document_ids:
            if doc_id in eligible_set and doc_id not in seen:
                seen.add(doc_id)
                doc_ids.append(doc_id)
    elif payload.mode == "random":
        random.shuffle(doc_ids)
    else:
        doc_ids = _sequential_order(db, doc_ids, category_ids)

    count = payload.count or int(settings_service.get_setting(db, "quiz.default_count", 20))
    doc_ids = doc_ids[:count]

    documents = []
    if doc_ids:
        rows = db.execute(
            select(models.Document).where(models.Document.id.in_(doc_ids))
        ).scalars().all()
        by_id = {doc.id: doc for doc in rows}
        documents = [by_id[i] for i in doc_ids if i in by_id]

    items = [
        QuizQuestionOut(
            document_id=doc.id,
            doc_no=doc.doc_no,
            type=doc.type,
            title=doc.title,
            content=doc.content,
            choices=json.loads(doc.choices) if doc.choices else None,
            difficulty=doc.difficulty,
        )
        for doc in documents
    ]

    return QuizSessionResponse(mode=payload.mode, category_id=payload.category_id, items=items)
