"""풀이 채점 · 오답노트 · 진도 갱신 (한 트랜잭션).

불변 규칙: 채점은 서버에서만. attempts INSERT + (오답 시) review_notes
생성/재사용 + study_progress 갱신을 하나의 커밋으로 처리한다.
SM-2 연동은 S5 범위 — srs 필드는 항상 null.
"""
from __future__ import annotations

import datetime as dt
import re

from sqlalchemy import select
from sqlalchemy.orm import Session

import models
from exceptions import NotFoundError
from schemas.attempt import AttemptCreate, AttemptResult


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


def submit_attempt(db: Session, payload: AttemptCreate) -> AttemptResult:
    document = _get_document_or_404(db, payload.document_id)
    if payload.category_id is not None:
        category = db.get(models.Category, payload.category_id)
        if category is None:
            raise NotFoundError(
                "분류를 찾을 수 없습니다", detail={"category_id": payload.category_id}
            )

    correct_answer = _normalize(document.answer)
    is_correct = bool(correct_answer) and _normalize(payload.my_answer) == correct_answer

    try:
        attempt = models.Attempt(
            document_id=document.id,
            category_id=payload.category_id,
            my_answer=payload.my_answer,
            is_correct=1 if is_correct else 0,
            time_spent=payload.time_spent,
            mode=payload.mode,
        )
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

        if payload.category_id is not None:
            progress = db.get(
                models.StudyProgress,
                {"category_id": payload.category_id, "document_id": document.id},
            )
            if progress is None:
                progress = models.StudyProgress(
                    category_id=payload.category_id, document_id=document.id
                )
                db.add(progress)
            progress.status = "done"
            progress.completed_at = dt.datetime.utcnow()

        db.commit()
    except Exception:
        db.rollback()
        raise

    return AttemptResult(
        is_correct=is_correct,
        answer=document.answer,
        explanation=document.explanation,
        review_note_id=review_note_id,
        srs=None,
    )
