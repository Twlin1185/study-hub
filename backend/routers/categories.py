from __future__ import annotations

from typing import List, Optional, Union

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from database import get_db
from schemas.category import (
    CategoryCreate,
    CategoryMove,
    CategoryNode,
    CategoryNodePipeline,
    CategoryOut,
    CategoryUpdate,
)
from schemas.stats import CategoryStatsItem
from schemas.study import StudyTrackResponse
from services import category_service, stats_service, study_service

router = APIRouter(prefix="/api/categories", tags=["categories"])


@router.get(
    "/tree",
    # 문서 전용 — response_model은 일부러 지정하지 않는다(아래 참조). 여기 `responses`의
    # "model" 키는 FastAPI가 OpenAPI 스키마(components/schemas + 200 응답 anyOf)만
    # 생성할 때 쓰고, 실제 요청 처리에는 전혀 관여하지 않는다(response_model이 없으므로
    # 런타임 검증·필드 필터링 없음 — 직렬화 경로 불변, 이 파일 상단 스모크로 확인됨).
    responses={
        200: {
            "model": Union[List[CategoryNode], List[CategoryNodePipeline]],
            "description": (
                "파라미터 없음(또는 pipeline=0): List[CategoryNode]. "
                "pipeline=1: List[CategoryNodePipeline](stage_progress 포함, 설계 §4.12)."
            ),
        }
    },
)
def get_tree(pipeline: bool = False, db: Session = Depends(get_db)):
    # pipeline=1: F37 stage_progress 포함 응답(CategoryNodePipeline) — response_model을
    # 고정하면(List[CategoryNode]) 추가 필드가 검증 단계에서 잘려나가므로 일부러 지정하지
    # 않는다(반환 객체 각각의 실제 pydantic 타입 그대로 직렬화돼 기존 호출은 바이트 불변).
    if pipeline:
        return category_service.build_tree_pipeline(db)
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
    category_id: int,
    deep: bool = False,
    types: Optional[str] = None,
    db: Session = Depends(get_db),
) -> StudyTrackResponse:
    # types: 콤마 구분 문자열(예: 'concept,question') — 설계 §4.12
    type_list = [t.strip() for t in types.split(",") if t.strip()] if types else None
    return study_service.get_study_track(db, category_id, deep=deep, types=type_list)


@router.get("/{category_id}/stats", response_model=List[CategoryStatsItem])
def get_category_stats(
    category_id: int, db: Session = Depends(get_db)
) -> List[CategoryStatsItem]:
    return stats_service.get_category_children_stats(db, category_id)
