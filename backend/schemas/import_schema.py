"""반입(Import) 관련 Pydantic 스키마.

- 반입 JSON 규격(계획서 §8.2, format_version 1)
- preview / commit 요청·응답 (설계 §4.3)

주의: 개별 문서 항목의 규격 검증은 "전체 실패"가 아니라 "항목별 오류"로 처리해야
(부분 반입 — 설계 §5.9 / DoD 5) 하므로, 반입 JSON의 documents는 여기서 엄격한
Pydantic 모델로 강제하지 않고 raw dict 리스트로 받아 서비스에서 항목별로 검증한다.
"""
from __future__ import annotations

from typing import List, Optional, Union

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# 반입 JSON 규격 (§8.2) — 최상위 봉투
# ---------------------------------------------------------------------------
class ImportSourceInfo(BaseModel):
    filename: Optional[str] = None
    note: Optional[str] = None


class ImportEnvelope(BaseModel):
    """반입 JSON 최상위. documents는 항목별 검증을 위해 raw dict로 받는다."""

    format_version: int
    source: ImportSourceInfo = Field(default_factory=ImportSourceInfo)
    documents: List[dict] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# preview 응답 (설계 §4.3)
# ---------------------------------------------------------------------------
class DuplicateOf(BaseModel):
    id: int
    doc_no: str
    title: str


class SuggestCategoryResult(BaseModel):
    path: str
    category_id: Optional[int] = None
    exists: bool


class SuggestRelationResult(BaseModel):
    doc_no: str
    document_id: Optional[int] = None
    found: bool


class PreviewItem(BaseModel):
    index: int
    title: str
    type: Optional[str] = None
    status: str  # 'ok' | 'duplicate_suspect' | 'error'
    duplicate_of: Optional[DuplicateOf] = None
    suggest_categories: List[SuggestCategoryResult] = Field(default_factory=list)
    suggest_relations: List[SuggestRelationResult] = Field(default_factory=list)
    errors: List[str] = Field(default_factory=list)


class PreviewSource(BaseModel):
    filename: Optional[str] = None
    duplicate_source: bool = False


class PreviewSummary(BaseModel):
    total: int
    ok: int
    duplicate_suspect: int
    error: int


class PreviewResponse(BaseModel):
    preview_id: str
    source: PreviewSource
    summary: PreviewSummary
    items: List[PreviewItem]


# ---------------------------------------------------------------------------
# commit 요청 (설계 §4.3)
# ---------------------------------------------------------------------------
class ImportDecision(BaseModel):
    index: int
    action: str  # 'new' | 'skip' | 'merge'
    merge_into: Optional[int] = None
    # approve_categories: 승인한 분류 제안.
    #  - int  = 기존 분류 category_id (exists:true 제안)
    #  - str  = 생성 승인할 경로 문자열 (exists:false 제안 — commit에서 노드 생성 후 연결)
    approve_categories: List[Union[int, str]] = Field(default_factory=list)
    # approve_relations: 승인한 관계 제안의 기존 문서 document_id 목록
    approve_relations: List[int] = Field(default_factory=list)


class CommitRequest(BaseModel):
    preview_id: str
    decisions: List[ImportDecision] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# commit 응답
# ---------------------------------------------------------------------------
class NewDocumentRef(BaseModel):
    id: int
    doc_no: str
    title: str


class CommitResult(BaseModel):
    created: int
    merged: int
    skipped: int
    new_documents: List[NewDocumentRef] = Field(default_factory=list)
    categories_created: List[str] = Field(default_factory=list)
    relations_created: int = 0
