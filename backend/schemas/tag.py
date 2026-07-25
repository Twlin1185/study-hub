from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class TagOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    usage_count: int = 0
    # S9(F38, 설계 §4.12) — 이 태그를 tag_query에서 참조하는 규칙 수(태그 관리자 배지)
    rule_count: int = 0


class TagMergeRequest(BaseModel):
    """오타 태그 병합 — from_id의 문서 태그를 to_id로 옮기고 from_id 태그는 삭제한다."""

    from_id: int
    to_id: int


class TagMergeResult(BaseModel):
    merged_documents: int  # 태그가 재배정된 문서 수 (중복 제외)
    removed_tag_id: int


class TagRename(BaseModel):
    """`PATCH /api/tags/{id}` — 이름 변경 (설계 §4.12)."""

    name: str = Field(min_length=1, max_length=100)


class SimilarTagRef(BaseModel):
    id: int
    name: str
    doc_count: int


class SimilarTagPair(BaseModel):
    """`GET /api/tags/similar` 결과 항목 (설계 §4.12)."""

    a: SimilarTagRef
    b: SimilarTagRef
    reason: Literal["space", "case", "edit1"]
