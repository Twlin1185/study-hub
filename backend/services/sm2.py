"""SM-2 간격반복 엔진 (순수 함수 — DB·시간 의존 없음).

규칙 단일 출처: docs/01-plan/study-app.plan.md §10. 계획서 원문 그대로 구현한다.

- 오답(q<3): repetitions=0, interval=1일, **EF는 유지**(표준 SM-2와 달리 실패 시 EF를 낮추지
  않는다 — 계획서 §10 명시).
- 정답(q>=3): 1회차 interval=1일 → 2회차 6일 → 3회차부터 interval = 이전 interval × EF(반올림).
- EF 갱신(정답일 때만): EF' = EF + (0.1 − (5−q)(0.08 + (5−q)×0.02)), 하한 1.3.

due_date 계산(= 오늘 + interval)과 last_reviewed 기록은 DB 레이어(attempt_service·srs_service)의
책임이다. 이 모듈은 파라미터 계산만 담당해 단위 테스트가 시간·DB 없이 결정적이도록 한다.
"""
from __future__ import annotations

from dataclasses import dataclass

MIN_EASE_FACTOR = 1.3
DEFAULT_EASE_FACTOR = 2.5
PASS_THRESHOLD = 3  # q >= 3 이면 정답(pass), q < 3 이면 오답(fail)


@dataclass
class Card:
    """SM-2 스케줄 파라미터 (ORM과 분리된 순수 값 객체)."""

    ease_factor: float = DEFAULT_EASE_FACTOR
    interval_days: int = 0
    repetitions: int = 0


def update(card: Card, q: int) -> Card:
    """품질점수 q(0~5)로 카드를 갱신한 **새 Card**를 반환한다(입력 카드는 불변).

    q 매핑은 quality_for_attempt()/호출자가 결정한다. 여기서는 값만 받는다.
    """
    if not isinstance(q, int) or not (0 <= q <= 5):
        raise ValueError(f"q는 0~5 정수여야 합니다: {q!r}")

    ease_factor = card.ease_factor

    if q < PASS_THRESHOLD:
        # 오답: 반복 초기화, interval=1, EF 유지
        return Card(ease_factor=ease_factor, interval_days=1, repetitions=0)

    # 정답: EF 먼저 갱신(하한 1.3)
    delta = 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)
    ease_factor = max(MIN_EASE_FACTOR, ease_factor + delta)

    repetitions = card.repetitions + 1
    if repetitions == 1:
        interval_days = 1
    elif repetitions == 2:
        interval_days = 6
    else:
        interval_days = max(1, round(card.interval_days * ease_factor))

    return Card(
        ease_factor=ease_factor,
        interval_days=interval_days,
        repetitions=repetitions,
    )


def quality_for_attempt(
    is_correct: bool,
    mode: str | None,
    time_spent: int | None,
    avg_time: float | None,
) -> int:
    """풀이(attempts) 1건의 품질점수 q 산출 (계획서 §10 매핑).

    - 오답 → 1
    - 오답노트 재도전(복습 세션, mode='review') 정답 → 3
    - 플래시카드 정답 → 4
    - 퀴즈 정답: 문항 평균시간 이하면 5, 초과(또는 판단 불가)면 4

    '오답노트 재도전'은 attempts 요청의 mode='review'로 식별한다(설계 §4.5의 mode
    'quiz'|'review'|'flashcard' 중 review = wrong_only 복습 세션). 평균시간 자료가 없는
    첫 풀이는 '빠름'을 단정할 수 없으므로 보수적으로 4(느림)로 둔다.
    """
    if not is_correct:
        return 1
    if mode == "review":
        return 3
    if mode == "flashcard":
        return 4
    # quiz / study / 기타 정답
    if time_spent is not None and avg_time is not None and time_spent <= avg_time:
        return 5
    return 4
