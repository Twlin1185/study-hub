from __future__ import annotations

import datetime as dt
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from schemas.study import ContinueCard


class DDayItem(BaseModel):
    kind: Literal["category", "custom"] = "category"
    category_id: Optional[int] = None
    id: Optional[str] = None
    name: str
    exam_date: dt.date
    d_day: int


class RecentStats(BaseModel):
    attempts_7d: int = 0
    accuracy_7d: float = 0.0


class DashboardResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    today_review: int = 0
    continue_: List[ContinueCard] = Field(default_factory=list, alias="continue")
    ddays: List[DDayItem] = Field(default_factory=list)
    recent: RecentStats = Field(default_factory=RecentStats)
    # S9(F36-①) — daily_start 위젯 분량 예고용 대략치(설계 §4.12)
    today_review_minutes: int = 0
