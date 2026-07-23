from __future__ import annotations

import datetime as dt
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

DOCUMENT_TYPES = {"concept", "question", "past_question", "flashcard"}


def _validate_type(value: str) -> str:
    if value not in DOCUMENT_TYPES:
        raise ValueError(
            f"type은 {sorted(DOCUMENT_TYPES)} 중 하나여야 합니다"
        )
    return value


class DocumentCreate(BaseModel):
    type: str
    title: str = Field(min_length=1, max_length=500)
    content: Optional[str] = None
    choices: Optional[List[str]] = None
    answer: Optional[str] = None
    explanation: Optional[str] = None
    difficulty: Optional[int] = Field(default=None, ge=1, le=5)
    source_id: Optional[int] = None
    source_detail: Optional[str] = None

    _check_type = field_validator("type")(_validate_type)


class DocumentUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=500)
    content: Optional[str] = None
    choices: Optional[List[str]] = None
    answer: Optional[str] = None
    explanation: Optional[str] = None
    difficulty: Optional[int] = Field(default=None, ge=1, le=5)
    source_id: Optional[int] = None
    source_detail: Optional[str] = None


class DocumentListItem(BaseModel):
    id: int
    doc_no: str
    type: str
    title: str
    difficulty: Optional[int]
    is_active: bool
    tags: List[str] = Field(default_factory=list)
    usage_count: int = 0
    bookmarked: bool = False
    created_at: dt.datetime
    updated_at: dt.datetime


class DocumentUsage(BaseModel):
    category_id: int
    path: str
    local_note: Optional[str] = None


class DocumentStats(BaseModel):
    attempts: int = 0
    accuracy: float = 0.0
    recent: List[bool] = Field(default_factory=list)  # 최근 10회 풀이 정오, 오래된→최신 (S3)


class DocumentDetail(BaseModel):
    id: int
    doc_no: str
    type: str
    title: str
    content: Optional[str]
    choices: Optional[List[str]]
    answer: Optional[str]
    explanation: Optional[str]
    difficulty: Optional[int]
    source_id: Optional[int]
    source_detail: Optional[str]
    is_active: bool
    forked_from: Optional[int] = None
    created_at: dt.datetime
    updated_at: dt.datetime
    tags: List[str] = Field(default_factory=list)
    usages: List[DocumentUsage] = Field(default_factory=list)
    relations: List[dict] = Field(default_factory=list)
    bookmarked: bool = False
    stats: DocumentStats = Field(default_factory=DocumentStats)


class TagsReplace(BaseModel):
    tags: List[str] = Field(default_factory=list)


class LinkCreate(BaseModel):
    category_id: int
    local_note: Optional[str] = None
    sort_order: Optional[int] = 0
