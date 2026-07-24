"""태그 비즈니스 로직."""
from __future__ import annotations

from typing import Dict, List

from sqlalchemy import func, select
from sqlalchemy.orm import Session

import models
from exceptions import NotFoundError, ValidationAppError


def get_or_create_tag(db: Session, name: str) -> models.Tag:
    normalized = name.strip()
    tag = db.execute(
        select(models.Tag).where(models.Tag.name == normalized)
    ).scalar_one_or_none()
    if tag is None:
        tag = models.Tag(name=normalized)
        db.add(tag)
        db.flush()
    return tag


def list_tags(db: Session) -> List[dict]:
    rows = db.execute(
        select(
            models.Tag.id,
            models.Tag.name,
            func.count(models.DocumentTag.document_id).label("usage_count"),
        )
        .outerjoin(
            models.DocumentTag, models.DocumentTag.tag_id == models.Tag.id
        )
        .group_by(models.Tag.id)
        .order_by(func.count(models.DocumentTag.document_id).desc(), models.Tag.name)
    ).all()
    return [
        {"id": row.id, "name": row.name, "usage_count": row.usage_count}
        for row in rows
    ]


def merge_tags(db: Session, from_id: int, to_id: int) -> Dict[str, int]:
    """오타 태그 병합(F21 원칙 — 계획서 §11) — from_id가 붙은 문서를 to_id로 재배정하고
    from_id 태그 자체는 삭제한다. 이미 to_id가 붙어 있는 문서는 건너뛴다(PK 중복 방지)."""
    if from_id == to_id:
        raise ValidationAppError(
            "from_id와 to_id가 같습니다", detail={"from_id": from_id, "to_id": to_id}
        )
    from_tag = db.get(models.Tag, from_id)
    if from_tag is None:
        raise NotFoundError("병합할 태그(from_id)를 찾을 수 없습니다", detail={"tag_id": from_id})
    to_tag = db.get(models.Tag, to_id)
    if to_tag is None:
        raise NotFoundError("병합 대상 태그(to_id)를 찾을 수 없습니다", detail={"tag_id": to_id})

    from_doc_ids = db.execute(
        select(models.DocumentTag.document_id).where(models.DocumentTag.tag_id == from_id)
    ).scalars().all()
    to_doc_ids = set(
        db.execute(
            select(models.DocumentTag.document_id).where(models.DocumentTag.tag_id == to_id)
        ).scalars().all()
    )

    merged_count = 0
    for doc_id in from_doc_ids:
        if doc_id not in to_doc_ids:
            db.add(models.DocumentTag(document_id=doc_id, tag_id=to_id))
            merged_count += 1

    db.execute(
        models.DocumentTag.__table__.delete().where(models.DocumentTag.tag_id == from_id)
    )
    db.delete(from_tag)
    db.commit()
    return {"merged_documents": merged_count, "removed_tag_id": from_id}
