"""D-Day 선행 복습(ahead) 큐 — DB 접합부 회귀 테스트 (F16, 설계 §4.14 ③).

review-once-per-day 결함 수정 검증: 오늘 이미 푼 선행 복습 카드는 SM-2가 due_date를
미래로 밀어도(`due_date > today`) 같은 날 다시 ahead 후보가 되면 안 된다(계획서
리스크 4 "due 도래분 우선 소진 후 잔여 자리만" · 설계 §4.14 ③ "시험 전에 한 번은
보게"). `services/dday_boost.py`의 순수 함수는 `test_dday_boost.py`가 이미 고정하므로,
여기서는 그 판정이 실제 DB 큐 구성(`srs_service.get_today_queue`)에 올바르게
접합되는지만 in-memory SQLite로 확인한다.
"""
from __future__ import annotations

import datetime as dt
import itertools

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import models
from database import Base
from services import srs_service


@pytest.fixture()
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


def _make_exam_subtree(db, *, d_day: int) -> tuple[int, int]:
    """exam_date=d_day인 시험 노드 하나 + 그 아래 과목 노드 하나를 만들고
    (subject_category_id, exam_category_id)를 반환."""
    today = srs_service.local_today()
    exam_cat = models.Category(name="정보처리기사", exam_date=today + dt.timedelta(days=d_day))
    db.add(exam_cat)
    db.flush()
    subject_cat = models.Category(parent_id=exam_cat.id, name="필기")
    db.add(subject_cat)
    db.flush()
    return subject_cat.id, exam_cat.id


_doc_no_seq = itertools.count(1)


def _make_ahead_card(db, subject_category_id: int, *, due_in_days: int, last_reviewed=None) -> int:
    """due_date가 미래(due_in_days>0)인 선행 복습 후보 카드 1개 생성 — document_id 반환."""
    today = srs_service.local_today()
    doc = models.Document(
        doc_no=f"DOC-TEST-{next(_doc_no_seq)}",
        type="question",
        title="테스트 문항",
        answer="1",
        is_active=1,
    )
    db.add(doc)
    db.flush()
    db.add(models.CategoryDocument(category_id=subject_category_id, document_id=doc.id))
    db.add(
        models.SrsCard(
            document_id=doc.id,
            ease_factor=2.5,
            interval_days=6,
            repetitions=2,
            due_date=today + dt.timedelta(days=due_in_days),
            last_reviewed=last_reviewed,
        )
    )
    db.flush()
    return doc.id


def test_ahead_excludes_card_reviewed_today(db):
    """오늘 이미 푼(last_reviewed=오늘) 카드는 due_date>오늘이어도 ahead 후보에서 빠진다."""
    subject_id, _ = _make_exam_subtree(db, d_day=3)  # D<=7 — 선행 복습 발동 대상
    reviewed_today = _make_ahead_card(
        db, subject_id, due_in_days=5, last_reviewed=dt.datetime.utcnow()
    )
    not_yet_reviewed = _make_ahead_card(db, subject_id, due_in_days=5, last_reviewed=None)
    db.commit()

    queue = srs_service.get_today_queue(db)
    ids = {item.document_id: item for item in queue}

    assert not_yet_reviewed in ids
    assert ids[not_yet_reviewed].ahead is True
    assert reviewed_today not in ids, "오늘 이미 푼 카드가 ahead로 재진입했다"


def test_ahead_allows_card_reviewed_before_today(db):
    """last_reviewed가 오늘 이전(어제)이면 ahead 후보로 정상 포함된다."""
    subject_id, _ = _make_exam_subtree(db, d_day=3)
    yesterday_reviewed = dt.datetime.utcnow() - dt.timedelta(days=1)
    doc_id = _make_ahead_card(db, subject_id, due_in_days=5, last_reviewed=yesterday_reviewed)
    db.commit()

    queue = srs_service.get_today_queue(db)
    ids = {item.document_id: item for item in queue}

    assert doc_id in ids
    assert ids[doc_id].ahead is True


def test_ahead_reentry_blocked_after_solving_via_grade_and_record(db):
    """실사용 재현: 선행 복습 카드를 attempt_service 경로로 풀면(=SM-2가 due를 미래로
    밈) 같은 날 다시 조회해도 큐에 재등장하지 않는다(검토자 실측 — 연속 4회 증폭 결함)."""
    from services import attempt_service

    subject_id, _ = _make_exam_subtree(db, d_day=3)
    doc_id = _make_ahead_card(db, subject_id, due_in_days=5, last_reviewed=None)
    db.commit()

    document = db.get(models.Document, doc_id)
    before_card = db.get(models.SrsCard, doc_id)
    before_interval = before_card.interval_days

    queue_before = srs_service.get_today_queue(db)
    assert any(item.document_id == doc_id for item in queue_before)

    graded = attempt_service.grade_and_record(
        db, document=document, my_answer="1", category_id=subject_id, mode="quiz"
    )
    db.commit()
    assert graded.is_correct is True

    after_card = db.get(models.SrsCard, doc_id)
    assert after_card.interval_days > before_interval  # SM-2가 정상적으로 진행됐는지 확인

    queue_after = srs_service.get_today_queue(db)
    assert not any(item.document_id == doc_id for item in queue_after), (
        "오늘 푼 카드가 즉시 ahead로 재진입했다(interval 증폭 결함)"
    )


def test_due_path_unaffected_by_review_today_filter(db):
    """정상 due 경로(due_date<=오늘)는 last_reviewed 필터의 영향을 받지 않는다 —
    오늘 이미 풀어서 due가 미래로 밀린 카드가 due 경로로 재진입하지 않는 것은
    (그 카드의 due_date가 더 이상 <=오늘이 아니므로) 이 필터와 무관하게 기존 그대로다."""
    subject_id, _ = _make_exam_subtree(db, d_day=3)
    today = srs_service.local_today()
    doc = models.Document(
        doc_no="DOC-DUE-1", type="question", title="정상 due 문항", answer="1", is_active=1
    )
    db.add(doc)
    db.flush()
    db.add(models.CategoryDocument(category_id=subject_id, document_id=doc.id))
    db.add(
        models.SrsCard(
            document_id=doc.id,
            ease_factor=2.5,
            interval_days=1,
            repetitions=1,
            due_date=today,  # 오늘 due
            last_reviewed=dt.datetime.utcnow(),  # 과거에 이미 풀었던 적 있음 — 무관해야 함
        )
    )
    db.commit()

    queue = srs_service.get_today_queue(db)
    ids = {item.document_id: item for item in queue}
    assert doc.id in ids
    assert ids[doc.id].ahead is False
