"""답지·해설지 반입 스키마 (S18 — F44 ①, 설계 §4.20)."""
from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field

from schemas.convert import EngineChoice, ErrorInfo, JobProgress


class AnswerKeyProcessRequest(BaseModel):
    engine: EngineChoice = "auto"
    # S22(F48 ④·ⓒ) — 요청 단위 모델 오버라이드(선택). 검증은 서버 공통 헬퍼
    # (`assert_engine_selectable`)가 수행 — 여기서는 통과만 시킨다.
    model: Optional[str] = None


class AnswerKeyEstimate(BaseModel):
    """`estimate.approx_input_tokens`·`assumed` — `fetch_service.estimate_usage` 필드 관례."""

    approx_input_tokens: int
    assumed: bool


class AnswerKeyTarget(BaseModel):
    """대상 범위(`category_id` 하위 포함)의 문제 타입·`is_active=1` 문서 집계."""

    question_total: int
    missing_answer: int
    missing_explanation: int


class AnswerKeyUploadResult(BaseModel):
    key_id: str
    filename: str
    file_type: Optional[str] = None
    extract_available: bool
    extracted_chars: int
    target: AnswerKeyTarget
    estimate: AnswerKeyEstimate


class AnswerKeyProcessStart(BaseModel):
    job_id: str


class AnswerKeyCurrent(BaseModel):
    has_answer: bool
    has_explanation: bool


class AnswerKeyProposed(BaseModel):
    answer: Optional[str] = None
    explanation: Optional[str] = None


AnswerKeyConflict = Literal["answer_exists", "explanation_exists"]
AnswerKeyWarning = Literal["fabrication_suspect", "match_unavailable"]


class AnswerKeyMatchedItem(BaseModel):
    document_id: int
    doc_no: str
    title: str
    no: int
    current: AnswerKeyCurrent
    proposed: AnswerKeyProposed
    conflicts: List[AnswerKeyConflict] = Field(default_factory=list)
    warnings: List[AnswerKeyWarning] = Field(default_factory=list)


class AnswerKeyUnmatchedNumber(BaseModel):
    no: int
    reason: Literal["no_document", "ambiguous"]


class AnswerKeyUnmatchedDocument(BaseModel):
    document_id: int
    doc_no: str
    title: str
    reason: Literal["no_number", "ambiguous", "no_item"]


class AnswerKeyUnmatched(BaseModel):
    numbers: List[AnswerKeyUnmatchedNumber] = Field(default_factory=list)
    documents: List[AnswerKeyUnmatchedDocument] = Field(default_factory=list)


# S22(F48 ②) — 'cancelled' 순수 추가(기존 값·필드 불변, 설계 §4.24 ⓑ).
AnswerKeyJobStatus = Literal["uploaded", "running", "done", "error", "cancelled"]


class AnswerKeyStatus(BaseModel):
    """`GET /api/import/answer-key/{key_id}` 응답 — 업로드 메타 + 잡 상태 + 미리보기."""

    key_id: str
    status: AnswerKeyJobStatus
    filename: str
    file_type: Optional[str] = None
    extract_available: bool
    extracted_chars: int
    target: AnswerKeyTarget
    estimate: AnswerKeyEstimate
    error: Optional[str] = None
    error_info: Optional[ErrorInfo] = None
    progress: Optional[JobProgress] = None
    matched: List[AnswerKeyMatchedItem] = Field(default_factory=list)
    unmatched: Optional[AnswerKeyUnmatched] = None


class AnswerKeyApplyRequest(BaseModel):
    document_ids: List[int] = Field(default_factory=list)


class AnswerKeySkipped(BaseModel):
    document_id: int
    reason: str


class AnswerKeyApplyResult(BaseModel):
    updated: int
    skipped: List[AnswerKeySkipped] = Field(default_factory=list)
