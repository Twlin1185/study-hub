"""태그 비즈니스 로직."""
from __future__ import annotations

from typing import List

from sqlalchemy import func, select
from sqlalchemy.orm import Session

import models


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
