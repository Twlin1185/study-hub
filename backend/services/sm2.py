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
    prev_incorrect: bool,
    time_spent: int | None,
    avg_time: float | None,
) -> int:
    """풀이(attempts) 1건의 품질점수 q 산출 (계획서 §10 — E안: 직전 결과 분기).

    - 오답 → 1
    - 회복 정답: 그 문서의 **직전 시도가 오답**(prev_incorrect=True)이었으면 화면(mode) 무관
      정답 시 q=3 ("간신히 회복" 신호)
    - 그 외 정답: 문항 평균시간 이하면 5, 초과(또는 판단 불가)면 4. 첫 풀이 정답(직전 시도
      없음 → prev_incorrect=False)도 여기 해당

    화면 종류(mode)가 아니라 직전 attempt 결과로 판정한다(경로 무관 일관성, 2026-07 결정).
    "복습 세션 정답=무조건 q3" 방식은 잘 아는 카드의 EF가 복습할수록 감소하는 역설을 만들어
    폐기됐다. 플래시카드 자가판정(안다=4/모른다=1)은 srs/answer가 q를 직접 전달하므로 이
    함수를 거치지 않는다. 평균시간 자료가 없는 첫 풀이는 '빠름'을 단정할 수 없어 보수적으로 4.
    """
    if not is_correct:
        return 1
    if prev_incorrect:
        return 3
    if time_spent is not None and avg_time is not None and time_spent <= avg_time:
        return 5
    return 4
