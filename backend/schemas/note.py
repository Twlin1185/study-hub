"""노트(베타) 스키마 — 설계 §4.28 [S33].

`content_blocks`는 의도적으로 `Any` 타입이다: 서버는 블록 내부 구조를 딥 검증하지
않는다(정본은 frontend/src/editor2/schema/blocks.ts) — 얕은 형태 검증(객체·version·
blocks)은 routers/notes.py에서 수행해 detail.reason을 정확히 통제한다.
"""
from __future__ import annotations

import datetime as dt
from typing import Any, Dict, Optional

from pydantic import BaseModel


class NoteCreate(BaseModel):
    title: str = ""
    content_blocks: Optional[Any] = None
    content: Optional[str] = None


class NoteUpdate(BaseModel):
    title: Optional[str] = None
    content_blocks: Optional[Any] = None
    content: Optional[str] = None


class NoteOut(BaseModel):
    id: int
    title: str
    content_blocks: Dict[str, Any]
    content: str
    blocks_version: int
    is_active: bool
    created_at: dt.datetime
    updated_at: dt.datetime


class NoteListItem(BaseModel):
    id: int
    title: str
    excerpt: str
    blocks_version: int
    is_active: bool
    created_at: dt.datetime
    updated_at: dt.datetime
