"""D-Day 복습 강도 조절 — 발동 판정·유효 상한 단위 테스트 (F16, 설계 §4.14).

DB 없이 순수 함수(services/dday_boost.py)만 검증한다. `srs_service._resolve_boost`의
DB 조회 접합부(설정·categories.exam_date 실조회)는 스모크(uvicorn + HTTP)로 확인한다.
"""
from __future__ import annotations

import datetime as dt

from services.dday_boost import (
    ExamCandidate,
    boost_multiplier,
    effective_limit,
    is_eligible_d_day,
    resolve_active_boost,
)

TODAY = dt.date(2026, 7, 26)


def _candidate(category_id: int, name: str, d_day: int) -> ExamCandidate:
    return ExamCandidate(
        category_id=category_id,
        name=name,
        exam_date=TODAY + dt.timedelta(days=d_day),
        d_day=d_day,
    )


# --- 경계 D0/D7/D8/D14/D15 ---------------------------------------------------
def test_is_eligible_d_day_boundaries():
    assert is_eligible_d_day(0) is True
    assert is_eligible_d_day(7) is True
    assert is_eligible_d_day(8) is True
    assert is_eligible_d_day(14) is True
    assert is_eligible_d_day(15) is False
    assert is_eligible_d_day(-1) is False  # 지난 시험


def test_boost_multiplier_near_vs_far():
    assert boost_multiplier(0) == 2.0
    assert boost_multiplier(7) == 2.0
    assert boost_multiplier(8) == 1.5
    assert boost_multiplier(14) == 1.5


def test_effective_limit_boundaries():
    assert effective_limit(30, 0) == 60  # ceil(30*2)
    assert effective_limit(30, 7) == 60
    assert effective_limit(30, 8) == 45  # ceil(30*1.5)
    assert effective_limit(30, 14) == 45
    assert effective_limit(30, 15) == 30  # 대상 밖 — 원래 상한 그대로
    assert effective_limit(30, -1) == 30  # 지난 시험 — 원래 상한 그대로


def test_effective_limit_ceil_rounding():
    # ceil(11*2)=22, ceil(11*1.5)=17(16.5 올림)
    assert effective_limit(11, 0) == 22
    assert effective_limit(11, 8) == 17


def test_effective_limit_no_boost_when_no_min_d_day():
    assert effective_limit(30, None) == 30


# --- 발동 판정: 토글 off ------------------------------------------------------
def test_resolve_active_boost_toggle_off_ignores_eligible_candidates():
    candidates = [_candidate(1, "정보처리기사", 3)]
    winner, eligible = resolve_active_boost("off", candidates)
    assert winner is None
    assert eligible == []


def test_resolve_active_boost_toggle_on_no_candidates():
    winner, eligible = resolve_active_boost("on", [])
    assert winner is None
    assert eligible == []


# --- 발동 판정: 지난 시험·D15 무시 -------------------------------------------
def test_resolve_active_boost_ignores_past_and_far_future_exams():
    candidates = [
        _candidate(1, "지난 시험", -1),
        _candidate(2, "너무 먼 시험", 15),
    ]
    winner, eligible = resolve_active_boost("on", candidates)
    assert winner is None
    assert eligible == []


# --- 발동 판정: 여러 시험 임박 시 최소 d_day가 대표 ---------------------------
def test_resolve_active_boost_picks_min_d_day_among_multiple():
    candidates = [
        _candidate(1, "필기", 10),
        _candidate(2, "실기", 3),
        _candidate(3, "지난 시험", -5),
        _candidate(4, "먼 시험", 20),
    ]
    winner, eligible = resolve_active_boost("on", candidates)
    assert winner is not None
    assert winner.category_id == 2
    assert winner.d_day == 3
    # eligible = 발동 대상 전체(서브트리 합집합 계산용) — 지난 시험·먼 시험은 제외
    assert {c.category_id for c in eligible} == {1, 2}


def test_resolve_active_boost_single_candidate_boundary_d14():
    winner, eligible = resolve_active_boost("on", [_candidate(1, "필기", 14)])
    assert winner is not None
    assert winner.d_day == 14
    assert boost_multiplier(winner.d_day) == 1.5


def test_resolve_active_boost_single_candidate_boundary_d15_excluded():
    winner, eligible = resolve_active_boost("on", [_candidate(1, "필기", 15)])
    assert winner is None
    assert eligible == []
