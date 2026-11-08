"""반입 건(import runs) 라우터 (S56 — F63 · M40, 설계 §4.34 ④) — `prefix=/api/import/runs`.

얇게 유지 — 로직은 `services/import_run_service.py`. LLM 0 · 파일 조작 0.
`imports.router`(`/api/import/preview…`·`/commit`·`/answer-key…`)·`split.router`
(`/api/import/split…`)와는 첫 세그먼트가 리터럴(`runs`)이라 경로 충돌이 없다.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from database import get_db
from schemas.common import Page
from schemas.import_runs import (
    ImportRunAdoptRequest,
    ImportRunAdoptResult,
    ImportRunDetail,
    ImportRunDismissResult,
    ImportRunItem,
    ImportRunStatus,
)
from services import import_run_service

router = APIRouter(prefix="/api/import/runs", tags=["import-runs"])


@router.get("", response_model=Page[ImportRunItem])
def list_runs(
    status: Optional[ImportRunStatus] = Query(default=None),
    page: int = Query(default=1, ge=1),
    size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
) -> Page[ImportRunItem]:
    """활성 run 목록 — `updated_at DESC` · §3 페이지네이션 · 라이브 잡 진행은 싣지 않는다
    (클라이언트가 `job_id`로 `GET /api/llm/jobs`와 조인)."""
    items, total = import_run_service.list_runs(db, status, page, size)
    return Page[ImportRunItem](items=items, total=total, page=page, size=size)


@router.post("/adopt", response_model=ImportRunAdoptResult)
def adopt_legacy(payload: ImportRunAdoptRequest, db: Session = Depends(get_db)) -> ImportRunAdoptResult:
    """레거시 localStorage 큐 1회 이관 — 같은 preview_id run 존재 = skip(멱등)."""
    return ImportRunAdoptResult(**import_run_service.adopt_legacy(db, payload.entries))


@router.get("/{run_id}", response_model=ImportRunDetail)
def get_run(run_id: int, db: Session = Depends(get_db)) -> ImportRunDetail:
    """상세 — 타임라인·생성 문서·실패 사례(FB-31)·preview 존재 여부(복구 호출 0)."""
    return ImportRunDetail(**import_run_service.get_detail(db, run_id))


@router.post("/{run_id}/dismiss", response_model=ImportRunDismissResult)
def dismiss_run(run_id: int, db: Session = Depends(get_db)) -> ImportRunDismissResult:
    """[목록에서 지우기] — 소프트(`is_active=0`) · 진행 중 409 `bad_transition` · 없음 404."""
    return ImportRunDismissResult(**import_run_service.dismiss_run(db, run_id))
