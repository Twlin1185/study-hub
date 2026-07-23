"""설정 라우터 (설계 §4.10) — 키-값 일괄 조회/저장."""
from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Body, Depends
from sqlalchemy.orm import Session

from database import get_db
from services import settings_service

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("", response_model=Dict[str, Any])
def get_settings(db: Session = Depends(get_db)) -> Dict[str, Any]:
    return settings_service.get_all_settings(db)


@router.put("", response_model=Dict[str, Any])
def put_settings(
    payload: Dict[str, Any] = Body(...), db: Session = Depends(get_db)
) -> Dict[str, Any]:
    return settings_service.update_settings(db, payload)
