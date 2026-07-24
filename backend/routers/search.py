"""전문 검색 라우터 (F12, 설계 §4.9)."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from database import get_db
from schemas.common import Page
from schemas.search import SearchResultItem
from services import search_service

router = APIRouter(prefix="/api/search", tags=["search"])


@router.get("", response_model=Page[SearchResultItem])
def search(
    q: str = Query(..., min_length=1),
    type: Optional[str] = None,  # noqa: A002 - 설계 §4.9 쿼리 파라미터명 그대로
    page: int = Query(default=1, ge=1),
    size: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> Page[SearchResultItem]:
    items, total = search_service.search(db, q=q, doc_type=type, page=page, size=size)
    return Page[SearchResultItem](
        items=[SearchResultItem(**item) for item in items], total=total, page=page, size=size
    )
