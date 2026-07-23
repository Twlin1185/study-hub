"""대시보드/통계 비즈니스 로직.

S3: continue + ddays(분류만) + recent. S4: ddays 병합(임의 D-Day) + heatmap +
weakness + 분류 드릴다운(stats) 완성.
"""
from __future__ import annotations

import datetime as dt

from sqlalchemy import func, select
from sqlalchemy.orm import Session

import models
from schemas.dashboard import DashboardResponse, DDayItem, RecentStats
from schemas.stats import AccuracyTrendItem, CategoryStatsItem, HeatmapItem, WeaknessItem
from services import category_service, settings_service, study_service
from services.tree_utils import category_path, collect_descendant_ids

HEATMAP_DEFAULT_WEEKS = 12


def _category_ddays(db: Session, today: dt.date) -> list[DDayItem]:
    rows = db.execute(
        select(models.Category).where(models.Category.exam_date.is_not(None))
    ).scalars().all()
    return [
        DDayItem(
            kind="category",
            category_id=cat.id,
            id=None,
            name=cat.name,
            exam_date=cat.exam_date,
            d_day=(cat.exam_date - today).days,
        )
        for cat in rows
    ]


def _custom_ddays(db: Session, today: dt.date) -> list[DDayItem]:
    """settings:ddays.custom = [{id, label, date}] — 분류와 무관한 임의 D-Day."""
    raw = settings_service.get_setting(db, "ddays.custom", [])
    if not isinstance(raw, list):
        return []

    items: list[DDayItem] = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        entry_id = entry.get("id")
        label = entry.get("label")
        date_str = entry.get("date")
        if not entry_id or not label or not date_str:
            continue
        try:
            exam_date = dt.date.fromisoformat(str(date_str))
        except ValueError:
            continue
        items.append(
            DDayItem(
                kind="custom",
                category_id=None,
                id=str(entry_id),
                name=str(label),
                exam_date=exam_date,
                d_day=(exam_date - today).days,
            )
        )
    return items


def _ddays(db: Session) -> list[DDayItem]:
    today = dt.date.today()
    items = _category_ddays(db, today) + _custom_ddays(db, today)
    items = [item for item in items if item.d_day >= 0]  # 지난 날짜는 제외
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


def get_heatmap(
    db: Session, date_from: dt.date | None, date_to: dt.date | None
) -> list[HeatmapItem]:
    """일자별 학습량 = attempts + 개념 완료(study_progress.done) 합산 (설계 §4.8)."""
    end = date_to or dt.date.today()
    start = date_from or (end - dt.timedelta(weeks=HEATMAP_DEFAULT_WEEKS) + dt.timedelta(days=1))
    if start > end:
        start, end = end, start

    counts: dict[str, int] = {}

    attempt_rows = db.execute(
        select(func.date(models.Attempt.answered_at), func.count())
        .where(
            func.date(models.Attempt.answered_at) >= start.isoformat(),
            func.date(models.Attempt.answered_at) <= end.isoformat(),
        )
        .group_by(func.date(models.Attempt.answered_at))
    ).all()
    for date_str, count in attempt_rows:
        counts[date_str] = counts.get(date_str, 0) + count

    completed_rows = db.execute(
        select(func.date(models.StudyProgress.completed_at), func.count())
        .where(
            models.StudyProgress.status == "done",
            models.StudyProgress.completed_at.is_not(None),
            func.date(models.StudyProgress.completed_at) >= start.isoformat(),
            func.date(models.StudyProgress.completed_at) <= end.isoformat(),
        )
        .group_by(func.date(models.StudyProgress.completed_at))
    ).all()
    for date_str, count in completed_rows:
        counts[date_str] = counts.get(date_str, 0) + count

    return [
        HeatmapItem(date=date_str, count=count)
        for date_str, count in sorted(counts.items())
    ]


def get_accuracy_trend(db: Session, days: int = 30) -> list[AccuracyTrendItem]:
    """일자별 정답률 시계열 — 풀이(attempts)가 있는 날만 포함, 날짜 오름차순 (설계 §4.8)."""
    end = dt.date.today()
    start = end - dt.timedelta(days=days - 1)

    rows = db.execute(
        select(
            func.date(models.Attempt.answered_at).label("date"),
            func.count().label("attempts"),
            func.sum(models.Attempt.is_correct).label("correct"),
        )
        .where(
            func.date(models.Attempt.answered_at) >= start.isoformat(),
            func.date(models.Attempt.answered_at) <= end.isoformat(),
        )
        .group_by(func.date(models.Attempt.answered_at))
        .order_by(func.date(models.Attempt.answered_at))
    ).all()

    return [
        AccuracyTrendItem(
            date=date_str,
            attempts=attempts,
            correct=correct or 0,
            accuracy=round((correct / attempts), 4) if attempts else 0.0,
        )
        for date_str, attempts, correct in rows
    ]


def _first_category_path(db: Session, document_id: int) -> str | None:
    category_id = db.execute(
        select(models.CategoryDocument.category_id)
        .where(models.CategoryDocument.document_id == document_id)
        .order_by(models.CategoryDocument.category_id)
        .limit(1)
    ).scalar_one_or_none()
    if category_id is None:
        return None
    return category_path(db, category_id)


def get_weakness(
    db: Session, category_id: int | None, limit: int = 10, min_attempts: int = 3
) -> list[WeaknessItem]:
    """누적 정답률 하위 Top N 문서 (최소 시도 수 필터 — 설계 §4.8)."""
    query = (
        select(
            models.Attempt.document_id,
            func.count().label("attempts"),
            func.sum(models.Attempt.is_correct).label("correct"),
        )
        .group_by(models.Attempt.document_id)
        .having(func.count() >= min_attempts)
    )

    if category_id is not None:
        category_service.get_category_or_404(db, category_id)
        descendant_ids = collect_descendant_ids(db, category_id)
        linked_ids = select(models.CategoryDocument.document_id).where(
            models.CategoryDocument.category_id.in_(descendant_ids)
        )
        query = query.where(models.Attempt.document_id.in_(linked_ids))

    rows = db.execute(query).all()
    if not rows:
        return []

    scored = [
        (doc_id, attempts, correct, (correct / attempts) if attempts else 0.0)
        for doc_id, attempts, correct in rows
    ]
    scored.sort(key=lambda row: (row[3], -row[1]))
    scored = scored[:limit]

    doc_ids = [row[0] for row in scored]
    documents = db.execute(
        select(models.Document).where(models.Document.id.in_(doc_ids))
    ).scalars().all()
    by_id = {doc.id: doc for doc in documents}

    items: list[WeaknessItem] = []
    for doc_id, attempts, correct, accuracy in scored:
        doc = by_id.get(doc_id)
        if doc is None:
            continue
        items.append(
            WeaknessItem(
                document_id=doc.id,
                doc_no=doc.doc_no,
                title=doc.title,
                type=doc.type,
                category_path=_first_category_path(db, doc.id),
                attempts=attempts,
                accuracy=round(accuracy, 4),
            )
        )
    return items


def get_category_children_stats(db: Session, category_id: int) -> list[CategoryStatsItem]:
    """직계 자식별 진도·정답률·시도 수 (대시보드 드릴다운 — 설계 §4.1)."""
    category_service.get_category_or_404(db, category_id)

    children = db.execute(
        select(models.Category)
        .where(models.Category.parent_id == category_id)
        .order_by(models.Category.sort_order, models.Category.id)
    ).scalars().all()

    progress_map = category_service.subtree_progress(db)

    items: list[CategoryStatsItem] = []
    for child in children:
        done, total = progress_map.get(child.id, (0, 0))
        descendant_ids = collect_descendant_ids(db, child.id)

        attempt_count = db.execute(
            select(func.count())
            .select_from(models.Attempt)
            .where(models.Attempt.category_id.in_(descendant_ids))
        ).scalar_one()
        correct_count = db.execute(
            select(func.count())
            .select_from(models.Attempt)
            .where(
                models.Attempt.category_id.in_(descendant_ids),
                models.Attempt.is_correct == 1,
            )
        ).scalar_one()
        accuracy = (correct_count / attempt_count) if attempt_count else 0.0

        items.append(
            CategoryStatsItem(
                category_id=child.id,
                name=child.name,
                progress=(done / total) if total else None,
                accuracy=round(accuracy, 4),
                attempt_count=attempt_count,
            )
        )
    return items
