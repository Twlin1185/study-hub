"""복습(SRS) 비즈니스 로직 — SM-2 적용 · 오늘의 복습 큐 (설계 §4.7, 계획서 §10).

`apply_sm2`는 attempts 트랜잭션(불변 규칙 2)에서도, 플래시카드 srs/answer 경로에서도
공용으로 쓰인다 — **커밋하지 않는다**(호출자가 트랜잭션 경계를 소유).

날짜: due_date·"오늘" 경계는 서버 로컬(Asia/Seoul, 설계 §3) 날짜 기준. 서버가 Asia/Seoul로
설정돼 있다는 전제 하에 dt.date.today()가 로컬 오늘이다(stats_service와 동일 규약).
저장 타임스탬프(last_reviewed)는 다른 컬럼과 마찬가지로 UTC naive로 남긴다.
"""
from __future__ import annotations

import datetime as dt
import json
from typing import List

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

import models
from exceptions import NotFoundError
from schemas.srs import SrsAnswerRequest, SrsAnswerResult, SrsCardOut, SrsSummary
from services import sm2, settings_service

DEFAULT_DAILY_LIMIT = 30  # 계획서 §10 · stage-5 기본값


def local_today() -> dt.date:
    return dt.date.today()


def _daily_limit(db: Session) -> int:
    return int(settings_service.get_setting(db, "srs.daily_limit", DEFAULT_DAILY_LIMIT))


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


def get_today_queue(db: Session) -> List[SrsCardOut]:
    """오늘의 복습 큐: due_date<=오늘, 우선순위(미해결 오답노트 > 기한초과 오래된 순), 상한 적용."""
    today = local_today()
    has_note = _has_unresolved_note_expr().label("has_note")

    rows = db.execute(
        select(models.SrsCard, models.Document, has_note)
        .join(models.Document, models.Document.id == models.SrsCard.document_id)
        .where(
            models.SrsCard.due_date.is_not(None),
            models.SrsCard.due_date <= today,
            models.Document.is_active == 1,
        )
        .order_by(
            has_note.desc(),
            models.SrsCard.due_date.asc(),
            models.SrsCard.document_id.asc(),
        )
        .limit(_daily_limit(db))
    ).all()

    items: List[SrsCardOut] = []
    for card, doc, has in rows:
        is_flashcard = doc.type == "flashcard"
        items.append(
            SrsCardOut(
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
                has_review_note=bool(has),
                answer=doc.answer if is_flashcard else None,
                explanation=doc.explanation if is_flashcard else None,
            )
        )
    return items


def _count_due_by(db: Session, cutoff: dt.date) -> int:
    """cutoff(포함) 이전까지 due인 카드 수 — 상한(`srs.daily_limit`) 적용.

    `count_due_today`(cutoff=오늘)·`get_summary`(cutoff=오늘/내일) 공용 헬퍼.
    """
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
    return min(due, _daily_limit(db))


def count_due_today(db: Session) -> int:
    """대시보드 `today_review` — 오늘 복습 대상 수(상한 반영)."""
    return _count_due_by(db, local_today())


def get_summary(db: Session) -> SrsSummary:
    """`GET /api/srs/summary` (설계 §4.12) — {today_due, tomorrow_due}.

    tomorrow_due는 due_date<=내일 전부(오늘 미소화 이월 포함)를 상한 적용해 센다 —
    today_due와 별개로 재차 상한을 적용하므로 "이월분이 내일 자리를 채운다"가 자연히 표현된다.
    """
    today = local_today()
    tomorrow = today + dt.timedelta(days=1)
    return SrsSummary(
        today_due=_count_due_by(db, today),
        tomorrow_due=_count_due_by(db, tomorrow),
    )
