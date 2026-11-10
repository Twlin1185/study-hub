"""대용량 원본 LLM 분할 반입 라우터 (S23 — F49, 설계 §4.25).

`POST /api/import/split`는 `routers/convert.py`의 `start_convert`와 같은 이중 수신 게이트
(multipart `file` 업로드 또는 JSON/폼 `url`)를 그대로 따른다(중복 구현 금지 — 판별·추출·
SSRF·MIME은 `convert_service`/`split_service`가 재사용)."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session
from starlette import status

from database import get_db
from exceptions import ValidationAppError
from schemas.split import (
    SplitAnalyzeRequest,
    SplitAnalyzeStart,
    SplitEnqueueRequest,
    SplitEnqueueResult,
    SplitStartResult,
    SplitStateResponse,
)
from services import convert_service, import_run_service, split_service, upload_service

router = APIRouter(prefix="/api/import/split", tags=["import-split"])


@router.post("", response_model=SplitStartResult)
async def start_split(
    request: Request,
    run_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
) -> SplitStartResult:
    """분할 시작 — 동기·LLM 0(§4.25). multipart(`file`) 또는 JSON/폼(`url`) 중 하나.

    S56(F63, 설계 §4.34 ②) — `?run_id=`가 있으면 그 반입 건에 연결(`failed`+`too_large`만 ·
    그 외 409 `bad_transition`), 없으면 소스 종류로 신설 · 상태 `splitting` · `split_started`."""
    if run_id is not None:
        import_run_service.assert_split_attachable(db, run_id)
    content_type = request.headers.get("content-type", "")
    url: Optional[str] = None
    upload_filename: Optional[str] = None
    upload_bytes: Optional[bytes] = None

    if content_type.startswith("multipart/form-data") or content_type.startswith(
        "application/x-www-form-urlencoded"
    ):
        form = await upload_service.parse_form_limited(request, convert_service.MAX_DOWNLOAD_BYTES)
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
    else:
        raise ValidationAppError(
            "지원하지 않는 요청 형식입니다(multipart/form-data 또는 application/json만 허용)",
            detail={"content_type": content_type or None},
        )

    if not url and not upload_bytes:
        raise ValidationAppError("file 업로드 또는 url 중 하나가 필요합니다")

    result = split_service.start_split(
        upload_filename=upload_filename, upload_bytes=upload_bytes, url=url
    )
    clean_url = url.strip() if url else None
    result["run_id"] = import_run_service.note_split_started(
        db,
        run_id=run_id,
        split_id=result["split_id"],
        chunks=len(result.get("chunks") or []),
        kind="convert_url" if clean_url else "convert_file",
        label=f"『{clean_url or upload_filename}』 변환",
        source_name=None if clean_url else upload_filename,
        source_url=clean_url,
    )
    return SplitStartResult(**result)


@router.get("/{split_id}", response_model=SplitStateResponse)
def get_split(split_id: str) -> SplitStateResponse:
    return SplitStateResponse(**split_service.get_state_response(split_id))


@router.post("/{split_id}/analyze", response_model=SplitAnalyzeStart, status_code=status.HTTP_202_ACCEPTED)
def start_analyze(
    split_id: str, payload: SplitAnalyzeRequest, db: Session = Depends(get_db)
) -> SplitAnalyzeStart:
    """LLM 정밀 분석 잡 시작(kind `'split_analyze'`) — 9번째 `assert_engine_selectable`
    적용 지점(§4.23 ⓒ·§4.24 ⓒ·§4.25 개정 표)."""
    run_id = import_run_service.find_run_id_safely(  # S56 — 반입 건 연결(없으면 생략)
        lambda: import_run_service.find_by_split_id(db, split_id)
    )
    job_id = convert_service.start_split_analyze_job(
        db,
        split_id=split_id,
        engine=payload.engine,
        model=payload.model,
        run_id=run_id,
    )
    import_run_service.plant_run_label(db, run_id, [job_id])
    return SplitAnalyzeStart(job_id=job_id)


@router.post("/{split_id}/enqueue", response_model=SplitEnqueueResult)
def enqueue(
    split_id: str, payload: SplitEnqueueRequest, db: Session = Depends(get_db)
) -> SplitEnqueueResult:
    """선택 조각 투입 — 기존 convert 잡 N개 등록(ImportQueue 계약 그대로, §4.25)."""
    run_id = import_run_service.find_run_id_safely(  # S56 — 조각 잡 전부 `_run_id`
        lambda: import_run_service.find_by_split_id(db, split_id)
    )
    result = split_service.enqueue_split(
        db,
        split_id,
        selections=payload.selections,
        category_paths=payload.category_paths,
        run_id=run_id,
    )
    return SplitEnqueueResult(**result)
