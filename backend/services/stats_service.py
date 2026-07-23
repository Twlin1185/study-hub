"""대시보드/통계 비즈니스 로직 (S3 1차 — continue + ddays + recent).

heatmap·오늘의 복습(today_review)·주간 약점 분석은 S4/S5 범위.
"""
from __future__ import annotations

import datetime as dt

from sqlalchemy import func, select
from sqlalchemy.orm import Session

import models
from schemas.dashboard import DashboardResponse, DDayItem, RecentStats
from services import study_service


def _ddays(db: Session) -> list[DDayItem]:
    today = dt.date.today()
    rows = db.execute(
        select(models.Category).where(models.Category.exam_date.is_not(None))
    ).scalars().all()
    items = [
        DDayItem(
            category_id=cat.id,
            name=cat.name,
            exam_date=cat.exam_date,
            d_day=(cat.exam_date - today).days,
        )
        for cat in rows
    ]
    items.sort(key=lambda item: item.d_day)
    return items


def _recent(db: Session) -> RecentStats:
    since = dt.datetime.utcnow() - dt.timedelta(days=7)
    total = db.execute(
        select(func.count())
        .select_from(models.Attempt)
        .where(models.Attempt.answered_at >= since)
    ).scalar_one()
    correct = db.execute(
        select(func.count())
        .select_from(models.Attempt)
        .where(models.Attempt.answered_at >= since, models.Attempt.is_correct == 1)
    ).scalar_one()
    accuracy = (correct / total) if total else 0.0
    return RecentStats(attempts_7d=total, accuracy_7d=round(accuracy, 4))


def get_dashboard(db: Session) -> DashboardResponse:
    return DashboardResponse(
        today_review=0,  # S5부터 채움
        continue_=study_service.get_continue_cards(db, limit=3),
        ddays=_ddays(db),
        recent=_recent(db),
    )
