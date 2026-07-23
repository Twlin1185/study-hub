"""설정(키-값) 비즈니스 로직 (설계 §4.10)."""
from __future__ import annotations

import json
from typing import Any, Dict

from sqlalchemy import select
from sqlalchemy.orm import Session

import models

DEFAULTS: Dict[str, Any] = {
    "quiz.default_count": 20,
    "srs.daily_limit": 20,
    "backup.auto": False,
}


def _decode(raw: str | None, fallback: Any) -> Any:
    if raw is None:
        return fallback
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return raw


def get_all_settings(db: Session) -> Dict[str, Any]:
    rows = db.execute(select(models.Setting)).scalars().all()
    stored = {row.key: _decode(row.value, None) for row in rows}
    merged = dict(DEFAULTS)
    merged.update(stored)
    return merged


def get_setting(db: Session, key: str, fallback: Any = None) -> Any:
    row = db.get(models.Setting, key)
    if row is None:
        return DEFAULTS.get(key, fallback)
    return _decode(row.value, DEFAULTS.get(key, fallback))


def update_settings(db: Session, updates: Dict[str, Any]) -> Dict[str, Any]:
    for key, value in updates.items():
        row = db.get(models.Setting, key)
        encoded = json.dumps(value, ensure_ascii=False)
        if row is None:
            db.add(models.Setting(key=key, value=encoded))
        else:
            row.value = encoded
    db.commit()
    return get_all_settings(db)
