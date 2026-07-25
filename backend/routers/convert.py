"""Claude CLI/API 변환 라우터 (F23·F34·F35-1, 설계 §4.10·§4.11).

`POST /api/convert`는 multipart `file` **또는** `url`(폼 필드 혹은 JSON 바디)을 받는다.
`engine`(`auto|cli|api`, 기본 auto)도 폼 필드/JSON 바디로 함께 받을 수 있다.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session
from starlette import status

from database import get_db
from exceptions import ValidationAppError
from schemas.convert import ConvertJobStart, ConvertJobStatus
from services import convert_service

router = APIRouter(prefix="/api/convert", tags=["convert"])

_ENGINE_CHOICES = ("auto", "cli", "api")


@router.post("", response_model=ConvertJobStart, status_code=status.HTTP_202_ACCEPTED)
async def start_convert(request: Request, db: Session = Depends(get_db)) -> ConvertJobStart:
    """multipart(`file` 업로드) 또는 JSON/폼(`url`) 중 하나로 변환 잡을 시작한다.
    url이면 다운로드도 워커에서 처리한다(phase='downloading'부터 잡으로 관리 — 요청
    스레드를 블로킹하지 않는다)."""
    content_type = request.headers.get("content-type", "")
    url: Optional[str] = None
    engine = "auto"
    upload_filename: Optional[str] = None
    upload_bytes: Optional[bytes] = None

    if content_type.startswith("multipart/form-data") or content_type.startswith(
        "application/x-www-form-urlencoded"
    ):
        form = await request.form()
        engine = str(form.get("engine") or "auto")
        raw_url = form.get("url")
        url = raw_url if isinstance(raw_url, str) and raw_url.strip() else None
        file_field = form.get("file")
        if file_field is not None and hasattr(file_field, "read"):
            upload_filename = file_field.filename
            upload_bytes = await file_field.read()
    elif content_type.startswith("application/json"):
        payload = await request.json()
        if not isinstance(payload, dict):
            raise ValidationAppError("요청 본문은 JSON 객체여야 합니다")
        raw_url = payload.get("url")
        url = raw_url if isinstance(raw_url, str) and raw_url.strip() else None
        engine = str(payload.get("engine") or "auto")
    else:
        raise ValidationAppError(
            "지원하지 않는 요청 형식입니다(multipart/form-data 또는 application/json만 허용)",
            detail={"content_type": content_type or None},
        )

    if engine not in _ENGINE_CHOICES:
        raise ValidationAppError("engine은 auto|cli|api 중 하나여야 합니다", detail={"engine": engine})

    if url:
        job_id = convert_service.start_convert_job_from_url(db=db, url=url, engine=engine)
    elif upload_bytes:
        if not upload_filename:
            raise ValidationAppError("업로드 파일명이 비어 있습니다")
        job_id = convert_service.start_convert_job(
            db=db, upload_filename=upload_filename, upload_bytes=upload_bytes, engine=engine
        )
    else:
        raise ValidationAppError("file 업로드 또는 url 중 하나가 필요합니다")

    return ConvertJobStart(job_id=job_id)


@router.get("/{job_id}", response_model=ConvertJobStatus)
def get_convert_status(job_id: str) -> ConvertJobStatus:
    return ConvertJobStatus(**convert_service.get_convert_job(job_id))
