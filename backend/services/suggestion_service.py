"""제안함 조회·승인/거절 (F21, 설계 §4.9)."""
from __future__ import annotations

import datetime as dt
from typing import Dict, List

from sqlalchemy import select
from sqlalchemy.orm import Session

import models
from services.tag_rule_service import _next_sort_order
from services.tree_utils import category_path


def list_pending_suggestions(db: Session) -> List[Dict]:
    rows = db.execute(
        select(models.Suggestion, models.Document, models.Category, models.TagRule)
        .join(models.Document, models.Document.id == models.Suggestion.document_id)
        .join(models.Category, models.Category.id == models.Suggestion.category_id)
        .outerjoin(models.TagRule, models.TagRule.id == models.Suggestion.tag_rule_id)
        .where(models.Suggestion.status == "pending", models.Document.is_active == 1)
        .order_by(models.Suggestion.created_at)
    ).all()
    return [
        {
            "id": suggestion.id,
            "document_id": document.id,
            "doc_no": document.doc_no,
            "title": document.title,
            "category_id": category.id,
            "category_path": category_path(db, category.id),
            "tag_rule_id": suggestion.tag_rule_id,
            # 규칙이 삭제되어 SET NULL이면(§4.9) tag_rule은 None → null
            "tag_rule_query": tag_rule.tag_query if tag_rule is not None else None,
            "created_at": suggestion.created_at,
        }
        for suggestion, document, category, tag_rule in rows
    ]


def apply_suggestions(db: Session, *, approve: List[int], reject: List[int]) -> Dict[str, int]:
    """승인 = 연결 생성(linked_by='rule') + status='approved'. 이미 연결돼 있으면
    승인은 no-op(멱등). 거절 = status='rejected'(거절 기억으로 재제안 방지)."""
    now = dt.datetime.now()
    approved = 0
    rejected = 0

    for sid in approve:
        suggestion = db.get(models.Suggestion, sid)
        if suggestion is None:
            continue
        document = db.get(models.Document, suggestion.document_id)
        if document is None or not document.is_active:
            # 소프트 삭제된 문서의 제안은 조용히 건너뛴다 — 에러도, 승인 카운트도 아니다
            # (경미 결함 수정: 제안함에서 이미 걸러지지만 apply는 직접 id로도 올 수 있음).
            continue
        if suggestion.status != "approved":
            existing_link = db.get(
                models.CategoryDocument,
                {"category_id": suggestion.category_id, "document_id": suggestion.document_id},
            )
            if existing_link is None:
                db.add(
                    models.CategoryDocument(
                        category_id=suggestion.category_id,
                        document_id=suggestion.document_id,
                        linked_by="rule",
                        linked_rule_id=suggestion.tag_rule_id,
                        sort_order=_next_sort_order(db, suggestion.category_id),
                    )
                )
            suggestion.status = "approved"
            suggestion.decided_at = now
        approved += 1

    for sid in reject:
        suggestion = db.get(models.Suggestion, sid)
        if suggestion is None:
            continue
        suggestion.status = "rejected"
        suggestion.decided_at = now
        rejected += 1

    db.commit()
    return {"approved": approved, "rejected": rejected}
