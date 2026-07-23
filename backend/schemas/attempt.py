from __future__ import annotations

import datetime as dt
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class AttemptCreate(BaseModel):
    document_id: int
    category_id: Optional[int] = None
    my_answer: Optional[str] = None
    time_spent: Optional[int] = Field(default=None, ge=0)
    mode: Optional[str] = "quiz"  # 'quiz' | 'review' | 'flashcard' | 'study'


class SrsInfo(BaseModel):
    due_date: Optional[dt.date] = None


class AttemptResult(BaseModel):
    """채점 결과 — 이 시점에는 정답·해설을 공개해도 된다 (제출 이후이므로)."""

    is_correct: bool
    answer: Optional[str]
    explanation: Optional[str]
    review_note_id: Optional[int] = None
    srs: Optional[SrsInfo] = None  # S5부터 채움. 그 전엔 null 고정
