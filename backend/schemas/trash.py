"""통합 휴지통 스키마 (S52, 설계 §4.32).

문서·노트 목록은 기존 `DocumentListItem`·`NoteListItem`·`Page`를 재사용한다(여기서는
고아 이미지 스캔·이동·되돌리기 계약만 정의).
"""
from __future__ import annotations

from typing import List

from pydantic import BaseModel, Field, field_validator


class TrashImageEntry(BaseModel):
    filename: str
    bytes: int
    modified_at: str


class TrashImagesReport(BaseModel):
    orphans: List[TrashImageEntry]
    trashed: List[TrashImageEntry]
    total_files: int
    referenced: int
    recent_skipped: int
    other_files: int
    trash_dir: str
    min_age_days: int


class TrashImagesRequest(BaseModel):
    """이동·되돌리기 공용 요청 본문 — `filenames` 1~500 · 서버가 중복 제거."""

    filenames: List[str] = Field(min_length=1, max_length=500)

    @field_validator("filenames")
    @classmethod
    def _dedup(cls, value: List[str]) -> List[str]:
        return list(dict.fromkeys(value))


class TrashMoveResult(BaseModel):
    moved: int
    skipped: int


class TrashRestoreResult(BaseModel):
    restored: int
    skipped: int
