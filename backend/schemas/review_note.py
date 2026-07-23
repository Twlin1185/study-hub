from __future__ import annotations

import datetime as dt
from typing import Optional

from pydantic import BaseModel, Field


class ReviewNoteDocSummary(BaseModel):
    id: int
    doc_no: str
    title: str
    type: str
    category_path: Optional[str] = None  # 미분류면 None (설계 §4.6/§5.8)


class ReviewNoteOut(BaseModel):
    id: int
    document_id: int
    document: ReviewNoteDocSummary
    note: Optional[str] = None
    wrong_reason: Optional[str] = None
    is_resolved: bool
    created_at: dt.datetime
    updated_at: dt.datetime


class ReviewNoteUpdate(BaseModel):
    note: Optional[str] = None
    wrong_reason: Optional[str] = None
    is_resolved: Optional[bool] = None
