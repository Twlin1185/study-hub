"""노트(베타) 라우터 — 설계 §4.28 [S33].

CRUD뿐 비즈니스 로직 0(구현 앵커 — "서비스 계층 신설 없음")이라 서비스 계층을 두지
않고 라우터에 직접 구현한다. 채점·SM-2 등 불변 규칙 대상 로직이 전혀 없는 단순
저장소이므로 이 예외가 정당하다.

저장 계약(설계 §4.28 ②③): content_blocks(소스 오브 트루스)와 content(Markdown
파생 프로젝션)는 항상 함께 저장한다 — 서버는 Markdown을 만들지도 해석하지도
않는다. 서버 검증은 얕게(객체·version 정수·blocks 배열)만 한다.
"""
from __future__ import annotations

import json
import re
from typing import Any, Dict, Optional, Tuple

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

import models
from database import get_db
from exceptions import NotFoundError, ValidationAppError
from schemas.common import Page
from schemas.note import NoteCreate, NoteListItem, NoteOut, NoteUpdate

router = APIRouter(prefix="/api/notes", tags=["notes"])

TITLE_MAX_LEN = 200
CONTENT_MAX_LEN = 200_000
BLOCKS_SERIALIZED_MAX_LEN = 1_000_000
EXCERPT_LEN = 200


def _err(reason: str, message: str) -> ValidationAppError:
    return ValidationAppError(message, detail={"reason": reason})


def _check_title(title: str) -> None:
    if len(title) > TITLE_MAX_LEN:
        raise _err("title_too_long", "제목이 너무 깁니다(200자 이하)")


def _validate_blocks_shape(value: Any) -> Dict[str, Any]:
    if not isinstance(value, dict):
        raise _err(
            "blocks_invalid",
            "노트 내용을 저장할 수 없습니다(형식 오류) — 새로고침 후 다시 시도해 주세요",
        )
    version = value.get("version")
    if not isinstance(version, int) or isinstance(version, bool) or version < 1:
        raise _err(
            "blocks_invalid",
            "노트 내용을 저장할 수 없습니다(형식 오류) — 새로고침 후 다시 시도해 주세요",
        )
    blocks = value.get("blocks")
    if not isinstance(blocks, list):
        raise _err(
            "blocks_invalid",
            "노트 내용을 저장할 수 없습니다(형식 오류) — 새로고침 후 다시 시도해 주세요",
        )
    return value


def _check_size(content_blocks: Dict[str, Any], content: str) -> None:
    serialized = json.dumps(content_blocks, ensure_ascii=False)
    if len(serialized) > BLOCKS_SERIALIZED_MAX_LEN or len(content) > CONTENT_MAX_LEN:
        raise _err("too_large", "노트가 너무 큽니다 — 내용을 나눠 주세요")


def _projection_required() -> ValidationAppError:
    return _err(
        "projection_required", "노트 내용과 미리보기 텍스트는 함께 저장해야 합니다"
    )


def _make_excerpt(content: str) -> str:
    collapsed = re.sub(r"\s+", " ", content).strip()
    return collapsed[:EXCERPT_LEN]


def _to_note_out(note: models.Note) -> NoteOut:
    return NoteOut(
        id=note.id,
        title=note.title,
        content_blocks=json.loads(note.content_blocks),
        content=note.content,
        blocks_version=note.blocks_version,
        is_active=bool(note.is_active),
        created_at=note.created_at,
        updated_at=note.updated_at,
    )


def _to_list_item(note: models.Note) -> NoteListItem:
    return NoteListItem(
        id=note.id,
        title=note.title,
        excerpt=_make_excerpt(note.content),
        blocks_version=note.blocks_version,
        is_active=bool(note.is_active),
        created_at=note.created_at,
        updated_at=note.updated_at,
    )


def _get_note_or_404(db: Session, note_id: int) -> models.Note:
    note = db.get(models.Note, note_id)
    if note is None:
        raise NotFoundError("노트를 찾을 수 없습니다")
    return note


def _list_notes(
    db: Session,
    *,
    q: Optional[str],
    include_inactive: bool,
    page: int,
    size: int,
) -> Tuple[list[NoteListItem], int]:
    query = select(models.Note)
    if not include_inactive:
        query = query.where(models.Note.is_active == 1)

    q = (q or "").strip()
    if q:
        like = f"%{q}%"
        query = query.where(
            or_(models.Note.title.like(like), models.Note.content.like(like))
        )

    total = db.execute(select(func.count()).select_from(query.subquery())).scalar_one()

    rows = db.execute(
        query.order_by(models.Note.updated_at.desc())
        .offset((page - 1) * size)
        .limit(size)
    ).scalars().all()

    return [_to_list_item(row) for row in rows], total


@router.get("", response_model=Page[NoteListItem])
def list_notes(
    q: Optional[str] = None,
    include_inactive: bool = False,
    page: int = Query(default=1, ge=1),
    size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
) -> Page[NoteListItem]:
    items, total = _list_notes(
        db, q=q, include_inactive=include_inactive, page=page, size=size
    )
    return Page[NoteListItem](items=items, total=total, page=page, size=size)


@router.post("", response_model=NoteOut)
def create_note(payload: NoteCreate, db: Session = Depends(get_db)) -> NoteOut:
    _check_title(payload.title)

    if payload.content_blocks is None or payload.content is None:
        raise _projection_required()

    blocks = _validate_blocks_shape(payload.content_blocks)
    content = payload.content
    _check_size(blocks, content)

    note = models.Note(
        title=payload.title,
        content_blocks=json.dumps(blocks, ensure_ascii=False),
        content=content,
        blocks_version=blocks["version"],
    )
    db.add(note)
    db.commit()
    db.refresh(note)
    return _to_note_out(note)


@router.get("/{note_id}", response_model=NoteOut)
def get_note(note_id: int, db: Session = Depends(get_db)) -> NoteOut:
    note = _get_note_or_404(db, note_id)
    return _to_note_out(note)


@router.patch("/{note_id}", response_model=NoteOut)
def update_note(note_id: int, payload: NoteUpdate, db: Session = Depends(get_db)) -> NoteOut:
    note = _get_note_or_404(db, note_id)
    data = payload.model_dump(exclude_unset=True)

    has_blocks = "content_blocks" in data
    has_content = "content" in data
    if has_blocks != has_content:
        raise _projection_required()

    if "title" in data:
        title = data["title"] if data["title"] is not None else ""
        _check_title(title)
        note.title = title

    if has_blocks and has_content:
        blocks = _validate_blocks_shape(data["content_blocks"])
        content = data["content"]
        if not isinstance(content, str):
            raise _err(
                "blocks_invalid",
                "노트 내용을 저장할 수 없습니다(형식 오류) — 새로고침 후 다시 시도해 주세요",
            )
        _check_size(blocks, content)
        note.content_blocks = json.dumps(blocks, ensure_ascii=False)
        note.content = content
        note.blocks_version = blocks["version"]

    db.commit()
    db.refresh(note)
    return _to_note_out(note)


@router.delete("/{note_id}", response_model=NoteOut)
def delete_note(note_id: int, db: Session = Depends(get_db)) -> NoteOut:
    """소프트 삭제(불변 규칙 3) — is_active=0 UPDATE만, 물리 삭제 없음. 재삭제 멱등."""
    note = _get_note_or_404(db, note_id)
    if note.is_active:
        note.is_active = 0
        db.commit()
        db.refresh(note)
    return _to_note_out(note)
