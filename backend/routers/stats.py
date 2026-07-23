"""대시보드·통계 라우터 (설계 §4.8)."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database import get_db
from schemas.dashboard import DashboardResponse
from services import stats_service

router = APIRouter(tags=["stats"])


@router.get("/api/dashboard", response_model=DashboardResponse)
def get_dashboard(db: Session = Depends(get_db)) -> DashboardResponse:
    return stats_service.get_dashboard(db)
