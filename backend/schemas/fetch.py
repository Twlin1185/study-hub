"""사이트 어댑터 반입 스키마 (F35-2, 설계 §4.13)."""
from __future__ import annotations

from typing import Dict, List, Optional

from pydantic import BaseModel, Field

from schemas.convert import EngineChoice


class AdapterInfo(BaseModel):
    id: str
    name: str
    priority: int
    available: bool
    notice: str


class CertSource(BaseModel):
    adapter: str
    cert_ref: str


class CertItem(BaseModel):
    name: str
    sources: List[CertSource] = Field(default_factory=list)


class ExamsRequest(BaseModel):
    sources: List[CertSource] = Field(default_factory=list)


class EstimateInfo(BaseModel):
    questions_assumed: int
    approx_input_tokens: int
    assumed: bool


class ExamItem(BaseModel):
    exam_key: str
    label: str
    adapter: str
    cert_ref: Optional[str] = None
    exam_ref: str
    # 어댑터별 exam_ref 맵(대안 어댑터 재시도용). exam_ref == refs[adapter] (하위 호환).
    refs: Dict[str, str] = Field(default_factory=dict)
    also_on: List[str] = Field(default_factory=list)
    question_count: Optional[int] = None
    imported: bool = False
    estimate: EstimateInfo


class FetchImportRequest(BaseModel):
    adapter: str
    cert_ref: str
    exam_ref: str
    source_url: Optional[str] = None
    engine: EngineChoice = "auto"


class FetchJobStart(BaseModel):
    job_id: str
