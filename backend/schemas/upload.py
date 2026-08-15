"""이미지 첨부 업로드 스키마 (F54, 설계 §4.27)."""
from __future__ import annotations

from pydantic import BaseModel


class UploadResult(BaseModel):
    """`POST /api/uploads` 성공 응답 — 필드는 `url` 하나뿐(YAGNI, §4.27 ②)."""

    url: str
