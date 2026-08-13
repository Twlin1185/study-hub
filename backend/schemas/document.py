from __future__ import annotations

import datetime as dt
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

DOCUMENT_TYPES = {"concept", "question", "past_question", "flashcard"}
RELATION_TYPES = {"explains", "related", "prerequisite"}

# 문서별 스타일 화이트리스트 (M27/F53, 설계 §4.26 ①). bg는 F52 팔레트 7색 이름 —
# 값은 문서 배경용 연한 틴트 토큰 --doc-bg-{색}로 프론트가 매핑(이름 체계 공유·값 분리).
DOC_STYLE_FONTS = {"sans", "serif", "mono"}
DOC_STYLE_SIZES = {"small", "default", "large", "xl"}
DOC_STYLE_BG_NAMES = {"red", "orange", "yellow", "green", "blue", "purple", "gray"}


def _validate_type(value: str) -> str:
    if value not in DOCUMENT_TYPES:
        raise ValueError(
            f"type은 {sorted(DOCUMENT_TYPES)} 중 하나여야 합니다"
        )
    return value


class DocumentStyle(BaseModel):
    """문서별 스타일 — 부분 지정 허용, 화이트리스트 밖 값·미지 키는 422(설계 §4.26 ①)."""

    model_config = ConfigDict(extra="forbid")

    font: Optional[str] = None
    size: Optional[str] = None
    bg: Optional[str] = None

    # 주의: pydantic v2는 필드가 입력에 아예 없을 때는 검증기를 호출하지 않고 기본값
    # None을 그대로 쓴다(부분 지정·해제 없음 = 전역 상속). 반면 `{"font": null}`처럼
    # **명시적으로 null을 보내면 검증기가 호출된다** — 이 값도 화이트리스트 밖이므로
    # 아래에서 그대로 422로 거부한다("해제는 키 생략 또는 style 전체를 null로" — §4.26
    # ①의 "범위 밖 값 = 422"를 하위 키 단위에도 일관 적용. 이 가드가 없으면 null이
    # 그대로 저장되어 DocumentDetail.style: Dict[str, str] 응답 검증에서 500이 난다).
    @field_validator("font")
    @classmethod
    def _check_font(cls, value: Optional[str]) -> str:
        if value not in DOC_STYLE_FONTS:
            raise ValueError(f"font는 {sorted(DOC_STYLE_FONTS)} 중 하나여야 합니다")
        return value

    @field_validator("size")
    @classmethod
    def _check_size(cls, value: Optional[str]) -> str:
        if value not in DOC_STYLE_SIZES:
            raise ValueError(f"size는 {sorted(DOC_STYLE_SIZES)} 중 하나여야 합니다")
        return value

    @field_validator("bg")
    @classmethod
    def _check_bg(cls, value: Optional[str]) -> str:
        if value not in DOC_STYLE_BG_NAMES:
            raise ValueError(f"bg는 {sorted(DOC_STYLE_BG_NAMES)} 중 하나여야 합니다")
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
    # {font?, size?, bg?} | null — null은 전체 해제(설계 §4.26 ①). 필드 자체를 생략하면
    # 기존 값 유지(exclude_unset — 다른 필드와 동일 관례).
    style: Optional[DocumentStyle] = None


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
    # NULL = 미지정(전역 상속). resolve-embeds 응답 스키마(schemas/embed.py)에는
    # 의도적으로 이 필드가 없다 — 임베드 무시가 계약 수준에서 끝난다(설계 §4.26 ②).
    style: Optional[Dict[str, str]] = None
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
