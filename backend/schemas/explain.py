"""LLM 풀이 생성 스키마 (S18 — F44 ②, 설계 §4.20). F30 재생성(`schemas/convert.py`) 전례를
따르되 draft 필드는 explanation/answer만 담는다 — 문서 전체를 바꾸지 않는다."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel

from schemas.convert import EngineChoice, ErrorInfo, JobProgress


class ExplainRequest(BaseModel):
    engine: EngineChoice = "auto"


class ExplainJobStart(BaseModel):
    job_id: str


class ExplainDraft(BaseModel):
    explanation: str
    answer: Optional[str] = None
    # 설계 §4.20 ② — draft.answer가 채워진 경우(정답 부재 문서에서 함께 산출)만 True.
    answer_included: bool = False


class ExplainJobStatus(BaseModel):
    job_id: str
    status: Literal["running", "done", "error"]
    draft: Optional[ExplainDraft] = None
    explanation_source: Optional[Literal["generated"]] = None
    error: Optional[str] = None
    error_info: Optional[ErrorInfo] = None
    progress: Optional[JobProgress] = None
