"""분류 트리 비즈니스 로직."""
from __future__ import annotations

from collections import defaultdict
from typing import Dict, List, Optional, Tuple

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

import models
from exceptions import ConflictError, NotFoundError
from schemas.category import CategoryCreate, CategoryMove, CategoryNode, CategoryUpdate

# 진도 집계 대상 문서 타입 — 플래시카드(S5)는 학습 트랙/진도율에서 제외
PROGRESS_DOCUMENT_TYPES = ("concept", "question", "past_question")


def get_category_or_404(db: Session, category_id: int) -> models.Category:
    category = db.get(models.Category, category_id)
    if category is None:
        raise NotFoundError(
            "분류를 찾을 수 없습니다", detail={"category_id": category_id}
        )
    return category


def _doc_counts(db: Session) -> Dict[int, int]:
    rows = db.execute(
        select(
            models.CategoryDocument.category_id,
            func.count(models.CategoryDocument.document_id),
        )
        .join(
            models.Document,
            models.Document.id == models.CategoryDocument.document_id,
        )
        .where(models.Document.is_active == 1)
        .group_by(models.CategoryDocument.category_id)
    ).all()
    return {category_id: count for category_id, count in rows}


def subtree_progress(db: Session) -> Dict[int, Tuple[int, int]]:
    """분류별 {id: (done, total)} — 자기 자신을 루트로 한 하위 트리 전체 집계.

    재귀 CTE 1쿼리로 트리를 펼친 뒤, 각 루트에 속한 (분류, 문서) 연결을 문서
    타입(개념/문제) + is_active + study_progress.status='done' 기준으로 집계한다.
    total=0이면 호출부에서 progress를 null로 표시한다.
    """
    type_list = ", ".join(f"'{t}'" for t in PROGRESS_DOCUMENT_TYPES)
    rows = db.execute(
        text(
            f"""
            WITH RECURSIVE tree(id, root_id) AS (
                SELECT id, id FROM categories
                UNION ALL
                SELECT c.id, t.root_id
                FROM categories c
                JOIN tree t ON c.parent_id = t.id
            )
            SELECT
                t.root_id AS root_id,
                COUNT(DISTINCT CASE
                    WHEN d.is_active = 1 AND d.type IN ({type_list})
                    THEN cd.document_id
                END) AS total,
                COUNT(DISTINCT CASE
                    WHEN d.is_active = 1 AND d.type IN ({type_list})
                         AND sp.status = 'done'
                    THEN cd.document_id
                END) AS done
            FROM tree t
            LEFT JOIN category_documents cd ON cd.category_id = t.id
            LEFT JOIN documents d ON d.id = cd.document_id
            LEFT JOIN study_progress sp
                ON sp.category_id = cd.category_id AND sp.document_id = cd.document_id
            GROUP BY t.root_id
            """
        )
    ).all()
    return {row.root_id: (row.done, row.total) for row in rows}


def build_tree(db: Session) -> List[CategoryNode]:
    categories = db.execute(
        select(models.Category).order_by(models.Category.sort_order, models.Category.id)
    ).scalars().all()

    counts = _doc_counts(db)
    progress_map = subtree_progress(db)

    children_by_parent: Dict[Optional[int], List[models.Category]] = defaultdict(list)
    for cat in categories:
        children_by_parent[cat.parent_id].append(cat)

    def build(cat: models.Category) -> CategoryNode:
        done, total = progress_map.get(cat.id, (0, 0))
        return CategoryNode(
            id=cat.id,
            parent_id=cat.parent_id,
            name=cat.name,
            level_hint=cat.level_hint,
            exam_date=cat.exam_date,
            sort_order=cat.sort_order,
            doc_count=counts.get(cat.id, 0),
            progress=(done / total) if total else None,
            children=[build(child) for child in children_by_parent.get(cat.id, [])],
        )

    roots = children_by_parent.get(None, [])
    return [build(root) for root in roots]


def create_category(db: Session, payload: CategoryCreate) -> models.Category:
    if payload.parent_id is not None:
        get_category_or_404(db, payload.parent_id)

    max_sort = db.execute(
        select(func.max(models.Category.sort_order)).where(
            models.Category.parent_id == payload.parent_id
        )
    ).scalar()

    category = models.Category(
        parent_id=payload.parent_id,
        name=payload.name,
        level_hint=payload.level_hint,
        exam_date=payload.exam_date,
        sort_order=(max_sort or 0) + 1 if max_sort is not None else 0,
    )
    db.add(category)
    db.commit()
    db.refresh(category)
    return category


def update_category(
    db: Session, category_id: int, payload: CategoryUpdate
) -> models.Category:
    category = get_category_or_404(db, category_id)
    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(category, field, value)
    db.commit()
    db.refresh(category)
    return category


def _is_self_or_descendant(db: Session, root_id: int, candidate_id: int) -> bool:
    """candidate_id가 root_id 자신이거나 root_id의 자손인지 확인."""
    if root_id == candidate_id:
        return True
    children = db.execute(
        select(models.Category.id).where(models.Category.parent_id == root_id)
    ).scalars().all()
    for child_id in children:
        if _is_self_or_descendant(db, child_id, candidate_id):
            return True
    return False


def move_category(
    db: Session, category_id: int, payload: CategoryMove
) -> models.Category:
    category = get_category_or_404(db, category_id)

    new_parent_id = payload.parent_id
    if new_parent_id is not None:
        get_category_or_404(db, new_parent_id)
        if _is_self_or_descendant(db, category_id, new_parent_id):
            raise ConflictError(
                "자기 자신이나 자손 아래로는 이동할 수 없습니다",
                detail={"category_id": category_id, "target_parent_id": new_parent_id},
            )

    category.parent_id = new_parent_id
    if payload.sort_order is not None:
        category.sort_order = payload.sort_order
    db.commit()
    db.refresh(category)
    return category


def delete_category(db: Session, category_id: int) -> None:
    category = get_category_or_404(db, category_id)

    has_children = db.execute(
        select(models.Category.id).where(models.Category.parent_id == category_id).limit(1)
    ).first()
    if has_children:
        raise ConflictError(
            "하위 분류가 있어 삭제할 수 없습니다. 먼저 비워주세요",
            detail={"category_id": category_id},
        )

    has_documents = db.execute(
        select(models.CategoryDocument.document_id)
        .where(models.CategoryDocument.category_id == category_id)
        .limit(1)
    ).first()
    if has_documents:
        raise ConflictError(
            "연결된 문서가 있어 삭제할 수 없습니다. 먼저 연결을 해제해주세요",
            detail={"category_id": category_id},
        )

    db.delete(category)
    db.commit()
