"""반입(Import) 라우터 — 얇게 유지. 로직은 services/import_service.py."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, File, Form, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from database import get_db
from schemas.answer_key import (
    AnswerKeyApplyRequest,
    AnswerKeyApplyResult,
    AnswerKeyProcessRequest,
    AnswerKeyProcessStart,
    AnswerKeyStatus,
    AnswerKeyUploadResult,
)
from schemas.import_schema import CommitRequest, CommitResult, PreviewResponse
from services import answer_key_service, import_service

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
def get_preview(preview_id: str, db: Session = Depends(get_db)) -> PreviewResponse:
    """캐시된 미리보기 재조회 (설계 §4.3, S6) — convert 잡의 result_preview_id로 접근.
    S13(F40-①): 캐시 미스(TTL 만료·서버 재시작)면 `import/auto/` 보존본으로 복구한다."""
    return import_service.get_preview(db, preview_id)


@router.get("/preview/{preview_id}/json")
def download_preview_json(preview_id: str) -> FileResponse:
    """보존된 반입 JSON 내려받기 (S13 F40-①, 설계 §4.3) — 최악의 경우에도 사용자가 파일을
    손에 쥐고 "반입 JSON 파일 선택" 경로로 이어갈 수 있게 하는 탈출구. 없으면 404."""
    path = import_service.preserved_json_path(preview_id)
    return FileResponse(
        path,
        media_type="application/json",
        filename=path.name,  # Content-Disposition: attachment
    )


# ---------------------------------------------------------------------------
# 답지·해설지 반입 (S18 — F44 ①, 설계 §4.20) — 로직은 services/answer_key_service.py
# ---------------------------------------------------------------------------
@router.post("/answer-key", response_model=AnswerKeyUploadResult)
async def upload_answer_key(
    file: UploadFile = File(..., description="답지·해설지 원본"),
    category_id: int = Form(...),
    db: Session = Depends(get_db),
) -> AnswerKeyUploadResult:
    """판별·추출만 수행(LLM 호출 0·비용 0). C군·판별 불가는 §3 에러(422)로 즉시 반환."""
    data = await file.read()
    return answer_key_service.upload_answer_key(
        db, filename=file.filename or "answer_key", data=data, category_id=category_id
    )


@router.post(
    "/answer-key/{key_id}/process",
    response_model=AnswerKeyProcessStart,
    status_code=status.HTTP_202_ACCEPTED,
)
def process_answer_key(
    key_id: str, payload: AnswerKeyProcessRequest, db: Session = Depends(get_db)
) -> AnswerKeyProcessStart:
    """LLM 가공 잡 시작(convert 잡 큐 재사용 — kind='answer_key', 동시 1개)."""
    job_id = answer_key_service.start_processing(db, key_id, engine=payload.engine)
    return AnswerKeyProcessStart(job_id=job_id)


@router.get("/answer-key/{key_id}", response_model=AnswerKeyStatus)
def get_answer_key(key_id: str, db: Session = Depends(get_db)) -> AnswerKeyStatus:
    """상태·미리보기 조회 — 서버 결정론 매칭 + 기계 검증(원문 대조·choices 번호 검증)."""
    return answer_key_service.get_status(db, key_id)


@router.post("/answer-key/{key_id}/apply", response_model=AnswerKeyApplyResult)
def apply_answer_key(
    key_id: str, payload: AnswerKeyApplyRequest, db: Session = Depends(get_db)
) -> AnswerKeyApplyResult:
    """선택 문항만 병합(유일한 병합 쓰기 경로) — 빈 필드만 채움, 멱등."""
    return answer_key_service.apply_answer_key(db, key_id, payload.document_ids)
