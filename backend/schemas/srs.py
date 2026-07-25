"""복습(SRS) 스키마 (설계 §4.7)."""
from __future__ import annotations

import datetime as dt
from typing import List, Optional

from pydantic import BaseModel, Field


class SrsAnswerRequest(BaseModel):
    """플래시카드 자가판정 — 풀이 기록(attempts) 없이 SM-2만 갱신한다."""

    document_id: int
    q: int = Field(ge=0, le=5)  # 계획서 §10: 안다=4 / 모른다=1 등


class SrsAnswerResult(BaseModel):
    ease_factor: float
    interval_days: int
    due_date: Optional[dt.date] = None


class SrsSummary(BaseModel):
    """`GET /api/srs/summary` (설계 §4.12, F36-③·①) — 복습 완료 화면 "내일 N개 예정",
    홈 daily_start 위젯 분량 예고에 쓰인다.

    today_due = 오늘 큐 잔여 수(상한 적용) — `count_due_today`와 동일 계산.
    tomorrow_due = 내일까지 due인 카드 수(오늘 미소화 이월 포함) — 상한 동일 적용.
    """

    today_due: int
    tomorrow_due: int


class SrsCardOut(BaseModel):
    """오늘의 복습 큐 항목 — 렌더에 필요한 문서 필드 + 스케줄 메타.

    서버 채점 원칙(불변 규칙 1)에 따라 문제 타입(question/past_question)의 정답·해설은
    담지 않는다(그 문제는 attempts 경로로 채점). 플래시카드 타입만 뒤집기(back)를 위해
    answer·explanation을 함께 내려준다(플래시카드는 서버 채점이 없는 자가판정).
    """

    document_id: int
    doc_no: str
    type: str
    title: str
    content: Optional[str] = None
    choices: Optional[List[str]] = None
    difficulty: Optional[int] = None
    due_date: Optional[dt.date] = None
    ease_factor: float
    interval_days: int
    repetitions: int
    has_review_note: bool = False  # 미해결 오답노트 존재 = 우선순위 상위
    # 플래시카드 뒤집기용 (flashcard 타입에서만 채움, 그 외 null)
    answer: Optional[str] = None
    explanation: Optional[str] = None
