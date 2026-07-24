"""태그 자동 분류 규칙 스키마 (F21, 계획서 §11, 설계 §4.9)."""
from __future__ import annotations

import datetime as dt
from typing import Literal, Optional

from pydantic import BaseModel, Field

TagRuleMode = Literal["suggest", "auto"]


class TagRuleCreate(BaseModel):
    category_id: int
    tag_query: str = Field(min_length=1, max_length=500)
    mode: TagRuleMode = "suggest"


class TagRuleUpdate(BaseModel):
    category_id: Optional[int] = None
    tag_query: Optional[str] = Field(default=None, min_length=1, max_length=500)
    mode: Optional[TagRuleMode] = None


class TagRuleOut(BaseModel):
    id: int
    category_id: int
    category_path: str
    tag_query: str
    mode: str
    created_at: dt.datetime


class ScanResult(BaseModel):
    """POST /api/tag-rules/{id}/scan 응답 — 새로 만든 제안 + 즉시 연결 합계."""

    created: int


class UnlinkResult(BaseModel):
    unlinked: int
