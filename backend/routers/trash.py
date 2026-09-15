"""통합 휴지통 라우터 (S52, 설계 §4.32) — `prefix=/api/trash`.

소프트 삭제된 문서·노트 목록 조회(복원 엔드포인트 자체는 각 리소스 라우터에 있다
— `routers/documents.py` `POST /{document_id}/restore`, `routers/notes.py`
`POST /{note_id}/restore`) + 고아 이미지 스캔·이동·되돌리기. 최종 삭제 엔드포인트는
없다(사용자가 `sources/images/.trash/`를 탐색기에서 직접 비운다).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from database import get_db
from schemas.common import Page
from schemas.document import DocumentListItem
from schemas.note import NoteListItem
from schemas.trash import (
    TrashImagesReport,
    TrashImagesRequest,
    TrashMoveResult,
    TrashRestoreResult,
)
from services import document_service, trash_service
from routers.notes import _list_notes

router = APIRouter(prefix="/api/trash", tags=["trash"])


@router.get("/documents", response_model=Page[DocumentListItem])
def list_trash_documents(
    page: int = Query(default=1, ge=1),
    size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
) -> Page[DocumentListItem]:
    items, total = document_service.list_documents(
        db, inactive_only=True, page=page, size=size
    )
    return Page[DocumentListItem](items=items, total=total, page=page, size=size)


@router.get("/notes", response_model=Page[NoteListItem])
def list_trash_notes(
    page: int = Query(default=1, ge=1),
    size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
) -> Page[NoteListItem]:
    items, total = _list_notes(
        db, q=None, include_inactive=False, inactive_only=True, page=page, size=size
    )
    return Page[NoteListItem](items=items, total=total, page=page, size=size)


@router.get("/images", response_model=TrashImagesReport)
def scan_trash_images(
    min_age_days: int = Query(default=7, ge=0, le=365),
    db: Session = Depends(get_db),
) -> TrashImagesReport:
    return TrashImagesReport(**trash_service.scan_images(db, min_age_days=min_age_days))


@router.post("/images/move", response_model=TrashMoveResult)
def move_trash_images(
    payload: TrashImagesRequest, db: Session = Depends(get_db)
) -> TrashMoveResult:
    result = trash_service.move_to_trash(db, payload.filenames)
    return TrashMoveResult(**result)


@router.post("/images/restore", response_model=TrashRestoreResult)
def restore_trash_images(payload: TrashImagesRequest) -> TrashRestoreResult:
    result = trash_service.restore_from_trash(payload.filenames)
    return TrashRestoreResult(**result)
