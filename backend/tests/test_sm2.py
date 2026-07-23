"""SM-2 엔진 단위 테스트 (계획서 §10 규칙 검증).

이 프로젝트에서 유일하게 테스트가 강제되는 모듈 — 날짜/간격 계산 버그는 눈에 안 보이게
학습을 망치므로 시나리오를 촘촘히 고정한다.

실행: backend/ 에서 `.venv\\Scripts\\python.exe -m pytest tests/ -v`
"""
from __future__ import annotations

import pytest

from services import sm2
from services.sm2 import Card


def test_wrong_answer_resets_and_keeps_ef():
    """오답(q<3): repetitions=0, interval=1, EF는 유지."""
    card = Card(ease_factor=2.5, interval_days=30, repetitions=5)
    result = sm2.update(card, 1)
    assert result.repetitions == 0
    assert result.interval_days == 1
    assert result.ease_factor == pytest.approx(2.5)  # EF 유지 (표준과 다른 계획서 규칙)


def test_wrong_answer_low_ef_still_kept():
    """오답이어도 EF는 낮아지지 않는다 (하한 1.3 근처에서도 유지)."""
    card = Card(ease_factor=1.6, interval_days=10, repetitions=3)
    result = sm2.update(card, 0)
    assert result.ease_factor == pytest.approx(1.6)
    assert result.interval_days == 1
    assert result.repetitions == 0


def test_interval_progression_1_6_then_ef():
    """정답 연속: 1일 → 6일 → 이전 interval × EF (반올림)."""
    card = Card()  # ef=2.5, interval=0, reps=0

    r1 = sm2.update(card, 5)
    assert r1.repetitions == 1
    assert r1.interval_days == 1
    assert r1.ease_factor == pytest.approx(2.6)  # 2.5 + 0.1

    r2 = sm2.update(r1, 5)
    assert r2.repetitions == 2
    assert r2.interval_days == 6
    assert r2.ease_factor == pytest.approx(2.7)

    r3 = sm2.update(r2, 5)
    assert r3.repetitions == 3
    assert r3.ease_factor == pytest.approx(2.8)
    assert r3.interval_days == round(6 * 2.8)  # 17

    r4 = sm2.update(r3, 5)
    assert r4.repetitions == 4
    assert r4.ease_factor == pytest.approx(2.9)
    assert r4.interval_days == round(r3.interval_days * r4.ease_factor)


def test_ef_delta_formula_per_quality():
    """EF' = EF + (0.1 − (5−q)(0.08 + (5−q)·0.02))."""
    base = Card(ease_factor=2.5, interval_days=6, repetitions=2)
    # q=5 → +0.1
    assert sm2.update(base, 5).ease_factor == pytest.approx(2.6)
    # q=4 → +0.0
    assert sm2.update(base, 4).ease_factor == pytest.approx(2.5)
    # q=3 → -0.14
    assert sm2.update(base, 3).ease_factor == pytest.approx(2.36)


def test_ef_floor_1_3():
    """정답이지만 낮은 q(=3)를 반복하면 EF가 1.3 아래로 내려가지 않는다."""
    card = Card()  # ef=2.5
    for _ in range(20):
        card = sm2.update(card, 3)
        assert card.ease_factor >= sm2.MIN_EASE_FACTOR
    assert card.ease_factor == pytest.approx(sm2.MIN_EASE_FACTOR)


def test_boundary_q_values():
    """경계값: q=3은 정답 경로(진행), q=2는 오답 경로(리셋)."""
    card = Card(ease_factor=2.0, interval_days=6, repetitions=2)

    passed = sm2.update(card, 3)
    assert passed.repetitions == 3  # 진행
    assert passed.interval_days == round(6 * passed.ease_factor)

    failed = sm2.update(card, 2)
    assert failed.repetitions == 0  # 리셋
    assert failed.interval_days == 1
    assert failed.ease_factor == pytest.approx(2.0)  # 유지


def test_update_does_not_mutate_input():
    card = Card(ease_factor=2.5, interval_days=6, repetitions=2)
    sm2.update(card, 5)
    assert card.ease_factor == 2.5
    assert card.interval_days == 6
    assert card.repetitions == 2


@pytest.mark.parametrize("bad_q", [-1, 6, 10, 2.5, "3", None])
def test_invalid_q_raises(bad_q):
    with pytest.raises(ValueError):
        sm2.update(Card(), bad_q)


@pytest.mark.parametrize(
    "is_correct,mode,time_spent,avg_time,expected",
    [
        (False, "quiz", 5, 10.0, 1),        # 오답
        (False, "review", 5, 10.0, 1),      # 오답 (모드 무관)
        (True, "review", 5, 10.0, 3),       # 오답노트 재도전 정답
        (True, "flashcard", None, None, 4), # 플래시카드 정답(안다)
        (True, "quiz", 5, 10.0, 5),         # 정답 · 평균 이하 → 빠름
        (True, "quiz", 15, 10.0, 4),        # 정답 · 평균 초과 → 느림
        (True, "quiz", 10, 10.0, 5),        # 정답 · 평균과 동일(이하) → 빠름
        (True, "quiz", 5, None, 4),         # 정답 · 평균 자료 없음 → 보수적 4
    ],
)
def test_quality_for_attempt(is_correct, mode, time_spent, avg_time, expected):
    assert sm2.quality_for_attempt(is_correct, mode, time_spent, avg_time) == expected
