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
# S13: 'invalid_output'(LLM 출력이 완결된 JSON이 아님 — 대개 출력 상한에서 잘림) 추가 (§4.11)
# S14: 'unsupported_format'(첨부에 변환 가능한 PDF 없음 — 원본은 sources/에 저장됨) 추가 (§4.13)
ErrorKind = Literal[
    "rate_limit",
    "auth",
    "not_installed",
    "timeout",
    "parse_failed",
    "invalid_output",
    "unsupported_format",
    "other",
]
LimitKind = Literal["session", "daily", "weekly", "model", "overall"]
# S15(F41): 'auto' 또는 등록 엔진 id('claude-cli'|'claude-api'|'codex-cli'), legacy 별칭
# ('cli'|'api')도 읽기 시 매핑되어 계속 수용된다(설계 §4.17 ③) — 타입은 str로 느슨하게 둔다.
EngineChoice = str


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
    # S15(F41, 설계 §4.17 ③): 다음 폴백 후보 엔진 id — ask 정책의 [다시 시도] 버튼이 이 id로
    # 재요청한다. 후보가 없으면 None(= fallback_available도 False).
    fallback_engine: Optional[str] = None
    # S10 parse_failed 전용 — 프론트 대안 버튼 힌트('url_import' | 'other_adapter')
    alternatives: Optional[List[str]] = None


class ConvertJobStart(BaseModel):
    job_id: str


class ConvertJobStatus(BaseModel):
    job_id: str
    status: JobStatus
    result_preview_id: Optional[str] = None
    # S14: 성공 결과 소표기(예: "도면·과제 묶음(ZIP)도 sources/에 함께 저장했습니다") — 기본 빈 배열
    notes: List[str] = Field(default_factory=list)
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
