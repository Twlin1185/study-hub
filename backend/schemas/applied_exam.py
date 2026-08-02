"""응용 모의고사 스키마 (S19 — F45, 설계 §4.21).

생성 파이프라인(prepare·generate·상태)과 응시 제출·이력을 담는다. 응시 구성 자체는
기존 `POST /api/exam/session`(`schemas/exam.py`의 `ExamSessionRequest`/`Response`)을
그대로 재사용하므로 이 파일에는 없다(설계 §4.21 — "신규 세션 API 없음").

불변 규칙 1: 이 스키마 어디에도 응시(prepare/generate/상태) 단계에서 정답·해설·근거를
노출하는 필드가 없다 — 정답·해설·`basis`는 제출 이후(`AppliedExamSubmitReport`)에만 실린다.
"""
from __future__ import annotations

import datetime as dt
from typing import List, Literal, Optional

from pydantic import BaseModel, Field

from schemas.convert import EngineChoice, ErrorInfo, JobProgress
from schemas.exam import ExamCut, ExamHistorySubject, ExamSubjectReport, ExamTotal


# --- prepare (LLM 0) ------------------------------------------------------------
class AppliedExamPrepareRequest(BaseModel):
    category_ids: List[int] = Field(min_length=1)
    count: int = Field(ge=1, le=20)


class AppliedExamSourceCounts(BaseModel):
    past_question: int
    question: int
    concept: int


class AppliedExamEstimate(BaseModel):
    """`estimate.approx_input_tokens`·`assumed` — `fetch_service.estimate_usage`/
    `answer_key_service._estimate_usage` 필드 관례(chars/1.5 보정)."""

    approx_input_tokens: int
    assumed: bool


class AppliedExamPrepareResult(BaseModel):
    gen_id: str
    scope_label: str
    source_counts: AppliedExamSourceCounts
    requested_count: int
    estimate: AppliedExamEstimate


# --- generate --------------------------------------------------------------------
class AppliedExamGenerateRequest(BaseModel):
    engine: EngineChoice = "auto"


class AppliedExamGenerateStart(BaseModel):
    job_id: str


# --- 상태 조회 ---------------------------------------------------------------------
class AppliedExamDiscarded(BaseModel):
    reason: Literal[
        "invalid_item",
        "invalid_answer",
        "missing_explanation",
        "bad_basis",
        "duplicate_of_source",
    ]
    count: int


class AppliedExamResult(BaseModel):
    run_category_id: int
    requested: int
    generated: int
    discarded: List[AppliedExamDiscarded] = Field(default_factory=list)
    document_ids: List[int] = Field(default_factory=list)


AppliedExamGenStatus = Literal["prepared", "running", "done", "error"]


class AppliedExamStatus(BaseModel):
    gen_id: str
    status: AppliedExamGenStatus
    # convert 잡 큐(kind='applied_exam') 재사용이라 다른 잡 상태 응답(ConvertJobStatus 등)과
    # 동형으로 `error`(원시 한국어 메시지 — 대개 None, error_info로 충분한 경우가 대부분)도
    # 함께 내려준다(프론트 legacy 폴백 렌더 전례).
    error: Optional[str] = None
    progress: Optional[JobProgress] = None
    error_info: Optional[ErrorInfo] = None
    result: Optional[AppliedExamResult] = None


# --- 제출·리포트 (F25 §4.14 재사용 — 차이는 mode·검증·basis) ------------------------------
class AppliedExamBasisRef(BaseModel):
    """제출 리포트 전용 — document_relations('derived_from')에서 파생(§4.21 결정 ④).
    prepare/generate 단계 응답에는 존재하지 않는다(불변 규칙 1 — 응시 전 힌트 차단)."""

    document_id: int
    doc_no: str
    title: str
    type: str


class AppliedExamResultItem(BaseModel):
    document_id: int
    subject_category_id: int
    is_correct: bool
    my_answer: Optional[str] = None
    answer: Optional[str] = None
    explanation: Optional[str] = None
    review_note_id: Optional[int] = None
    basis: List[AppliedExamBasisRef] = Field(default_factory=list)


class AppliedExamSubmitReport(BaseModel):
    taken_at: dt.datetime
    passed: bool
    cut: ExamCut
    total: ExamTotal
    elapsed_seconds: Optional[int] = None
    subjects: List[ExamSubjectReport] = Field(default_factory=list)
    results: List[AppliedExamResultItem] = Field(default_factory=list)


# --- 이력 ---------------------------------------------------------------------------
class AppliedExamHistoryItem(BaseModel):
    taken_at: dt.datetime
    label: str  # 런 분류 이름(항상 단일 과목 = 런 분류이므로 exam/history의 공통조상 파생 불필요)
    passed: bool
    total: ExamTotal
    subjects: List[ExamHistorySubject] = Field(default_factory=list)
