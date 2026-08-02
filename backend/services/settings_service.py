"""설정(키-값) 비즈니스 로직 (설계 §4.10)."""
from __future__ import annotations

import json
from typing import Any, Dict

from sqlalchemy import select
from sqlalchemy.orm import Session

import models

DEFAULTS: Dict[str, Any] = {
    "quiz.default_count": 20,
    "srs.daily_limit": 30,  # 계획서 §10 · stage-5 기본값
    "srs.dday_boost": "on",  # S11(F16, 설계 §4.14) — 'on'|'off', D-Day 복습 강도 조절 토글
    "backup.auto": False,
    # S8 — LLM 엔진 관리 (F34→F41, 설계 §4.17)
    "llm.priority": "cli",  # legacy 스칼라('cli'|'api') 또는 엔진 id 배열 — 읽기 시
    # llm_engine_service.normalize_priority가 항상 유효 배열로 정규화한다(§4.17 ①)
    "llm.fallback": "ask",  # 'auto' | 'ask' | 'off' — auto는 과금 동의 UI 통과 시에만 프론트가 설정
    "llm.api_model": "claude-sonnet-5",
    "llm.last_limit": None,  # {engine, limit_kind, resets_at} | None — 최근 429 한도 기억
    # S21 — 엔진 운용 제어(F47, 설계 §4.23). llm.disabled: 비활성 엔진 id 배열(부정 목록,
    # 빈 배열 = 전 엔진 활성). llm.models: {엔진id: 모델id}(소목록 밖 값은 무시·기본값
    # 폴백 — llm_engine_service가 판정).
    "llm.disabled": [],
    "llm.models": {},
    # S10 — 일일 학습 목표 (F26, 설계 §4.13). 양의 정수, None/0 = 목표 없음
    "goal.daily_questions": None,
    "goal.daily_minutes": None,
    # S19 — 응용 모의고사(F45, 설계 §4.21 결정 ①) 예약 루트 분류 포인터. 부재·삭제 시
    # applied_exam_service가 재생성 후 갱신한다 — 사용자가 직접 편집하는 설정이 아니다.
    "applied_exam.root_category_id": None,
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
