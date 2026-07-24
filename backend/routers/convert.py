"""Claude CLI 변환 라우터 (F23, 설계 §4.10)."""
from __future__ import annotations

from fastapi import APIRouter, File, UploadFile
from starlette import status

from exceptions import ValidationAppError
from schemas.convert import ConvertJobStart, ConvertJobStatus
from services import convert_service

router = APIRouter(prefix="/api/convert", tags=["convert"])


@router.post("", response_model=ConvertJobStart, status_code=status.HTTP_202_ACCEPTED)
async def start_convert(
    file: UploadFile = File(..., description="변환할 원본 파일(PDF·MD·이미지·엑셀 등)"),
) -> ConvertJobStart:
    if not file.filename:
        raise ValidationAppError("업로드 파일명이 비어 있습니다")
    data = await file.read()
    if not data:
        raise ValidationAppError("업로드 파일 내용이 비어 있습니다")
    job_id = convert_service.start_convert_job(upload_filename=file.filename, upload_bytes=data)
    return ConvertJobStart(job_id=job_id)


@router.get("/{job_id}", response_model=ConvertJobStatus)
def get_convert_status(job_id: str) -> ConvertJobStatus:
    return ConvertJobStatus(**convert_service.get_convert_job(job_id))
