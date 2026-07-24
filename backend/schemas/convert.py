"""Claude CLI 변환·재생성 잡 스키마 (F23, F30, 설계 §4.10)."""
from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field

JobStatus = Literal["running", "done", "error"]


class ConvertJobStart(BaseModel):
    job_id: str


class ConvertJobStatus(BaseModel):
    job_id: str
    status: JobStatus
    result_preview_id: Optional[str] = None
    error: Optional[str] = None


class RegenerateRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=2000)


class RegenerateJobStart(BaseModel):
    job_id: str


class RegenerateDraft(BaseModel):
    """재생성 초안 — 기존 문서와 나란히 비교할 문서 필드 전체 (id/doc_no/type은 유지되므로 없음)."""

    title: Optional[str] = None
    content: Optional[str] = None
    choices: Optional[List[str]] = None
    answer: Optional[str] = None
    explanation: Optional[str] = None
    difficulty: Optional[int] = None
    tags: List[str] = Field(default_factory=list)


class RegenerateJobStatus(BaseModel):
    job_id: str
    status: JobStatus
    draft: Optional[RegenerateDraft] = None
    error: Optional[str] = None
