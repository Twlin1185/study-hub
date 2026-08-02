"""문서 상호참조 — 임베드 해석 API 요청/응답 스키마 (S17, F43, 설계 §4.19 ③).

**answer·explanation 필드는 의도적으로 존재하지 않는다** — 필터링이 아니라 스키마 부재로
정답 유출 경로를 계약 수준에서 막는다(불변 규칙 1).
"""
from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, field_validator

RESOLVE_EMBEDS_MAX = 50


class ResolveEmbedsRequest(BaseModel):
    doc_nos: List[str]

    @field_validator("doc_nos")
    @classmethod
    def _check_doc_nos(cls, value: List[str]) -> List[str]:
        if not value:
            raise ValueError("doc_nos는 최소 1개 이상이어야 합니다")
        deduped: List[str] = []
        seen = set()
        for item in value:
            if item not in seen:
                seen.add(item)
                deduped.append(item)
        if len(deduped) > RESOLVE_EMBEDS_MAX:
            raise ValueError(
                f"doc_nos는 중복 제거 후 최대 {RESOLVE_EMBEDS_MAX}개까지 요청할 수 있습니다"
            )
        return deduped


class EmbedResolveItem(BaseModel):
    doc_no: str
    found: bool
    id: Optional[int] = None  # 문서 내부 PK — [원문 열기]·링크 칩이 /docs/{id}로 직행하기 위함
    title: Optional[str] = None
    type: Optional[str] = None
    content: Optional[str] = None
    is_active: Optional[bool] = None


class ResolveEmbedsResponse(BaseModel):
    items: List[EmbedResolveItem]
