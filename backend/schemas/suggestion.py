"""태그 규칙 연결 제안함 스키마 (설계 §4.9)."""
from __future__ import annotations

import datetime as dt
from typing import List, Optional

from pydantic import BaseModel, Field


class SuggestionOut(BaseModel):
    id: int
    document_id: int
    doc_no: str
    title: str
    category_id: int
    category_path: str
    tag_rule_id: Optional[int] = None
    tag_rule_query: Optional[str] = None
    created_at: dt.datetime


class SuggestionApplyRequest(BaseModel):
    approve: List[int] = Field(default_factory=list)
    reject: List[int] = Field(default_factory=list)


class SuggestionApplyResult(BaseModel):
    approved: int
    rejected: int
