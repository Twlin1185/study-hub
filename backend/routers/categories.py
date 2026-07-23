from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from database import get_db
from schemas.category import CategoryCreate, CategoryMove, CategoryNode, CategoryOut, CategoryUpdate
from schemas.study import StudyTrackResponse
from services import category_service, study_service

router = APIRouter(prefix="/api/categories", tags=["categories"])


@router.get("/tree", response_model=List[CategoryNode])
def get_tree(db: Session = Depends(get_db)) -> List[CategoryNode]:
    return category_service.build_tree(db)


@router.post("", response_model=CategoryOut, status_code=status.HTTP_201_CREATED)
def create_category(
    payload: CategoryCreate, db: Session = Depends(get_db)
) -> CategoryOut:
    category = category_service.create_category(db, payload)
    return CategoryOut.model_validate(category)


@router.patch("/{category_id}", response_model=CategoryOut)
def update_category(
    category_id: int, payload: CategoryUpdate, db: Session = Depends(get_db)
) -> CategoryOut:
    category = category_service.update_category(db, category_id, payload)
    return CategoryOut.model_validate(category)


@router.post("/{category_id}/move", response_model=CategoryOut)
def move_category(
    category_id: int, payload: CategoryMove, db: Session = Depends(get_db)
) -> CategoryOut:
    category = category_service.move_category(db, category_id, payload)
    return CategoryOut.model_validate(category)


@router.delete("/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(category_id: int, db: Session = Depends(get_db)) -> None:
    category_service.delete_category(db, category_id)


@router.get("/{category_id}/study-track", response_model=StudyTrackResponse)
def get_study_track(
    category_id: int, db: Session = Depends(get_db)
) -> StudyTrackResponse:
    return study_service.get_study_track(db, category_id)
