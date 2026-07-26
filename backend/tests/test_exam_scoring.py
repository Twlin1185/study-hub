"""모의고사 점수·합격 판정 단위 테스트 (F25, 설계 §4.14, stage-11 체크리스트).

DB 없이 순수 함수(services/exam_scoring.py)만 검증한다.
"""
from __future__ import annotations

import pytest

from services.exam_scoring import (
    DEFAULT_PASS_AVG,
    DEFAULT_SUBJECT_MIN,
    SubjectTally,
    grade_subjects,
    is_passed,
    score_subject,
    total_score,
)


def test_score_subject_rounds_percentage():
    assert score_subject(correct=7, count=20) == 35  # round(35.0)
    assert score_subject(correct=1, count=3) == round(100 / 3)  # 33


def test_score_subject_zero_count_is_zero():
    assert score_subject(correct=0, count=0) == 0


# --- 과락 경계 40점 ----------------------------------------------------------
def test_subject_min_boundary_exactly_40_is_not_failed():
    tallies = [SubjectTally(category_id=1, name="A", correct=8, count=20)]  # score=40
    scores = grade_subjects(tallies, subject_min=DEFAULT_SUBJECT_MIN)
    assert scores[0].score == 40
    assert scores[0].failed is False


def test_subject_min_boundary_39_is_failed():
    tallies = [SubjectTally(category_id=1, name="A", correct=39, count=100)]  # score=39
    scores = grade_subjects(tallies, subject_min=DEFAULT_SUBJECT_MIN)
    assert scores[0].score == 39
    assert scores[0].failed is True


# --- 평균 반올림 (총점 = 과목 점수 단순 평균, 문항수 가중 없음) --------------
def test_total_score_is_simple_average_not_weighted():
    tallies = [
        SubjectTally(category_id=1, name="A", correct=9, count=10),  # 90점
        SubjectTally(category_id=2, name="B", correct=1, count=2),  # 50점
    ]
    scores = grade_subjects(tallies)
    total = total_score(scores)
    # 단순 평균 (90+50)/2 = 70 — 가중 평균이면 (9+1)/(10+2)=83.3%이 나와야 하므로 다르다.
    assert total == 70
    weighted = round(100 * (9 + 1) / (10 + 2))
    assert total != weighted


def test_total_score_rounding_half_to_even():
    """Python 내장 round()의 은행원 반올림 규칙을 그대로 따른다(설계에 반올림 방식
    별도 지정 없음 — 코드베이스 다른 반올림(stats_service)과 동일하게 round() 사용)."""
    scores = grade_subjects(
        [
            SubjectTally(category_id=1, name="A", correct=70, count=100),  # 70점
            SubjectTally(category_id=2, name="B", correct=71, count=100),  # 71점
        ]
    )
    # (70+71)/2 = 70.5 -> round-half-even -> 70 (짝수)
    assert total_score(scores) == 70

    scores2 = grade_subjects(
        [
            SubjectTally(category_id=1, name="A", correct=61, count=100),  # 61점
            SubjectTally(category_id=2, name="B", correct=58, count=100),  # 58점
        ]
    )
    # (61+58)/2 = 59.5 -> round-half-even -> 60 (짝수)
    assert total_score(scores2) == 60


def test_total_score_empty_is_zero():
    assert total_score([]) == 0


# --- 미응답 포함(오답으로 집계) ----------------------------------------------
def test_unanswered_counts_as_incorrect_in_tally():
    """미응답(null)은 exam_service가 correct에 더하지 않고 count만 올리므로, 이 모듈
    입장에서는 그냥 '정답 아닌 문항'과 동일하게 점수에 반영된다."""
    # 5문항 중 2문항 응답(1정답) + 3문항 미응답 -> correct=1, count=5
    tallies = [SubjectTally(category_id=1, name="A", correct=1, count=5)]
    scores = grade_subjects(tallies, subject_min=DEFAULT_SUBJECT_MIN)
    assert scores[0].score == 20
    assert scores[0].failed is True


# --- 과목 문항 수 불균등 ------------------------------------------------------
def test_unequal_subject_counts_each_scored_independently():
    tallies = [
        SubjectTally(category_id=1, name="A", correct=5, count=5),  # 100점, 5문항
        SubjectTally(category_id=2, name="B", correct=10, count=40),  # 25점, 40문항
    ]
    scores = grade_subjects(tallies)
    assert scores[0].score == 100
    assert scores[1].score == 25
    assert total_score(scores) == round((100 + 25) / 2)  # 63


# --- 합격 판정 ---------------------------------------------------------------
def test_is_passed_true_when_no_failure_and_avg_meets_cut():
    tallies = [
        SubjectTally(category_id=1, name="A", correct=12, count=20),  # 60점
        SubjectTally(category_id=2, name="B", correct=12, count=20),  # 60점
    ]
    scores = grade_subjects(tallies)
    total = total_score(scores)
    assert total == 60
    assert is_passed(scores, total, pass_avg=DEFAULT_PASS_AVG) is True


def test_is_passed_false_when_one_subject_failed_even_if_avg_high():
    tallies = [
        SubjectTally(category_id=1, name="A", correct=7, count=20),  # 35점 (과락)
        SubjectTally(category_id=2, name="B", correct=20, count=20),  # 100점
    ]
    scores = grade_subjects(tallies)
    total = total_score(scores)
    assert total == 68  # (35+100)/2 = 67.5 -> round-half-even -> 68
    assert any(s.failed for s in scores)
    assert is_passed(scores, total, pass_avg=DEFAULT_PASS_AVG) is False


def test_is_passed_false_when_avg_below_pass_avg():
    tallies = [
        SubjectTally(category_id=1, name="A", correct=11, count=20),  # 55점
        SubjectTally(category_id=2, name="B", correct=11, count=20),  # 55점
    ]
    scores = grade_subjects(tallies)
    total = total_score(scores)
    assert total == 55
    assert is_passed(scores, total, pass_avg=DEFAULT_PASS_AVG) is False


@pytest.mark.parametrize("count", [0, 1, 5])
def test_grade_subjects_preserves_input_order(count):
    tallies = [SubjectTally(category_id=i, name=f"S{i}", correct=0, count=count) for i in range(3)]
    scores = grade_subjects(tallies)
    assert [s.category_id for s in scores] == [0, 1, 2]
