"""대시보드·통계 라우터 (설계 §4.8)."""
from __future__ import annotations

import datetime as dt
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from database import get_db
from schemas.dashboard import DashboardResponse
from schemas.stats import AccuracyTrendItem, HeatmapItem, WeaknessItem
from services import stats_service

router = APIRouter(tags=["stats"])


@router.get("/api/dashboard", response_model=DashboardResponse)
def get_dashboard(db: Session = Depends(get_db)) -> DashboardResponse:
    return stats_service.get_dashboard(db)


@router.get("/api/stats/heatmap", response_model=List[HeatmapItem])
def get_heatmap(
    from_: Optional[dt.date] = Query(default=None, alias="from"),
    to: Optional[dt.date] = Query(default=None),
    db: Session = Depends(get_db),
) -> List[HeatmapItem]:
    return stats_service.get_heatmap(db, from_, to)


@router.get("/api/stats/weakness", response_model=List[WeaknessItem])
def get_weakness(
    category_id: Optional[int] = None,
    limit: int = Query(default=10, ge=1, le=100),
    db: Session = Depends(get_db),
) -> List[WeaknessItem]:
    return stats_service.get_weakness(db, category_id, limit=limit)


@router.get("/api/stats/accuracy-trend", response_model=List[AccuracyTrendItem])
def get_accuracy_trend(
    days: int = Query(default=30, ge=1, le=365),
    db: Session = Depends(get_db),
) -> List[AccuracyTrendItem]:
    return stats_service.get_accuracy_trend(db, days=days)
