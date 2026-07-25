"""대시보드/통계 비즈니스 로직.

S3: continue + ddays(분류만) + recent. S4: ddays 병합(임의 D-Day) + heatmap +
weakness + 분류 드릴다운(stats) 완성.
"""
from __future__ import annotations

import csv
import datetime as dt
import io
import statistics

from sqlalchemy import func, select
from sqlalchemy.orm import Session

import models
from schemas.dashboard import DashboardResponse, DDayItem, RecentStats
from schemas.stats import AccuracyTrendItem, CategoryStatsItem, HeatmapItem, WeaknessItem
from services import category_service, settings_service, srs_service, study_service
from services.tree_utils import category_path, collect_descendant_ids

HEATMAP_DEFAULT_WEEKS = 12

# 저장 컬럼(answered_at 등)은 SQLite CURRENT_TIMESTAMP(UTC) 기준으로 쌓인다.
# 날짜 경계 집계(히트맵·정답률 추이·최근 N일)는 설계 §3 "서버 로컬(Asia/Seoul)" 기준이어야
# 하므로, SQL 쪽 날짜 추출은 SQLite `date(col, 'localtime')`으로, 파이썬 쪽 경계 계산은
# 로컬 자정을 UTC naive로 환산해서 비교한다. 저장 자체(UTC)는 건드리지 않는다.


def _local_midnight_to_utc_naive(local_date: dt.date) -> dt.datetime:
    """로컬 자정(해당 날짜 00:00, 서버 시스템 tz)을 UTC naive datetime으로 변환.

    Python은 naive datetime에 astimezone()을 호출하면 시스템 로컬 tz로 간주해
    변환한다(3.6+) — 서버가 Asia/Seoul로 설정돼 있다는 전제(설계 §3)와 일치.
    """
    local_naive = dt.datetime.combine(local_date, dt.time.min)
    return local_naive.astimezone(dt.timezone.utc).replace(tzinfo=None)


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
    # 로컬 오늘 포함 최근 7일(달력 기준) — 로컬 자정을 UTC로 환산해 answered_at(UTC)과 비교.
    today_local = dt.date.today()
    since = _local_midnight_to_utc_naive(today_local - dt.timedelta(days=6))
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


def _median_attempt_seconds(db: Session, days: int = 30) -> float | None:
    """최근 N일 문항 풀이 시간(time_spent) 중앙값 — 표본 없으면 None(호출부가 60초 기본값 적용)."""
    since = _local_midnight_to_utc_naive(dt.date.today() - dt.timedelta(days=days - 1))
    values = db.execute(
        select(models.Attempt.time_spent).where(
            models.Attempt.answered_at >= since,
            models.Attempt.time_spent.is_not(None),
        )
    ).scalars().all()
    if not values:
        return None
    return statistics.median(values)


def _today_review_minutes(db: Session, queue_remaining: int) -> int:
    """`today_review_minutes` 대략치 = 큐 잔여 × 최근 30일 문항 시간 중앙값(설계 §4.12).

    표본이 없을 때만(None) 60초/문항 기본값을 쓴다 — median이 0인 경우(극단적으로 빠른
    풀이 표본)까지 기본값으로 덮어써 버리면 안 되므로 `is None`으로 구분한다.
    """
    median = _median_attempt_seconds(db)
    median_seconds = median if median is not None else 60.0
    return round(queue_remaining * median_seconds / 60)


def get_dashboard(db: Session) -> DashboardResponse:
    today_review = srs_service.count_due_today(db)
    return DashboardResponse(
        today_review=today_review,
        continue_=study_service.get_continue_cards(db, limit=3),
        ddays=_ddays(db),
        recent=_recent(db),
        today_review_minutes=_today_review_minutes(db, today_review),
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

    attempt_date = func.date(models.Attempt.answered_at, "localtime")
    attempt_rows = db.execute(
        select(attempt_date, func.count())
        .where(
            attempt_date >= start.isoformat(),
            attempt_date <= end.isoformat(),
        )
        .group_by(attempt_date)
    ).all()
    for date_str, count in attempt_rows:
        counts[date_str] = counts.get(date_str, 0) + count

    completed_date = func.date(models.StudyProgress.completed_at, "localtime")
    completed_rows = db.execute(
        select(completed_date, func.count())
        .where(
            models.StudyProgress.status == "done",
            models.StudyProgress.completed_at.is_not(None),
            completed_date >= start.isoformat(),
            completed_date <= end.isoformat(),
        )
        .group_by(completed_date)
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

    attempt_date = func.date(models.Attempt.answered_at, "localtime")
    rows = db.execute(
        select(
            attempt_date.label("date"),
            func.count().label("attempts"),
            func.sum(models.Attempt.is_correct).label("correct"),
        )
        .where(
            attempt_date >= start.isoformat(),
            attempt_date <= end.isoformat(),
        )
        .group_by(attempt_date)
        .order_by(attempt_date)
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


def export_attempts_csv(db: Session) -> str:
    """attempts 원본 + 문서/분류 메타 조인 CSV (F17, 설계 §4.8)."""
    rows = db.execute(
        select(
            models.Attempt.id,
            models.Attempt.answered_at,
            models.Attempt.document_id,
            models.Document.doc_no,
            models.Document.title,
            models.Document.type,
            models.Attempt.category_id,
            models.Attempt.my_answer,
            models.Attempt.is_correct,
            models.Attempt.time_spent,
            models.Attempt.mode,
        )
        .join(models.Document, models.Document.id == models.Attempt.document_id)
        .order_by(models.Attempt.answered_at)
    ).all()

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "attempt_id",
            "answered_at",
            "document_id",
            "doc_no",
            "title",
            "type",
            "category_id",
            "category_path",
            "my_answer",
            "is_correct",
            "time_spent",
            "mode",
        ]
    )
    for row in rows:
        path = category_path(db, row.category_id) if row.category_id else ""
        writer.writerow(
            [
                row.id,
                row.answered_at.isoformat(sep=" "),
                row.document_id,
                row.doc_no,
                row.title,
                row.type,
                row.category_id or "",
                path,
                row.my_answer or "",
                row.is_correct,
                row.time_spent if row.time_spent is not None else "",
                row.mode or "",
            ]
        )
    return buf.getvalue()


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
