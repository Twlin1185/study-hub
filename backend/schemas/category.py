from __future__ import annotations

import datetime as dt
from typing import List, Optional

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
