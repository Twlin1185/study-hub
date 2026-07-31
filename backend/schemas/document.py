from __future__ import annotations

import datetime as dt
import re
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

DOCUMENT_TYPES = {"concept", "question", "past_question", "flashcard"}
# 'embeds'는 의도적으로 미포함 — document_relations의 embeds 행은 본문 파싱 파생
# 인덱스 전용(설계 §4.19 ⑤)이며, 관계 API(POST/DELETE relations)로는 만들 수도
# 지울 수도 없어야 한다.
RELATION_TYPES = {"explains", "related", "prerequisite"}

# 참조 키 = doc_no 고정 (설계 §4.19 ①): "DOC-" + 숫자 4자리 이상.
DOC_NO_PATTERN = r"^DOC-\d{4,}$"
_DOC_NO_RE = re.compile(DOC_NO_PATTERN)


def _validate_type(value: str) -> str:
    if value not in DOCUMENT_TYPES:
        raise ValueError(
            f"type은 {sorted(DOCUMENT_TYPES)} 중 하나여야 합니다"
        )
    return value


class DocumentCreate(BaseModel):
    type: str
    title: str = Field(min_length=1, max_length=500)
    content: Optional[str] = None
    choices: Optional[List[str]] = None
    answer: Optional[str] = None
    explanation: Optional[str] = None
    difficulty: Optional[int] = Field(default=None, ge=1, le=5)
    source_id: Optional[int] = None
    source_detail: Optional[str] = None

    _check_type = field_validator("type")(_validate_type)


class DocumentUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=500)
    content: Optional[str] = None
    choices: Optional[List[str]] = None
    answer: Optional[str] = None
    explanation: Optional[str] = None
    difficulty: Optional[int] = Field(default=None, ge=1, le=5)
    source_id: Optional[int] = None
    source_detail: Optional[str] = None


class DocumentListItem(BaseModel):
    id: int
    doc_no: str
    type: str
    title: str
    difficulty: Optional[int]
    is_active: bool
    tags: List[str] = Field(default_factory=list)
    usage_count: int = 0
    bookmarked: bool = False
    created_at: dt.datetime
    updated_at: dt.datetime


class DocumentUsage(BaseModel):
    category_id: int
    path: str
    local_note: Optional[str] = None


class LastAttempt(BaseModel):
    my_answer: Optional[str] = None
    is_correct: bool
    created_at: dt.datetime


class DocumentSrs(BaseModel):
    """문서 상세에 노출하는 SRS 상태 (다음 복습일·EF·간격) — 카드가 있을 때만 (S5)."""

    due_date: Optional[dt.date] = None
    ease_factor: float
    interval_days: int
    repetitions: int


class DocumentStats(BaseModel):
    attempts: int = 0
    accuracy: float = 0.0
    recent: List[bool] = Field(default_factory=list)  # 최근 10회 풀이 정오, 오래된→최신 (S3)
    last_attempt: Optional[LastAttempt] = None
    srs: Optional[DocumentSrs] = None  # 첫 풀이/판정 전에는 null (S5)


class DocumentRelationOut(BaseModel):
    document_id: int
    doc_no: str
    title: str
    type: str
    relation: str
    direction: Literal["from", "to"]  # from=이 문서가 관계를 선언(설명 등) / to=상대가 선언


class EmbeddedByItem(BaseModel):
    """이 문서를 임베드한 문서 (설계 §4.19 ⑤ — 사용처 표시·삭제 경고용, 활성 문서만)."""

    id: int
    doc_no: str
    title: str


class DocumentDetail(BaseModel):
    id: int
    doc_no: str
    type: str
    title: str
    content: Optional[str]
    choices: Optional[List[str]]
    answer: Optional[str]
    explanation: Optional[str]
    difficulty: Optional[int]
    source_id: Optional[int]
    source_detail: Optional[str]
    is_active: bool
    forked_from: Optional[int] = None
    created_at: dt.datetime
    updated_at: dt.datetime
    tags: List[str] = Field(default_factory=list)
    usages: List[DocumentUsage] = Field(default_factory=list)
    relations: List[DocumentRelationOut] = Field(default_factory=list)
    bookmarked: bool = False
    stats: DocumentStats = Field(default_factory=DocumentStats)
    embedded_by: List[EmbeddedByItem] = Field(default_factory=list)


class TagsReplace(BaseModel):
    tags: List[str] = Field(default_factory=list)


class LinkCreate(BaseModel):
    category_id: int
    local_note: Optional[str] = None
    sort_order: Optional[int] = 0


class RelationCreate(BaseModel):
    to_document_id: int
    relation: str = "explains"

    @field_validator("relation")
    @classmethod
    def _check_relation(cls, value: str) -> str:
        if value not in RELATION_TYPES:
            raise ValueError(f"relation은 {sorted(RELATION_TYPES)} 중 하나여야 합니다")
        return value


class ResolveEmbedsRequest(BaseModel):
    """임베드 배치 해석 요청 (설계 §4.19 ③) — doc_no 1~50개, 각 항목 패턴 검증."""

    doc_nos: List[str] = Field(min_length=1, max_length=50)

    @field_validator("doc_nos")
    @classmethod
    def _check_doc_nos(cls, value: List[str]) -> List[str]:
        for doc_no in value:
            if not _DOC_NO_RE.match(doc_no):
                raise ValueError(f"doc_no 형식이 올바르지 않습니다: {doc_no!r}")
        return value


class ResolveEmbedItem(BaseModel):
    """임베드 해석 응답 항목 — answer·explanation·choices 필드 자체가 없다
    (불변 규칙 1 봉인, 설계 §4.19 ③ — 필터링이 아니라 스키마 부재)."""

    doc_no: str
    id: int
    title: str
    type: str
    content: str
    is_active: bool


class ResolveEmbedsResponse(BaseModel):
    items: List[ResolveEmbedItem] = Field(default_factory=list)
    missing: List[str] = Field(default_factory=list)
