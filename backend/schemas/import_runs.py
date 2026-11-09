"""반입 건(import runs) 응답 스키마 (S56 — F63, 설계 §4.34 ④).

id·수치·서버 완성 문구만 싣는다 — 정답·해설·LLM 산출 원문 필드 0(불변 규칙 1).
`summary`는 구조화 필드로 노출한다(raw `summary_json` 문자열 노출 0).
"""
from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

ImportRunKind = Literal["convert_file", "convert_url", "fetch", "json_upload", "answer_key"]
ImportRunStatus = Literal[
    "queued",
    "converting",
    "splitting",
    "review_ready",
    "committing",
    "committed",
    "failed",
    "cancelled",
    "expired",
]


class ImportRunPreviewRef(BaseModel):
    preview_id: str
    chunk_index: Optional[int] = None  # 분할 조각 순번(1부터) — 비분할은 null
    committed_at: Optional[str] = None


class ImportRunCommit(BaseModel):
    preview_id: Optional[str] = None
    created: int = 0
    merged: int = 0
    skipped: int = 0
    errored: int = 0
    document_ids: List[int] = Field(default_factory=list)
    category_ids: List[int] = Field(default_factory=list)


class ImportRunFetchRequest(BaseModel):
    """사이트 반입 run의 시작 요청 값 — [다시 시도](새 run 재제출) 근거."""

    adapter: Optional[str] = None
    cert_ref: Optional[str] = None
    exam_ref: Optional[str] = None
    source_url: Optional[str] = None
    exam_key: Optional[str] = None


class ImportRunSummary(BaseModel):
    previews: List[ImportRunPreviewRef] = Field(default_factory=list)
    commits: List[ImportRunCommit] = Field(default_factory=list)
    document_ids: List[int] = Field(default_factory=list)
    category_ids: List[int] = Field(default_factory=list)
    # 분할 run 전용 — 투입 조각 수 N(카드 "조각 k/N")·실패·취소로 끝난 조각 수.
    chunks_total: Optional[int] = None
    chunks_failed: Optional[int] = None
    fetch_request: Optional[ImportRunFetchRequest] = None


class ImportRunLastEvent(BaseModel):
    type: str
    message: str
    at: Optional[str] = None


class ImportRunItem(BaseModel):
    id: int
    kind: ImportRunKind
    label: str
    source_name: Optional[str] = None
    source_url: Optional[str] = None
    category_path: Optional[str] = None
    status: ImportRunStatus
    job_id: Optional[str] = None
    preview_id: Optional[str] = None
    split_id: Optional[str] = None
    answer_key_id: Optional[str] = None
    error_kind: Optional[str] = None
    error_message: Optional[str] = None
    summary: ImportRunSummary
    is_active: bool
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    committed_at: Optional[str] = None
    last_event: Optional[ImportRunLastEvent] = None
    preview_available: Optional[bool] = None


class ImportRunEventItem(BaseModel):
    id: int
    type: str
    message: str
    at: Optional[str] = None
    detail: Optional[Dict[str, Any]] = None  # id·수치만(job_id·preview_id·chunk_index·counts)


class ImportRunDocument(BaseModel):
    id: int
    doc_no: str
    title: str
    is_active: bool


class ImportRunFailureCase(BaseModel):
    case_id: str
    kind: Optional[str] = None
    count: int = 1
    last_seen_at: Optional[str] = None


class ImportRunDetail(BaseModel):
    run: ImportRunItem
    events: List[ImportRunEventItem]
    documents: List[ImportRunDocument]
    failure_cases: List[ImportRunFailureCase]
    preview_available: bool


class ImportRunDismissResult(BaseModel):
    id: int
    is_active: bool


class ImportRunAdoptRequest(BaseModel):
    """레거시 localStorage 큐(프론트 `StoredQueueEntry[]`) — 느슨 검증(항목은 dict면 수용 ·
    미지 필드 무시 — 판정은 서비스가 `previewId`·`committed`만 본다)."""

    model_config = ConfigDict(extra="ignore")

    entries: List[Dict[str, Any]]


class ImportRunAdoptResult(BaseModel):
    created: int
    skipped: int
