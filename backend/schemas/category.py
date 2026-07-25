from __future__ import annotations

import datetime as dt
from typing import Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field


class CategoryCreate(BaseModel):
    parent_id: Optional[int] = None
    name: str = Field(min_length=1, max_length=200)
    level_hint: Optional[str] = None
    exam_date: Optional[dt.date] = None


class CategoryUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    level_hint: Optional[str] = None
    exam_date: Optional[dt.date] = None


class CategoryMove(BaseModel):
    parent_id: Optional[int] = None
    sort_order: Optional[int] = None


class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    parent_id: Optional[int]
    name: str
    level_hint: Optional[str]
    exam_date: Optional[dt.date]
    sort_order: int
    created_at: dt.datetime


class CategoryNode(BaseModel):
    id: int
    parent_id: Optional[int] = None
    name: str
    level_hint: Optional[str] = None
    exam_date: Optional[dt.date] = None
    sort_order: int = 0
    doc_count: int = 0
    progress: Optional[float] = None
    children: List["CategoryNode"] = Field(default_factory=list)


CategoryNode.model_rebuild()


class StageTypeProgress(BaseModel):
    """F37 3단 진도 한 타입의 done/total (설계 §4.12)."""

    done: int = 0
    total: int = 0


class CategoryNodePipeline(BaseModel):
    """`GET /api/categories/tree?pipeline=1` 전용 응답 노드 — 기존 `CategoryNode`에
    `stage_progress`만 추가된 형태(파라미터 없는 기존 호출은 `CategoryNode`를 그대로 써서
    응답이 바이트 수준으로 불변이어야 하므로, 별도 스키마로 분리한다 — 설계 §4.12)."""

    id: int
    parent_id: Optional[int] = None
    name: str
    level_hint: Optional[str] = None
    exam_date: Optional[dt.date] = None
    sort_order: int = 0
    doc_count: int = 0
    progress: Optional[float] = None
    stage_progress: Dict[str, StageTypeProgress] = Field(default_factory=dict)
    children: List["CategoryNodePipeline"] = Field(default_factory=list)


CategoryNodePipeline.model_rebuild()
