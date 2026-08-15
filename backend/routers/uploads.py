"""이미지 첨부 업로드 라우터 (F54, 설계 §4.27 — S29).

신규 엔드포인트는 `POST /api/uploads` 1개뿐이다. 채점 없음·DDL 없음 — 파일 시스템
(`sources/images/`)에만 쓴다. 실제 수신·검증·저장 로직은 `services/upload_service.py`.
"""
from __future__ import annotations

from fastapi import APIRouter, Request
from starlette import status

from schemas.upload import UploadResult
from services import upload_service

router = APIRouter(prefix="/api/uploads", tags=["uploads"])


@router.post("", response_model=UploadResult, status_code=status.HTTP_200_OK)
async def upload_image(request: Request) -> UploadResult:
    content_type = request.headers.get("content-type", "")
    url = await upload_service.handle_upload(request, content_type)
    return UploadResult(url=url)
