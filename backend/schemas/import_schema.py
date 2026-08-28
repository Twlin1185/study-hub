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
    # 경로가 기존 노드에 전부 매칭되고, 그 최종 노드에 자식 분류가 이미 존재하면 True.
    # (컨테이너 노드에 문서를 직접 붙이는 실수를 프론트가 경고할 수 있도록 하는 신호.
    #  차단/자동 변경은 하지 않음 — commit 동작은 그대로 허용.)
    container: Optional[bool] = None


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
    # S15(F41 — 변환 신뢰 게이트, 설계 §4.17 ⑤·⑥): 'solved_answer' | 'fabrication_suspect'
    # | 'match_unavailable' | 'category_malformed' | 'no_category'(B4-S7/S1 추가). 기본 [].
    # 앞 두 값은 프론트가 **기본 반입 제외**로, 나머지는 배지·안내만 렌더한다. 서버는
    # 신호만 싣는다(이중 구현 금지).
    warnings: List[str] = Field(default_factory=list)
    # B3(설계 §4.3 추기) — 검토 단계 열람·편집용 정규화 본문(기본 None — error 항목,
    # flashcard 등 content 없는 타입은 그대로 null). 정답·해설은 채점 결과가 아니라
    # 반입 원문 그대로다(불변 규칙 1과 무관 — 채점은 quiz/session에만 적용).
    content: Optional[str] = None
    choices: Optional[List[str]] = None
    answer: Optional[str] = None
    explanation: Optional[str] = None


class PreviewSource(BaseModel):
    filename: Optional[str] = None
    duplicate_source: bool = False


class PreviewSummary(BaseModel):
    total: int
    ok: int
    duplicate_suspect: int
    error: int
    # S15(설계 §4.17 ⑤) — 경고가 1개 이상인 항목 수(순수 추가, 기본 0).
    warning: int = 0


class PreviewResponse(BaseModel):
    preview_id: str
    source: PreviewSource
    summary: PreviewSummary
    items: List[PreviewItem]
    # S13(F40-①): 디스크 보존본에서 복구된 미리보기 — 화면 상단 소표기용
    # ("이전 미리보기를 복구했습니다 — 중복 판정은 현재 DB 기준입니다", 설계 §4.3)
    recovered: bool = False


class PreviewMergeRequest(BaseModel):
    """`POST /api/import/preview/merge`(B2-2, 설계 §4.3·§4.25 추기) 요청."""

    preview_ids: List[str] = Field(min_length=2)


# ---------------------------------------------------------------------------
# commit 요청 (설계 §4.3)
# ---------------------------------------------------------------------------
class ItemOverride(BaseModel):
    """B3(설계 §4.3 추기) — 검토 단계 편집분. 값이 있는 필드만 commit 시 얕은 덮어쓰기
    (None = 미변경). 선택지(choices) 구조 편집은 이 단계 범위 밖(§8.3 제외)."""

    title: Optional[str] = None
    content: Optional[str] = None
    answer: Optional[str] = None
    explanation: Optional[str] = None


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
    # B3(설계 §4.3 추기) — 검토 단계 편집분(제목·본문·정답·해설). 기본 None(미편집).
    override: Optional[ItemOverride] = None


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
    # S13(F40-①): 만료된 preview를 디스크 보존본으로 복구한 뒤 커밋했음을 알린다
    # (중복 판정이 최초와 달라졌을 수 있다는 소표기용 — 설계 §4.3)
    recovered: bool = False
