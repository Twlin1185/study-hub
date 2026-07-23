"""분류 트리 공용 헬퍼 (하위 트리 id 수집, 경로 문자열 조립).

document_service.py에도 유사한 private 헬퍼가 있으나(기존 S1 코드는 건드리지 않기 위해
그대로 둠), study/quiz/stats 등 S3 신규 서비스에서 공용으로 쓰기 위해 이 모듈에 둔다.
"""
from __future__ import annotations

from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

import models


def collect_descendant_ids(db: Session, category_id: int) -> List[int]:
    """category_id 자신 + 모든 하위 분류 id 목록."""
    ids = [category_id]
    frontier = [category_id]
    while frontier:
        children = db.execute(
            select(models.Category.id).where(models.Category.parent_id.in_(frontier))
        ).scalars().all()
        if not children:
            break
        ids.extend(children)
        frontier = children
    return ids


def category_path(db: Session, category_id: int) -> str:
    """루트부터 해당 분류까지 '/'로 이은 경로 문자열."""
    parts: List[str] = []
    current: Optional[models.Category] = db.get(models.Category, category_id)
    while current is not None:
        parts.append(current.name)
        current = db.get(models.Category, current.parent_id) if current.parent_id else None
    return "/".join(reversed(parts))
