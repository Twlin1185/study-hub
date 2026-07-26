"""대시보드/통계 비즈니스 로직.

S3: continue + ddays(분류만) + recent. S4: ddays 병합(임의 D-Day) + heatmap +
weakness + 분류 드릴다운(stats) 완성.
"""
from __future__ import annotations

import csv
import datetime as dt
import io
import math
import statistics

from sqlalchemy import distinct, func, select
from sqlalchemy.orm import Session

import models
from schemas.dashboard import DashboardResponse, DDayItem, RecentStats
from schemas.stats import (
    AccuracyTrendItem,
    CategoryStatsItem,
    HeatmapItem,
    StreakGoal,
    StreakResponse,
    StreakToday,
    WeaknessItem,
)
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

    분 환산은 **올림**(설계 §4.12 갱신) — 큐가 남아 있는데 "0분"으로 표시돼 아무 것도
    안 걸리는 듯 보이는 것을 방지한다. 큐가 0이면 0분 그대로 유지.
    """
    if queue_remaining <= 0:
        return 0
    median = _median_attempt_seconds(db)
    median_seconds = median if median is not None else 60.0
    return max(1, math.ceil(queue_remaining * median_seconds / 60))


def get_dashboard(db: Session) -> DashboardResponse:
    today_review = srs_service.count_due_today(db)
    return DashboardResponse(
        today_review=today_review,
        continue_=study_service.get_continue_cards(db, limit=3),
        ddays=_ddays(db),
        recent=_recent(db),
        today_review_minutes=_today_review_minutes(db, today_review),
    )


# ---------------------------------------------------------------------------
# 목표·스트릭 (F26, 설계 §4.13) — 전부 파생값(DDL 없음). streak·heatmap이 판정 함수 공유.
# ---------------------------------------------------------------------------
def _goal_config(db: Session) -> tuple[int | None, int | None]:
    """settings goal 키 2개를 양의 정수로 정규화 — None/0/비정수는 '목표 없음'(None)."""

    def _norm(raw) -> int | None:
        try:
            value = int(raw)
        except (TypeError, ValueError):
            return None
        return value if value > 0 else None

    return (
        _norm(settings_service.get_setting(db, "goal.daily_questions", None)),
        _norm(settings_service.get_setting(db, "goal.daily_minutes", None)),
    )


def _evaluate_goal(
    questions: int, minutes: int, q_goal: int | None, m_goal: int | None
) -> bool:
    """설정된 목표 항목 각각 모두 충족(AND). 목표 미설정이면 False (달성 대상 없음)."""
    if q_goal is None and m_goal is None:
        return False
    if q_goal is not None and questions < q_goal:
        return False
    if m_goal is not None and minutes < m_goal:
        return False
    return True


def _daily_questions(db: Session, start: dt.date, end: dt.date) -> dict[str, int]:
    attempt_date = func.date(models.Attempt.answered_at, "localtime")
    rows = db.execute(
        select(attempt_date, func.count())
        .where(attempt_date >= start.isoformat(), attempt_date <= end.isoformat())
        .group_by(attempt_date)
    ).all()
    return {date_str: count for date_str, count in rows}


def _daily_minutes(db: Session, start: dt.date, end: dt.date) -> dict[str, int]:
    """일자별 풀이 시간(분, 올림) = sum(attempts.time_spent) ÷ 60. 개념 열람 시간은 미측정."""
    attempt_date = func.date(models.Attempt.answered_at, "localtime")
    rows = db.execute(
        select(attempt_date, func.sum(models.Attempt.time_spent))
        .where(attempt_date >= start.isoformat(), attempt_date <= end.isoformat())
        .group_by(attempt_date)
    ).all()
    return {
        date_str: math.ceil((total or 0) / 60) for date_str, total in rows
    }


def get_heatmap(
    db: Session, date_from: dt.date | None, date_to: dt.date | None
) -> list[HeatmapItem]:
    """일자별 학습량 = attempts + 개념 완료(study_progress.done) 합산 (설계 §4.8).

    S10(F26): 목표가 하나라도 설정된 경우에만 항목에 `goal_met` 추가 — 현재 목표로 과거를
    재평가하며, streak와 동일한 판정 함수(`_evaluate_goal`)를 공유한다. 목표 미설정이면
    기존 응답(date·count)과 완전히 동일(goal_met은 exclude_none으로 생략)."""
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

    q_goal, m_goal = _goal_config(db)
    goals_set = q_goal is not None or m_goal is not None
    q_by_date = _daily_questions(db, start, end) if goals_set else {}
    m_by_date = _daily_minutes(db, start, end) if goals_set else {}

    items: list[HeatmapItem] = []
    for date_str, count in sorted(counts.items()):
        goal_met = None
        if goals_set:
            goal_met = _evaluate_goal(
                q_by_date.get(date_str, 0), m_by_date.get(date_str, 0), q_goal, m_goal
            )
        items.append(HeatmapItem(date=date_str, count=count, goal_met=goal_met))
    return items


def _activity_date_set(db: Session) -> set[str]:
    """활동일(ISO date 문자열) 전체 집합 = attempts + 개념 완료 (히트맵과 동일 모수)."""
    dates: set[str] = set()
    attempt_date = func.date(models.Attempt.answered_at, "localtime")
    for value in db.execute(select(distinct(attempt_date))).scalars().all():
        if value:
            dates.add(value)
    completed_date = func.date(models.StudyProgress.completed_at, "localtime")
    rows = db.execute(
        select(distinct(completed_date)).where(
            models.StudyProgress.status == "done",
            models.StudyProgress.completed_at.is_not(None),
        )
    ).scalars().all()
    for value in rows:
        if value:
            dates.add(value)
    return dates


def get_streak(db: Session) -> StreakResponse:
    """현재/최고 연속 학습일 + 오늘 목표 진행 (F26, 설계 §4.13) — 전부 파생, 저장 없음."""
    dates = _activity_date_set(db)
    today = dt.date.today()

    # current: 오늘 활동 있으면 오늘부터, 없으면 어제까지의 연속(하루 끝나기 전 끊지 않음)
    current = 0
    cursor = today if today.isoformat() in dates else today - dt.timedelta(days=1)
    while cursor.isoformat() in dates:
        current += 1
        cursor -= dt.timedelta(days=1)

    # best: 전체 이력 최장 연속(전수 스캔)
    best = 0
    if dates:
        ordered = sorted(dt.date.fromisoformat(d) for d in dates)
        run = 1
        best = 1
        for prev, cur in zip(ordered, ordered[1:]):
            if (cur - prev).days == 1:
                run += 1
            else:
                run = 1
            best = max(best, run)

    q_today = _daily_questions(db, today, today).get(today.isoformat(), 0)
    m_today = _daily_minutes(db, today, today).get(today.isoformat(), 0)
    q_goal, m_goal = _goal_config(db)
    goal_met = _evaluate_goal(q_today, m_today, q_goal, m_goal)

    return StreakResponse(
        current_streak=current,
        best_streak=best,
        today=StreakToday(
            questions=q_today,
            minutes=m_today,
            goal=StreakGoal(questions=q_goal, minutes=m_goal),
            goal_met=goal_met,
        ),
    )


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
