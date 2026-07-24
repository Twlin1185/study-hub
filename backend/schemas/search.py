"""전문 검색 스키마 (F12, 설계 §4.9).

불변 규칙: 정답(answer)은 절대 포함하지 않는다 — title/content/explanation만 인덱싱·노출.
"""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class SearchResultItem(BaseModel):
    document_id: int
    doc_no: str
    type: str
    title: str
    snippet: str  # 매칭 부분을 <mark>...</mark>로 감싼 짧은 발췌
