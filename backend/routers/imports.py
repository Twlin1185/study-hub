"""반입(Import) 라우터 — 얇게 유지. 로직은 services/import_service.py."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy.orm import Session

from database import get_db
from schemas.import_schema import CommitRequest, CommitResult, PreviewResponse
from services import import_service

router = APIRouter(prefix="/api/import", tags=["import"])


@router.post("/preview", response_model=PreviewResponse)
async def preview(
    file: UploadFile = File(..., description="반입 JSON 파일 (§8.2 규격)"),
    source_file: Optional[UploadFile] = File(
        None, description="원본 파일(선택) — sources/에 보관 + SHA-256 중복 감지"
    ),
    db: Session = Depends(get_db),
) -> PreviewResponse:
    json_bytes = await file.read()
    source_bytes: Optional[bytes] = None
    source_filename: Optional[str] = None
    if source_file is not None and source_file.filename:
        source_bytes = await source_file.read()
        source_filename = source_file.filename
    return import_service.create_preview(
        db,
        json_bytes=json_bytes,
        source_filename=source_filename,
        source_bytes=source_bytes,
    )


@router.post("/commit", response_model=CommitResult)
def commit(req: CommitRequest, db: Session = Depends(get_db)) -> CommitResult:
    return import_service.commit_import(db, req)


@router.get("/preview/{preview_id}", response_model=PreviewResponse)
def get_preview(preview_id: str) -> PreviewResponse:
    """캐시된 미리보기 재조회 (설계 §4.3, S6) — convert 잡의 result_preview_id로 접근."""
    return import_service.get_preview(preview_id)
