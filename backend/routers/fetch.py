"""사이트 어댑터 반입 라우터 (F35-2, 설계 §4.13, [S10]).

수집기(어댑터)만 신규 — LLM 정리·진행·미리보기·중복·분류 생성·승인은 전부 기존
convert 잡 큐·import preview/commit 재사용. 라우터는 얇게 유지한다.
"""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from starlette import status

from database import get_db
from schemas.fetch import (
    AdapterInfo,
    CertItem,
    ExamItem,
    ExamsRequest,
    FetchImportRequest,
    FetchJobStart,
    QnetKeyRequest,
    QnetKeyResponse,
)
from services import convert_service, fetch_service, import_run_service, qnet_api

router = APIRouter(prefix="/api/fetch", tags=["fetch"])


@router.get("/adapters", response_model=List[AdapterInfo])
def list_adapters() -> List[AdapterInfo]:
    return [AdapterInfo(**a) for a in fetch_service.list_adapters()]


@router.get("/certs", response_model=List[CertItem])
def search_certs(q: str = Query(default="", max_length=100)) -> List[CertItem]:
    return [CertItem(**c) for c in fetch_service.search_certs(q)]


@router.post("/exams", response_model=List[ExamItem])
def list_exams(payload: ExamsRequest, db: Session = Depends(get_db)) -> List[ExamItem]:
    sources = [s.model_dump() for s in payload.sources]
    return [
        ExamItem(**e)
        for e in fetch_service.list_exams(db, sources, include_notices=payload.include_notices)
    ]


@router.post("/qnet-key", response_model=QnetKeyResponse)
def register_qnet_key(payload: QnetKeyRequest) -> QnetKeyResponse:
    """서비스키 즉석 검증 후 등록(F34 `llm/api-key` 계약 미러) — 응답은 suffix만.
    검증 실패 시 저장하지 않고 422 + 사람 말 사유(원문 응답 미노출)."""
    suffix = qnet_api.save_service_key(payload.key)
    return QnetKeyResponse(key_registered=True, key_suffix=suffix)


@router.delete("/qnet-key", response_model=QnetKeyResponse)
def delete_qnet_key() -> QnetKeyResponse:
    """삭제 — 이후 qnet은 `available:false` 스텁 동작으로 복귀한다."""
    qnet_api.delete_service_key()
    return QnetKeyResponse(key_registered=False, key_suffix=None)


@router.post("/import", response_model=FetchJobStart, status_code=status.HTTP_202_ACCEPTED)
def start_import(payload: FetchImportRequest, db: Session = Depends(get_db)) -> FetchJobStart:
    # S56(F63, 설계 §4.34 ②) — 반입 건(run) 생성 + 응답 run_id 가산. `source_name` = 회차 라벨.
    job_id, run_id = import_run_service.start_with_run(
        db,
        lambda rid: convert_service.start_fetch_job(
            db=db,
            adapter_id=payload.adapter,
            cert_ref=payload.cert_ref,
            exam_ref=payload.exam_ref,
            source_url=payload.source_url,
            engine=payload.engine,
            exam_key=payload.exam_key,
            model=payload.model,
            run_id=rid,
        ),
        kind="fetch",
        label=f"『{payload.cert_ref} {payload.exam_ref}』 사이트 반입",
        status="queued",
        source_name=f"{payload.cert_ref} {payload.exam_ref}",
        summary=import_run_service.fetch_summary(
            adapter=payload.adapter,
            cert_ref=payload.cert_ref,
            exam_ref=payload.exam_ref,
            source_url=payload.source_url,
            exam_key=payload.exam_key,
        ),
    )
    return FetchJobStart(job_id=job_id, run_id=run_id)
