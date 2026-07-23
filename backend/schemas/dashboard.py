from __future__ import annotations

import datetime as dt
from typing import List

from pydantic import BaseModel, ConfigDict, Field

from schemas.study import ContinueCard


class DDayItem(BaseModel):
    category_id: int
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
