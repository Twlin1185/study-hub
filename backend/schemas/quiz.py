"""퀴즈 세션 스키마.

중요: 서버 채점 원칙(설계 §8) — 이 스키마들은 정답(answer)·해설(explanation)을
절대 포함하지 않는다. quiz/session 응답은 풀기 전에는 문제만 보여준다.
"""
from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field

QuizMode = Literal["sequential", "random", "wrong_only", "bookmarked"]


class QuizSessionRequest(BaseModel):
    category_id: Optional[int] = None
    mode: QuizMode = "sequential"
    count: Optional[int] = Field(default=None, ge=1, le=200)
    document_ids: Optional[List[int]] = None


class QuizQuestionOut(BaseModel):
    document_id: int
    doc_no: str
    type: str
    title: str
    content: Optional[str] = None
    choices: Optional[List[str]] = None
    difficulty: Optional[int] = None


class QuizSessionResponse(BaseModel):
    mode: QuizMode
    category_id: Optional[int] = None
    items: List[QuizQuestionOut] = Field(default_factory=list)
