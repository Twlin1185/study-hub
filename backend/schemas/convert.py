"""Claude CLI/API 변환·재생성 잡 스키마 (F23, F30, F34 — 설계 §4.10·§4.11)."""
from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field

JobStatus = Literal["running", "done", "error"]
# S10: 'fetching'(사이트 수집·이미지 다운로드) 신설 (설계 §4.13)
JobPhase = Literal[
    "fetching", "downloading", "preparing", "llm_running", "parsing", "preview_building"
]
# S10: 'parse_failed'(사이트 어댑터 파싱 실패) 추가 (설계 §4.13)
ErrorKind = Literal["rate_limit", "auth", "not_installed", "timeout", "parse_failed", "other"]
LimitKind = Literal["session", "daily", "weekly", "model", "overall"]
EngineChoice = Literal["auto", "cli", "api"]


class JobUsage(BaseModel):
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: Optional[float] = None


class JobProgress(BaseModel):
    """잡 진행 가시화 (S8, 설계 §4.11) — 폴링 때마다 서버가 현재 시점 기준으로 재계산해 낸다."""

    phase: JobPhase
    detail: Optional[str] = None
    elapsed_ms: int
    last_activity_at: str
    usage: Optional[JobUsage] = None
    eta_ms: Optional[int] = None


class ErrorInfo(BaseModel):
    """구조화된 오류 — CLI/API 원문(JSON·스택트레이스)은 여기 절대 담기지 않는다."""

    kind: ErrorKind
    limit_kind: Optional[LimitKind] = None
    resets_at: Optional[str] = None
    message: str
    action: str
    fallback_available: bool
    # S10 parse_failed 전용 — 프론트 대안 버튼 힌트('url_import' | 'other_adapter')
    alternatives: Optional[List[str]] = None


class ConvertJobStart(BaseModel):
    job_id: str


class ConvertJobStatus(BaseModel):
    job_id: str
    status: JobStatus
    result_preview_id: Optional[str] = None
    error: Optional[str] = None
    error_info: Optional[ErrorInfo] = None
    progress: Optional[JobProgress] = None


class RegenerateRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=2000)
    engine: EngineChoice = "auto"


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
    error_info: Optional[ErrorInfo] = None
    progress: Optional[JobProgress] = None
