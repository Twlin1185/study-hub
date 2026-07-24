"""백업/복원 스키마 (F27, 설계 §4.10)."""
from __future__ import annotations

import datetime as dt

from pydantic import BaseModel, Field


class BackupOut(BaseModel):
    id: str  # 백업 스탬프(파일명 stem) — restore 시 참조
    filename: str
    created_at: dt.datetime
    size_bytes: int


class RestoreRequest(BaseModel):
    """복원 확인 문구 — 프론트가 사용자에게 정확히 이 문자열을 입력하게 한다."""

    confirm: str = Field(min_length=1)


class RestoreResult(BaseModel):
    restored_from: str
    pre_restore_backup: str
