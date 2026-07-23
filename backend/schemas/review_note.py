from __future__ import annotations

import datetime as dt
from typing import Optional

from pydantic import BaseModel, Field


class ReviewNoteDocSummary(BaseModel):
    id: int
    doc_no: str
    title: str
    type: str


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
