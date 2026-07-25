from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from database import get_db
from schemas.tag import (
    SimilarTagPair,
    TagMergeRequest,
    TagMergeResult,
    TagOut,
    TagRename,
)
from services import tag_service

router = APIRouter(prefix="/api/tags", tags=["tags"])


@router.get("", response_model=List[TagOut])
def list_tags(db: Session = Depends(get_db)) -> List[TagOut]:
    return [TagOut(**row) for row in tag_service.list_tags(db)]


@router.get("/similar", response_model=List[SimilarTagPair])
def get_similar_tags(db: Session = Depends(get_db)) -> List[SimilarTagPair]:
    return [SimilarTagPair(**row) for row in tag_service.find_similar_tags(db)]


@router.post("/merge", response_model=TagMergeResult)
def merge_tags(payload: TagMergeRequest, db: Session = Depends(get_db)) -> TagMergeResult:
    result = tag_service.merge_tags(db, payload.from_id, payload.to_id)
    return TagMergeResult(**result)


@router.patch("/{tag_id}", response_model=TagOut)
def rename_tag(tag_id: int, payload: TagRename, db: Session = Depends(get_db)) -> TagOut:
    tag_service.rename_tag(db, tag_id, payload.name)
    return TagOut(**tag_service.get_tag_detail(db, tag_id))


@router.delete("/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tag(tag_id: int, db: Session = Depends(get_db)) -> None:
    tag_service.delete_tag(db, tag_id)
