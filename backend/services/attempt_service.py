"""풀이 채점 · 오답노트 · 진도 · SM-2 갱신 (한 트랜잭션).

불변 규칙 2: 채점은 서버에서만. attempts INSERT + (오답 시) review_notes 생성/재사용 +
study_progress 갱신 + SM-2 카드 갱신을 하나의 커밋으로 처리한다.

`grade_and_record`가 그 채점 코어(정규화 비교 · avg_time/직전오답 기반 q 매핑 ·
오답노트 생성/재사용 · study_progress · SM-2)를 **커밋 없는 공용 함수**로 담당한다 —
단건(`submit_attempt`, quiz)과 배치(`services.exam_service.submit_exam`, S11 exam)가
같은 규칙을 공유한다(services/srs_service.py의 apply_sm2 전례). 트랜잭션 경계(commit/
rollback)는 언제나 호출자가 소유한다.
"""
from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

import models
from exceptions import NotFoundError
from schemas.attempt import AttemptCreate, AttemptResult, SrsInfo
from services import sm2, srs_service


def _normalize(value: str | None) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", value.strip()).lower()


def _get_document_or_404(db: Session, document_id: int) -> models.Document:
    document = db.get(models.Document, document_id)
    if document is None:
        raise NotFoundError(
            "문서를 찾을 수 없습니다", detail={"document_id": document_id}
        )
    return document


@dataclass
class GradedAttempt:
    """`grade_and_record` 결과 — 호출자가 응답(단건 AttemptResult / exam 리포트 문항)을
    조립하는 데 필요한 값만 담는다."""

    document_id: int
    is_correct: bool
    review_note_id: Optional[int]
    due_date: Optional[dt.date]
    attempt: models.Attempt


def grade_and_record(
    db: Session,
    *,
    document: models.Document,
    my_answer: Optional[str],
    category_id: Optional[int] = None,
    time_spent: Optional[int] = None,
    mode: Optional[str] = "quiz",
    answered_at: Optional[dt.datetime] = None,
) -> GradedAttempt:
    """문항 1개 채점 + attempts INSERT + 오답노트 + study_progress + SM-2. **커밋하지
    않는다** — 호출자가 트랜잭션 경계를 소유한다(단건은 `submit_attempt`, 배치는
    `exam_service.submit_exam`이 전체를 한 트랜잭션으로 묶는다, 불변 규칙 2).

    `answered_at`을 지정하면(배치 공통 런 키) 그 값을 그대로 쓰고, 생략하면 컬럼의
    `server_default=CURRENT_TIMESTAMP`가 적용된다(기존 단건 경로와 완전히 동일).
    """
    correct_answer = _normalize(document.answer)
    is_correct = bool(correct_answer) and _normalize(my_answer) == correct_answer

    # 이 문항의 과거 평균 소요시간(이번 풀이 제외) — q 매핑의 '빠름/느림' 기준.
    avg_time = db.execute(
        select(func.avg(models.Attempt.time_spent)).where(
            models.Attempt.document_id == document.id,
            models.Attempt.time_spent.is_not(None),
        )
    ).scalar()

    # 직전 시도(이번 제출 제외, answered_at 최신 1건)의 정오답 — E안 '회복 정답' 판정용.
    prev_is_correct = db.execute(
        select(models.Attempt.is_correct)
        .where(models.Attempt.document_id == document.id)
        .order_by(models.Attempt.answered_at.desc(), models.Attempt.id.desc())
        .limit(1)
    ).scalar_one_or_none()
    prev_incorrect = prev_is_correct == 0

    attempt = models.Attempt(
        document_id=document.id,
        category_id=category_id,
        my_answer=my_answer,
        is_correct=1 if is_correct else 0,
        time_spent=time_spent,
        mode=mode,
    )
    if answered_at is not None:
        attempt.answered_at = answered_at
    db.add(attempt)

    review_note_id: int | None = None
    if not is_correct:
        note = db.execute(
            select(models.ReviewNote).where(
                models.ReviewNote.document_id == document.id
            )
        ).scalar_one_or_none()
        if note is None:
            note = models.ReviewNote(document_id=document.id)
            db.add(note)
            db.flush()  # id 확보
        review_note_id = note.id

    if category_id is not None:
        progress = db.get(
            models.StudyProgress,
            {"category_id": category_id, "document_id": document.id},
        )
        if progress is None:
            progress = models.StudyProgress(
                category_id=category_id, document_id=document.id
            )
            db.add(progress)
        progress.status = "done"
        progress.completed_at = dt.datetime.utcnow()

    # SM-2 갱신 — 첫 풀이면 카드 자동 생성. 같은 트랜잭션에서 처리(불변 규칙 2).
    q = sm2.quality_for_attempt(
        is_correct=is_correct,
        prev_incorrect=prev_incorrect,
        time_spent=time_spent,
        avg_time=avg_time,
    )
    card = srs_service.apply_sm2(db, document.id, q)

    return GradedAttempt(
        document_id=document.id,
        is_correct=is_correct,
        review_note_id=review_note_id,
        due_date=card.due_date,
        attempt=attempt,
    )


def submit_attempt(db: Session, payload: AttemptCreate) -> AttemptResult:
    document = _get_document_or_404(db, payload.document_id)
    if payload.category_id is not None:
        category = db.get(models.Category, payload.category_id)
        if category is None:
            raise NotFoundError(
                "분류를 찾을 수 없습니다", detail={"category_id": payload.category_id}
            )

    try:
        graded = grade_and_record(
            db,
            document=document,
            my_answer=payload.my_answer,
            category_id=payload.category_id,
            time_spent=payload.time_spent,
            mode=payload.mode,
        )
        db.commit()
    except Exception:
        db.rollback()
        raise

    return AttemptResult(
        is_correct=graded.is_correct,
        answer=document.answer,
        explanation=document.explanation,
        review_note_id=graded.review_note_id,
        srs=SrsInfo(due_date=graded.due_date),
    )
