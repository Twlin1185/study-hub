"""복습(SRS) 비즈니스 로직 — SM-2 적용 · 오늘의 복습 큐 (설계 §4.7, 계획서 §10).

`apply_sm2`는 attempts 트랜잭션(불변 규칙 2)에서도, 플래시카드 srs/answer 경로에서도
공용으로 쓰인다 — **커밋하지 않는다**(호출자가 트랜잭션 경계를 소유).

날짜: due_date·"오늘" 경계는 서버 로컬(Asia/Seoul, 설계 §3) 날짜 기준. 서버가 Asia/Seoul로
설정돼 있다는 전제 하에 dt.date.today()가 로컬 오늘이다(stats_service와 동일 규약).
저장 타임스탬프(last_reviewed)는 다른 컬럼과 마찬가지로 UTC naive로 남긴다.

S11(F16, 설계 §4.14) — D-Day 복습 강도 조절은 **큐 구성 계층**만 손댄다. 발동 판정·유효
상한의 순수 로직은 `services/dday_boost.py`에 있고, 이 모듈은 그 함수에 넘길 후보
(categories.exam_date + 설정 토글)를 DB에서 뽑아주는 접합부(`_resolve_boost`)만 담당한다.
`get_today_queue`(큐) · `count_due_today`(대시보드 today_review) · `get_summary`가 전부
`_resolve_boost`를 공유해 세 곳의 수치가 어긋나지 않는다. `services/sm2.py`·`srs_cards`
저장값(EF·interval·due_date)은 이 확장이 절대 건드리지 않는다.
"""
from __future__ import annotations

import datetime as dt
import json
from dataclasses import dataclass
from typing import List, Optional, Set

from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session

import models
from exceptions import NotFoundError
from schemas.srs import (
    DDayBoostOut,
    SrsAnswerRequest,
    SrsAnswerResult,
    SrsCardOut,
    SrsSummary,
)
from services import dday_boost, sm2, settings_service
from services.tree_utils import collect_descendant_ids

DEFAULT_DAILY_LIMIT = 30  # 계획서 §10 · stage-5 기본값


def local_today() -> dt.date:
    return dt.date.today()


def _daily_limit(db: Session) -> int:
    return int(settings_service.get_setting(db, "srs.daily_limit", DEFAULT_DAILY_LIMIT))


@dataclass
class _DDayBoostContext:
    """발동 중인 D-Day 부스트 — 큐 구성 3곳(today/count/summary)이 공유하는 값."""

    winner: dday_boost.ExamCandidate  # 표시용(가장 임박한 시험) — category_id·name·exam_date·d_day
    effective_limit: int
    subtree_ids: Set[int]  # 임박 시험(들) 서브트리 합집합 — 우선순위·선행 복습 대상


def _resolve_boost(db: Session) -> Optional[_DDayBoostContext]:
    """발동 판정 + 유효 상한 — `settings:srs.dday_boost` AND categories.exam_date 중
    0<=d_day<=14가 존재해야 발동(설계 §4.14). 임의 D-Day(`ddays.custom`)는 애초에 이
    함수가 조회하지 않으므로 대상이 될 수 없다."""
    toggle = settings_service.get_setting(db, "srs.dday_boost", "on")
    today = local_today()
    rows = db.execute(
        select(models.Category).where(models.Category.exam_date.is_not(None))
    ).scalars().all()
    candidates = [
        dday_boost.ExamCandidate(
            category_id=cat.id,
            name=cat.name,
            exam_date=cat.exam_date,
            d_day=(cat.exam_date - today).days,
        )
        for cat in rows
    ]
    winner, eligible = dday_boost.resolve_active_boost(toggle, candidates)
    if winner is None:
        return None

    subtree_ids: Set[int] = set()
    for candidate in eligible:
        subtree_ids.update(collect_descendant_ids(db, candidate.category_id))

    limit = dday_boost.effective_limit(_daily_limit(db), winner.d_day)
    return _DDayBoostContext(winner=winner, effective_limit=limit, subtree_ids=subtree_ids)


def apply_sm2(db: Session, document_id: int, q: int) -> models.SrsCard:
    """문서의 SRS 카드를 SM-2로 갱신(없으면 첫 판정 시 자동 생성). **커밋하지 않음.**

    호출자(attempt_service 트랜잭션 / srs/answer)가 커밋 책임을 진다.
    """
    card = db.get(models.SrsCard, document_id)
    if card is None:
        card = models.SrsCard(
            document_id=document_id,
            ease_factor=sm2.DEFAULT_EASE_FACTOR,
            interval_days=0,
            repetitions=0,
        )
        db.add(card)

    updated = sm2.update(
        sm2.Card(
            ease_factor=card.ease_factor,
            interval_days=card.interval_days,
            repetitions=card.repetitions,
        ),
        q,
    )
    card.ease_factor = updated.ease_factor
    card.interval_days = updated.interval_days
    card.repetitions = updated.repetitions
    card.due_date = local_today() + dt.timedelta(days=updated.interval_days)
    card.last_reviewed = dt.datetime.utcnow()
    return card


def answer_flashcard(db: Session, payload: SrsAnswerRequest) -> SrsAnswerResult:
    """플래시카드 자가판정 — attempts를 남기지 않고 SM-2만 갱신 (설계 §4.7)."""
    document = db.get(models.Document, payload.document_id)
    if document is None or not document.is_active:
        raise NotFoundError(
            "문서를 찾을 수 없습니다", detail={"document_id": payload.document_id}
        )
    try:
        card = apply_sm2(db, payload.document_id, payload.q)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return SrsAnswerResult(
        ease_factor=card.ease_factor,
        interval_days=card.interval_days,
        due_date=card.due_date,
    )


def _has_unresolved_note_expr():
    unresolved = select(models.ReviewNote.document_id).where(
        models.ReviewNote.is_resolved == 0
    )
    return case((models.SrsCard.document_id.in_(unresolved), 1), else_=0)


def _subtree_document_ids_stmt(category_ids: Set[int]):
    return select(models.CategoryDocument.document_id).where(
        models.CategoryDocument.category_id.in_(category_ids)
    )


def _build_card_out(
    card: models.SrsCard, doc: models.Document, has_note: object, *, ahead: bool
) -> SrsCardOut:
    is_flashcard = doc.type == "flashcard"
    return SrsCardOut(
        document_id=doc.id,
        doc_no=doc.doc_no,
        type=doc.type,
        title=doc.title,
        content=doc.content,
        choices=json.loads(doc.choices) if doc.choices else None,
        difficulty=doc.difficulty,
        due_date=card.due_date,
        ease_factor=card.ease_factor,
        interval_days=card.interval_days,
        repetitions=card.repetitions,
        has_review_note=bool(has_note),
        answer=doc.answer if is_flashcard else None,
        explanation=doc.explanation if is_flashcard else None,
        ahead=ahead,
    )


def _not_reviewed_today_expr(today: dt.date):
    """`last_reviewed`가 없거나(아직 한 번도 안 풀었거나) 그 로컬 날짜가 오늘 이전인
    카드 — 선행 복습(ahead) 후보 조건(review-once-per-day, S11 리뷰 결함 수정).

    선행 복습으로 오늘 이미 푼 카드는 SM-2가 즉시 due_date를 미래로 밀어버려서
    (`due_date > today`) 별도 필터 없이는 다음 호출에서 곧바로 다시 ahead 후보가
    되어버린다 — 같은 카드가 반복 풀이로 interval만 폭증하며 큐에 계속 남는 결함이
    있었다(계획서 리스크 4 "due 도래분 우선 소진 후 잔여 자리만"·설계 §4.14 ③
    "시험 전에 **한 번은** 보게"가 무력화됨). `srs_cards.last_reviewed`는 이미 있는
    저장값이므로 새 컬럼 없이 이 조건만으로 막는다 — due 도래(정상) 경로는 건드리지
    않는다(오늘 풀어서 due가 밀린 카드가 그 경로로 재진입하지 않는 기존 동작 그대로).
    저장은 UTC naive(`apply_sm2`)이므로 SQLite `date(col, 'localtime')`으로 로컬
    날짜 경계를 맞춘다(stats_service와 동일 규약).
    """
    local_date = func.date(models.SrsCard.last_reviewed, "localtime")
    return or_(models.SrsCard.last_reviewed.is_(None), local_date < today.isoformat())


def get_today_queue(db: Session) -> List[SrsCardOut]:
    """오늘의 복습 큐.

    우선순위: 미해결 오답노트(1순위, 기존과 동일) > **임박 시험 서브트리 소속**(S11
    발동 시에만 2순위로 끼어듦) > 기한초과 오래된 순. 상한은 D-Day 부스트 발동 시
    유효 상한(`_resolve_boost`)으로 확대된다.

    D<=7 부스트가 발동 중이고 due 카드만으로 유효 상한을 못 채우면, 임박 시험
    서브트리의 아직 due 전인 카드 중 **오늘 아직 안 푼 카드**(`_not_reviewed_today_expr`)
    를 due 오름차순으로 남는 자리에 채운다(`ahead=True` — 선행 복습, 설계 §4.14 ③).
    오늘 이미 푼 선행 복습 카드는 due가 밀려도 당일 재진입하지 않는다(review-once
    -per-day). 미발동 시 기존 큐·순서와 완전 동일.
    """
    today = local_today()
    boost = _resolve_boost(db)
    limit = boost.effective_limit if boost is not None else _daily_limit(db)
    has_note = _has_unresolved_note_expr().label("has_note")

    order_cols = [has_note.desc()]
    if boost is not None:
        in_subtree = case(
            (
                models.SrsCard.document_id.in_(_subtree_document_ids_stmt(boost.subtree_ids)),
                1,
            ),
            else_=0,
        )
        order_cols.append(in_subtree.desc())
    order_cols += [models.SrsCard.due_date.asc(), models.SrsCard.document_id.asc()]

    due_rows = db.execute(
        select(models.SrsCard, models.Document, has_note)
        .join(models.Document, models.Document.id == models.SrsCard.document_id)
        .where(
            models.SrsCard.due_date.is_not(None),
            models.SrsCard.due_date <= today,
            models.Document.is_active == 1,
        )
        .order_by(*order_cols)
        .limit(limit)
    ).all()

    items: List[SrsCardOut] = [
        _build_card_out(card, doc, has, ahead=False) for card, doc, has in due_rows
    ]

    if (
        boost is not None
        and boost.winner.d_day <= dday_boost.NEAR_THRESHOLD_DAYS
        and len(items) < limit
    ):
        remaining = limit - len(items)
        ahead_rows = db.execute(
            select(models.SrsCard, models.Document, has_note)
            .join(models.Document, models.Document.id == models.SrsCard.document_id)
            .where(
                models.SrsCard.due_date.is_not(None),
                models.SrsCard.due_date > today,
                models.Document.is_active == 1,
                models.SrsCard.document_id.in_(_subtree_document_ids_stmt(boost.subtree_ids)),
                _not_reviewed_today_expr(today),
            )
            .order_by(models.SrsCard.due_date.asc(), models.SrsCard.document_id.asc())
            .limit(remaining)
        ).all()
        items.extend(_build_card_out(card, doc, has, ahead=True) for card, doc, has in ahead_rows)

    return items


def _count_due_by(db: Session, cutoff: dt.date, limit: int) -> int:
    """cutoff(포함) 이전까지 due인 카드 수 — 주어진 상한 적용 (`get_summary`의
    tomorrow_due 전용. today_due는 `get_today_queue`와 반드시 같은 값이어야 하므로
    큐 길이를 직접 쓴다 — 아래 `count_due_today`)."""
    due = db.execute(
        select(func.count())
        .select_from(models.SrsCard)
        .join(models.Document, models.Document.id == models.SrsCard.document_id)
        .where(
            models.SrsCard.due_date.is_not(None),
            models.SrsCard.due_date <= cutoff,
            models.Document.is_active == 1,
        )
    ).scalar_one()
    return min(due, limit)


def count_due_today(db: Session) -> int:
    """대시보드 `today_review` — 오늘 복습 대상 수. `get_today_queue`의 큐 길이와 항상
    같은 값이도록 그 함수를 그대로 재사용한다(선행 복습 포함, 설계 §4.14 DoD 8 —
    3곳의 산출식이 어긋나지 않게 하는 가장 확실한 방법은 같은 함수를 쓰는 것)."""
    return len(get_today_queue(db))


def get_summary(db: Session) -> SrsSummary:
    """`GET /api/srs/summary` (설계 §4.12) — {today_due, tomorrow_due[, dday_boost]}.

    tomorrow_due는 due_date<=내일 전부(오늘 미소화 이월 포함)를 유효 상한 적용해 센다 —
    today_due와 별개로 재차 상한을 적용하므로 "이월분이 내일 자리를 채운다"가 자연히
    표현된다(선행 복습(ahead)은 오늘 큐 전용 — 내일 수치에는 포함하지 않는다).

    S11(F16): 발동 시에만 `dday_boost` 채움(미발동 시 응답에서 생략, 하위 호환).
    """
    today = local_today()
    tomorrow = today + dt.timedelta(days=1)
    boost = _resolve_boost(db)
    limit = boost.effective_limit if boost is not None else _daily_limit(db)

    summary = SrsSummary(
        today_due=count_due_today(db),
        tomorrow_due=_count_due_by(db, tomorrow, limit),
    )
    if boost is not None:
        summary.dday_boost = DDayBoostOut(
            category_id=boost.winner.category_id,
            name=boost.winner.name,
            exam_date=boost.winner.exam_date,
            d_day=boost.winner.d_day,
            multiplier=dday_boost.boost_multiplier(boost.winner.d_day),
            effective_limit=boost.effective_limit,
        )
    return summary
