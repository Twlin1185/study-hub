"""D-Day 복습 강도 조절 — 발동 판정·유효 상한 순수 함수 (F16, 설계 §4.14).

DB 비의존 — `srs_service`가 categories.exam_date·settings를 조회해 만든
`ExamCandidate` 목록을 이 모듈에 넘기면, 발동 여부·유효 상한만 순수하게 계산한다.
`get_today_queue`(큐 구성) · `count_due_today`(대시보드 today_review) · `srs/summary`가
전부 이 모듈의 함수를 공유해야 세 곳의 산출식이 어긋나지 않는다(설계 §4.14 리스크 5).

`services/sm2.py`·`srs_cards` 저장값(EF·interval·due_date)은 이 모듈이 절대 다루지
않는다 — 큐 구성 계층 전용.
"""
from __future__ import annotations

import datetime as dt
import math
from dataclasses import dataclass
from typing import List, Optional, Tuple

WINDOW_DAYS = 14  # d_day가 이 값 이하(0 이상)여야 발동 대상
NEAR_THRESHOLD_DAYS = 7  # 이 이하면 배율 확대(×2), 초과~WINDOW_DAYS는 ×1.5
MULT_NEAR = 2.0
MULT_FAR = 1.5


@dataclass(frozen=True)
class ExamCandidate:
    """발동 판정 입력 1건 — categories.exam_date를 가진 분류 노드 하나."""

    category_id: int
    name: str
    exam_date: dt.date
    d_day: int


def is_eligible_d_day(d_day: int) -> bool:
    """0 <= d_day <= 14 (지난 날짜·15일 이상은 대상 아님)."""
    return 0 <= d_day <= WINDOW_DAYS


def boost_multiplier(d_day: int) -> float:
    """`is_eligible_d_day(d_day)`가 참이라는 전제 — D<=7 ×2 / D8~14 ×1.5."""
    return MULT_NEAR if d_day <= NEAR_THRESHOLD_DAYS else MULT_FAR


def effective_limit(daily_limit: int, min_d_day: Optional[int]) -> int:
    """유효 상한. 발동 안 됨(`min_d_day`가 None이거나 대상 범위 밖)이면 원래 상한 그대로."""
    if min_d_day is None or not is_eligible_d_day(min_d_day):
        return daily_limit
    return math.ceil(daily_limit * boost_multiplier(min_d_day))


def resolve_active_boost(
    toggle: str, candidates: List[ExamCandidate]
) -> Tuple[Optional[ExamCandidate], List[ExamCandidate]]:
    """발동 판정 — `toggle`이 'on'이 아니면 미발동(빈 결과). 대상 후보 중 d_day가 최소인
    쪽이 대표(표시용 category_id·name·exam_date·d_day, 배율 기준). 두 번째 반환값은
    발동 대상 전체 후보(여러 시험 임박 시 서브트리 합집합 계산용, 설계 §4.14 ②).

    `candidates`는 호출자가 이미 categories.exam_date에서만 뽑은 목록이라는 전제 —
    임의 D-Day(`ddays.custom`)는 애초에 여기 들어오지 않는다(구성으로 보장, 설계 §4.14).
    """
    if toggle != "on":
        return None, []
    eligible = [c for c in candidates if is_eligible_d_day(c.d_day)]
    if not eligible:
        return None, []
    winner = min(eligible, key=lambda c: c.d_day)
    return winner, eligible
