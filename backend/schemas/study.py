from __future__ import annotations

import datetime as dt
from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class StudyTrackDocument(BaseModel):
    document_id: int
    doc_no: str
    type: str
    title: str
    status: str  # 'not_started' | 'in_progress' | 'done'
    sort_order: int


class StudyTrackResponse(BaseModel):
    category_id: int
    category_name: str
    items: List[StudyTrackDocument] = Field(default_factory=list)
    resume_document_id: Optional[int] = None


class StudyEventRequest(BaseModel):
    category_id: int
    document_id: int
    action: Literal["complete", "position"]


class ContinueCard(BaseModel):
    category_id: int
    path: str
    document_id: int
    document_title: str
    document_type: str
    done: int
    total: int
