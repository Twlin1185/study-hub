from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database import get_db
from schemas.tag import TagMergeRequest, TagMergeResult, TagOut
from services import tag_service

router = APIRouter(prefix="/api/tags", tags=["tags"])


@router.get("", response_model=List[TagOut])
def list_tags(db: Session = Depends(get_db)) -> List[TagOut]:
    return [TagOut(**row) for row in tag_service.list_tags(db)]


@router.post("/merge", response_model=TagMergeResult)
def merge_tags(payload: TagMergeRequest, db: Session = Depends(get_db)) -> TagMergeResult:
    result = tag_service.merge_tags(db, payload.from_id, payload.to_id)
    return TagMergeResult(**result)
