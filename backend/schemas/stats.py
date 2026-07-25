"""통계 응답 스키마 (설계 §4.1, §4.8)."""
from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class HeatmapItem(BaseModel):
    date: str  # YYYY-MM-DD
    count: int
    # S10 (F26): 목표가 하나라도 설정된 경우에만 채움. 미설정 시 응답에서 생략(exclude_none).
    goal_met: Optional[bool] = None


class StreakGoal(BaseModel):
    questions: Optional[int] = None
    minutes: Optional[int] = None


class StreakToday(BaseModel):
    questions: int
    minutes: int
    goal: StreakGoal
    goal_met: bool


class StreakResponse(BaseModel):
    current_streak: int
    best_streak: int
    today: StreakToday


class WeaknessItem(BaseModel):
    document_id: int
    doc_no: str
    title: str
    type: str
    category_path: Optional[str] = None
    attempts: int
    accuracy: float


class CategoryStatsItem(BaseModel):
    category_id: int
    name: str
    progress: Optional[float] = None
    accuracy: float = 0.0
    attempt_count: int = 0


class CategoryStatsResponse(BaseModel):
    category_id: int
    children: List[CategoryStatsItem] = Field(default_factory=list)


class AccuracyTrendItem(BaseModel):
    date: str  # YYYY-MM-DD
    attempts: int
    correct: int
    accuracy: float
