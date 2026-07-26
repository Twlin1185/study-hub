"""모의고사 점수·합격 판정 순수 함수 (F25, 설계 §4.14).

DB·세션 비의존 — 채점 자체의 정확성을 pytest로 고정한다(services/sm2.py 전례).
과목 집계(correct/count)는 exam_service가 attempt_service.grade_and_record 결과를
누적해서 만들고, 이 모듈은 그 집계값을 받아 점수·과락·합격만 계산한다.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import List

# 국가기술자격 표준 기본값(설계 §4.14) — exam/session·exam/submit 요청 `cut`의 기본값.
DEFAULT_SUBJECT_MIN = 40
DEFAULT_PASS_AVG = 60


@dataclass
class SubjectTally:
    """채점 누적 중간값 — exam_service가 문항별 채점 결과를 이 안에 쌓는다."""

    category_id: int
    name: str
    correct: int = 0
    count: int = 0


@dataclass(frozen=True)
class SubjectScore:
    category_id: int
    name: str
    score: int
    correct: int
    count: int
    failed: bool


def score_subject(correct: int, count: int) -> int:
    """과목 점수 = round(100 × 정답 / 문항수). 문항 0이면 0점(호출부가 0문항 과목을
    출제하지 않는 게 원칙 — exam/session이 0문항 과목을 응답에서 제외한다)."""
    if count <= 0:
        return 0
    return round(100 * correct / count)


def grade_subjects(
    tallies: List[SubjectTally], subject_min: int = DEFAULT_SUBJECT_MIN
) -> List[SubjectScore]:
    """과목별 점수·과락(`score < subject_min`) 산출. 입력 순서를 그대로 유지한다."""
    results: List[SubjectScore] = []
    for t in tallies:
        score = score_subject(t.correct, t.count)
        results.append(
            SubjectScore(
                category_id=t.category_id,
                name=t.name,
                score=score,
                correct=t.correct,
                count=t.count,
                failed=score < subject_min,
            )
        )
    return results


def total_score(subject_scores: List[SubjectScore]) -> int:
    """총점 = 과목 점수의 **단순 평균**(문항 수 가중 없음 — 국가기술자격 관례), 반올림."""
    if not subject_scores:
        return 0
    return round(sum(s.score for s in subject_scores) / len(subject_scores))


def is_passed(subject_scores: List[SubjectScore], total: int, pass_avg: int = DEFAULT_PASS_AVG) -> bool:
    """합격 = 전 과목 비과락 AND 총점 >= pass_avg. 과목이 하나라도 과락이면 총점과 무관하게 불합격."""
    if any(s.failed for s in subject_scores):
        return False
    return total >= pass_avg
