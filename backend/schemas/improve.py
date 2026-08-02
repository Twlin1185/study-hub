"""반입 자기 개선 루프 스키마 (S20 — F46, 설계 §4.22).

저장은 전부 `improve/` 파일(JSON 레코드) — DB 테이블 없음(DDL 0건). 잡 상태는 convert 잡
큐(kind `'improve_proposal'`·`'improve_regression'`)를 재사용하므로 진행·오류 표현은
`schemas.convert`의 `JobProgress`·`ErrorInfo`·`EngineChoice`를 그대로 쓴다.
"""
from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field

from schemas.convert import EngineChoice, ErrorInfo, JobProgress

CaseOrigin = Literal["convert_job", "fetch_job", "gate", "report"]
CaseKind = Literal[
    "parse_failed", "unsupported_format", "invalid_output", "fabrication_suspect", "user_report"
]
ProposalKind = Literal["casebook", "prompt_edit", "code_issue"]
ProposalStatus = Literal["pending", "applied", "rejected", "acknowledged"]
RegressionOutcome = Literal["passed", "still_failing", "failed_differently", "unavailable"]


class CaseSource(BaseModel):
    path: str
    hash12: str
    filename: str


class CaseDocumentRef(BaseModel):
    id: int
    doc_no: str
    title: str


class CaseRegression(BaseModel):
    reg_id: str
    run_at: str
    outcome: RegressionOutcome
    detail: Optional[str] = None


class CaseSummary(BaseModel):
    """cases 목록·상세 공용 — 원문(LLM 산출물)은 담지 않는다(`has_llm_output` bool만).
    목록·상세가 사실상 같은 필드 구성(프론트 `ImproveCaseItem` 단일 타입 전제, §4.22 ①)."""

    case_id: str
    created_at: str
    origin: CaseOrigin
    kind: CaseKind
    count: int
    last_seen_at: str
    engine: Optional[str] = None
    source: Optional[CaseSource] = None
    document: Optional[CaseDocumentRef] = None
    preview_ref: Optional[str] = None
    has_llm_output: bool = False
    detail: Dict[str, Any] = Field(default_factory=dict)
    regressions: List[CaseRegression] = Field(default_factory=list)


CaseDetail = CaseSummary


# --- 제안 생성 파이프라인 (gen) --------------------------------------------------
class GenPrepareRequest(BaseModel):
    case_ids: List[str] = Field(min_length=1, max_length=20)


class GenEstimate(BaseModel):
    approx_input_tokens: int
    assumed: bool


class GenPrepareResult(BaseModel):
    gen_id: str
    case_count: int
    estimate: GenEstimate


class GenGenerateRequest(BaseModel):
    engine: EngineChoice = "auto"


class GenGenerateStart(BaseModel):
    job_id: str


class GenDiscarded(BaseModel):
    reason: str
    count: int


class GenResult(BaseModel):
    proposal_ids: List[str] = Field(default_factory=list)
    discarded: List[GenDiscarded] = Field(default_factory=list)


GenJobStatus = Literal["prepared", "running", "done", "error"]


class GenStatus(BaseModel):
    gen_id: str
    status: GenJobStatus
    error: Optional[str] = None
    error_info: Optional[ErrorInfo] = None
    progress: Optional[JobProgress] = None
    result: Optional[GenResult] = None


# --- 제안함 (proposals) -----------------------------------------------------------
class ProposalSummary(BaseModel):
    proposal_id: str
    kind: ProposalKind
    title: str
    rationale: str
    case_ids: List[str]
    status: ProposalStatus
    created_at: str
    decided_at: Optional[str] = None


class ProposalDetail(ProposalSummary):
    """상세 — kind별 payload는 이미 상세 재료 그대로다(casebook=entry_markdown 전문 ·
    code_issue=repro_markdown 전문). **prompt_edit만** 서버가 적용 미리보기를 추가 합성한다
    (`preview_after`=적용 후 전문, `policy_check`='ok'|'violation') — 나머지 kind는 둘 다 None."""

    payload: Dict[str, Any] = Field(default_factory=dict)
    preview_after: Optional[str] = None
    policy_check: Optional[Literal["ok", "violation"]] = None


class ProposalApplyResult(BaseModel):
    applied: bool
    kind: ProposalKind
    result: Dict[str, Any] = Field(default_factory=dict)


class ProposalRejectResult(BaseModel):
    status: ProposalStatus


# --- 회귀 재검증 (regression) -----------------------------------------------------
class RegPrepareRequest(BaseModel):
    case_ids: List[str] = Field(min_length=1, max_length=10)


class RegPrepareResult(BaseModel):
    reg_id: str
    case_count: int
    estimate: GenEstimate


class RegRunRequest(BaseModel):
    engine: EngineChoice = "auto"


class RegRunStart(BaseModel):
    job_id: str


class RegResultItem(BaseModel):
    case_id: str
    outcome: RegressionOutcome
    detail: Optional[str] = None


RegJobStatus = Literal["prepared", "running", "done", "error"]


class RegStatus(BaseModel):
    reg_id: str
    status: RegJobStatus
    error: Optional[str] = None
    error_info: Optional[ErrorInfo] = None
    progress: Optional[JobProgress] = None
    results: List[RegResultItem] = Field(default_factory=list)
