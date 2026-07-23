from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from database import get_db
from schemas.common import Page
from schemas.document import (
    DocumentCreate,
    DocumentDetail,
    DocumentListItem,
    DocumentUpdate,
    LinkCreate,
    TagsReplace,
)
from services import document_service

router = APIRouter(prefix="/api/documents", tags=["documents"])


@router.get("", response_model=Page[DocumentListItem])
def list_documents(
    category_id: Optional[int] = None,
    deep: bool = False,
    type: Optional[str] = None,  # noqa: A002 - 설계 §4.2의 쿼리 파라미터명 그대로
    tag: Optional[str] = None,
    orphan: bool = False,
    include_inactive: bool = False,
    page: int = Query(default=1, ge=1),
    size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
) -> Page[DocumentListItem]:
    items, total = document_service.list_documents(
        db,
        category_id=category_id,
        deep=deep,
        doc_type=type,
        tag=tag,
        orphan=orphan,
        include_inactive=include_inactive,
        page=page,
        size=size,
    )
    return Page[DocumentListItem](items=items, total=total, page=page, size=size)


@router.post("", response_model=DocumentDetail, status_code=status.HTTP_201_CREATED)
def create_document(
    payload: DocumentCreate, db: Session = Depends(get_db)
) -> DocumentDetail:
    document = document_service.create_document(db, payload)
    return document_service.get_document_detail(db, document.id)


@router.get("/{document_id}", response_model=DocumentDetail)
def get_document(document_id: int, db: Session = Depends(get_db)) -> DocumentDetail:
    return document_service.get_document_detail(db, document_id)


@router.patch("/{document_id}", response_model=DocumentDetail)
def update_document(
    document_id: int, payload: DocumentUpdate, db: Session = Depends(get_db)
) -> DocumentDetail:
    document_service.update_document(db, document_id, payload)
    return document_service.get_document_detail(db, document_id)


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(document_id: int, db: Session = Depends(get_db)) -> None:
    document_service.soft_delete_document(db, document_id)


@router.put("/{document_id}/tags", response_model=DocumentDetail)
def replace_tags(
    document_id: int, payload: TagsReplace, db: Session = Depends(get_db)
) -> DocumentDetail:
    document_service.replace_tags(db, document_id, payload.tags)
    return document_service.get_document_detail(db, document_id)


@router.post("/{document_id}/links", response_model=DocumentDetail, status_code=status.HTTP_200_OK)
def add_link(
    document_id: int, payload: LinkCreate, db: Session = Depends(get_db)
) -> DocumentDetail:
    """분류 연결 upsert — 신규 연결이면 생성, 이미 연결돼 있으면 명시적으로 보낸 필드만 갱신."""
    document_service.add_link(db, document_id, payload)
    return document_service.get_document_detail(db, document_id)


@router.delete("/{document_id}/links/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_link(
    document_id: int, category_id: int, db: Session = Depends(get_db)
) -> None:
    document_service.remove_link(db, document_id, category_id)
