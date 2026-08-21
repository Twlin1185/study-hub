"""웹 임베드 북마크 카드 — 메타데이터 조회 API 스키마 (S37, 설계 §4.30).

서버는 순수 메타 문자열만 반환한다(원시 HTML 렌더 아님). `url` 외 전부 문자열|null —
추출 실패 필드는 null(부분 성공 허용, §4.30 ①).
"""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class WebEmbedPreviewRequest(BaseModel):
    url: str = Field(..., min_length=1)


class WebEmbedPreviewResponse(BaseModel):
    url: str
    title: Optional[str] = None
    description: Optional[str] = None
    site_name: Optional[str] = None
    image: Optional[str] = None
    favicon: Optional[str] = None
    fetched_at: str
