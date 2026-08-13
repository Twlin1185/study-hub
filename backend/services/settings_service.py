"""설정(키-값) 비즈니스 로직 (설계 §4.10 · ui.theme_custom 검증은 §4.26 ③)."""
from __future__ import annotations

import json
import re
from typing import Any, Callable, Dict

from sqlalchemy import select
from sqlalchemy.orm import Session

import models
from exceptions import ValidationAppError

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
    # S28 — 전역 앱 테마 커스텀(F53, 설계 §4.26 ③). {light?: {...}, dark?: {...}} | None.
    # None = 커스텀 없음(전 항목 기본 토큰 — 복구 경로 [기본값으로 되돌리기]의 저장 형태).
    "ui.theme_custom": None,
}

# --- ui.theme_custom 키별 검증 (§4.26 ③ — 다른 settings 키 계약(§4.10)에는 영향 없음) ---

_HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")

THEME_FONTS = {"sans", "serif", "mono"}
THEME_SIZES = {"small", "default", "large", "xl"}
# 글자·강조색 팔레트 — F52 팔레트 이름 재사용(자유 hex 금지, ①). 배경·서피스는 자유 색.
THEME_PALETTE_NAMES = {"red", "orange", "yellow", "green", "blue", "purple", "gray"}

# 대비 계산용 팔레트 hex — styles/tokens.css --ink-* 값과 동일(단일 출처는 그쪽 CSS,
# 여기는 서버 측 대비 검증을 위한 계산용 사본).
_INK_HEX = {
    "light": {
        "red": "#b91c1c", "orange": "#c2410c", "yellow": "#a16207",
        "green": "#15803d", "blue": "#1d4ed8", "purple": "#7e22ce", "gray": "#4b5563",
    },
    "dark": {
        "red": "#f87171", "orange": "#fb923c", "yellow": "#fbbf24",
        "green": "#4ade80", "blue": "#60a5fa", "purple": "#c084fc", "gray": "#9ca3af",
    },
}
# --bg/--surface/--text/--text-muted 토큰 기본값(styles/tokens.css :root/.dark) — 오버라이드가
# 없는 항목의 대비 검증 기준(muted는 오버라이드 키 자체가 없어 항상 기본값을 쓴다).
_DEFAULT_BG_HEX = {"light": "#f5f6f8", "dark": "#0f1115"}
_DEFAULT_SURFACE_HEX = {"light": "#ffffff", "dark": "#17191f"}
_DEFAULT_TEXT_HEX = {"light": "#14161a", "dark": "#e7e9ee"}
_DEFAULT_MUTED_HEX = {"light": "#6b7280", "dark": "#9aa1ae"}

# WCAG AA 본문 텍스트 기준(4.5:1) — 배경/서피스 위에 일반 크기 본문·UI 텍스트가 얹히므로
# "큰 텍스트"(3:1) 완화 기준이 아니라 표준 본문 기준을 채택(stage-28 구현 실측 채택).
CONTRAST_MIN = 4.5
# --text-muted(보조 텍스트) 기준 — WCAG "큰 텍스트/UI 컴포넌트" 완화 기준(3:1) 준용. 보조
# 텍스트는 본문보다 읽기 비중이 낮지만 완전히 안 보이면 안 되므로 완화하되 0으로 두지 않는다
# (실측: 프론트 프리셋 3종의 bg·surface 전부 최저 3.82:1로 여유 통과 — stage-28 완료 기록).
CONTRAST_MIN_MUTED = 3.0

_FREE_COLOR_KEYS = ("bg", "surface")  # 배경·서피스 계열 — 자유 색 + 대비 검증
_PALETTE_KEYS = ("text", "accent")  # 글자·강조색 계열 — 팔레트만
_THEME_OVERRIDE_KEYS = {"font", "size", *_FREE_COLOR_KEYS, *_PALETTE_KEYS}


def _relative_luminance(hex_color: str) -> float:
    hex_color = hex_color.lstrip("#")

    def _channel(value: int) -> float:
        c = value / 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    r = _channel(int(hex_color[0:2], 16))
    g = _channel(int(hex_color[2:4], 16))
    b = _channel(int(hex_color[4:6], 16))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _contrast_ratio(hex_a: str, hex_b: str) -> float:
    l_a = _relative_luminance(hex_a)
    l_b = _relative_luminance(hex_b)
    lighter, darker = max(l_a, l_b), min(l_a, l_b)
    return (lighter + 0.05) / (darker + 0.05)


def _validate_theme_override(mode: str, override: Any) -> None:
    if not isinstance(override, dict):
        raise ValidationAppError(
            f"ui.theme_custom.{mode}는 객체여야 합니다", detail={"mode": mode}
        )
    unknown = sorted(set(override.keys()) - _THEME_OVERRIDE_KEYS)
    if unknown:
        raise ValidationAppError(
            f"ui.theme_custom.{mode}에 알 수 없는 키가 있습니다: {unknown}",
            detail={"mode": mode, "unknown_keys": unknown},
        )

    font = override.get("font")
    if font is not None and font not in THEME_FONTS:
        raise ValidationAppError(
            f"ui.theme_custom.{mode}.font는 {sorted(THEME_FONTS)} 중 하나여야 합니다",
            detail={"mode": mode, "font": font},
        )

    size = override.get("size")
    if size is not None and size not in THEME_SIZES:
        raise ValidationAppError(
            f"ui.theme_custom.{mode}.size는 {sorted(THEME_SIZES)} 중 하나여야 합니다",
            detail={"mode": mode, "size": size},
        )

    for key in _PALETTE_KEYS:
        value = override.get(key)
        if value is not None and value not in THEME_PALETTE_NAMES:
            raise ValidationAppError(
                f"ui.theme_custom.{mode}.{key}는 팔레트 이름"
                f"({sorted(THEME_PALETTE_NAMES)}) 중 하나여야 합니다 — 글자색·강조색은"
                " 자유 색상을 허용하지 않습니다",
                detail={"mode": mode, key: value},
            )

    for key in _FREE_COLOR_KEYS:
        value = override.get(key)
        if value is not None and not _HEX_RE.match(value):
            raise ValidationAppError(
                f"ui.theme_custom.{mode}.{key}는 '#rrggbb' 형식의 색상 코드여야 합니다",
                detail={"mode": mode, key: value},
            )

    text_value = override.get("text")
    text_hex = _INK_HEX[mode][text_value] if text_value else _DEFAULT_TEXT_HEX[mode]
    muted_hex = _DEFAULT_MUTED_HEX[mode]  # text-muted는 오버라이드 키가 없다 — 항상 기본값

    # 배경·서피스는 미지정이어도 "기본 토큰이 적용된 채로 실제 화면에 뜬다" — 그래서
    # bg/surface를 사용자가 지정하지 않았어도 effective 값(기본 토큰)으로 text/muted
    # 대비를 검사한다(리뷰 지적: text만 지정 시 검증 스킵을 막는다). 기본 토큰 조합은
    # 이미 기준을 넉넉히 통과하도록 설계돼 있어(§6) 이 경로가 거부로 이어지지 않는다 —
    # 오직 사용자가 지정한 bg/surface가 실제 위반일 때만 422가 난다.
    effective_colors = {
        "bg": override.get("bg") or _DEFAULT_BG_HEX[mode],
        "surface": override.get("surface") or _DEFAULT_SURFACE_HEX[mode],
    }
    for key, value in effective_colors.items():
        ratio_text = _contrast_ratio(value, text_hex)
        if ratio_text < CONTRAST_MIN:
            raise ValidationAppError(
                f"ui.theme_custom.{mode}.{key} 색상({value})과 글자색의 명도 대비가"
                f" 기준({CONTRAST_MIN}:1)에 못 미쳐 저장할 수 없습니다(대비 {ratio_text:.2f}:1)"
                " — 다른 색을 선택해 주세요",
                detail={
                    "mode": mode,
                    key: value,
                    "text": text_hex,
                    "contrast_ratio": round(ratio_text, 2),
                    "required": CONTRAST_MIN,
                },
            )

        ratio_muted = _contrast_ratio(value, muted_hex)
        if ratio_muted < CONTRAST_MIN_MUTED:
            raise ValidationAppError(
                f"ui.theme_custom.{mode}.{key} 색상({value})과 보조 글자색(--text-muted)의"
                f" 명도 대비가 기준({CONTRAST_MIN_MUTED}:1)에 못 미쳐 저장할 수 없습니다"
                f"(대비 {ratio_muted:.2f}:1) — 다른 색을 선택해 주세요",
                detail={
                    "mode": mode,
                    key: value,
                    "text_muted": muted_hex,
                    "contrast_ratio": round(ratio_muted, 2),
                    "required": CONTRAST_MIN_MUTED,
                },
            )


def _validate_theme_custom(value: Any) -> None:
    if value is None:
        return  # 복구 경로(R27 ①) — 키 초기화는 검증 대상이 아니다
    if not isinstance(value, dict):
        raise ValidationAppError("ui.theme_custom은 객체여야 합니다")
    unknown = sorted(set(value.keys()) - {"light", "dark"})
    if unknown:
        raise ValidationAppError(
            f"ui.theme_custom에 알 수 없는 키가 있습니다: {unknown}",
            detail={"unknown_keys": unknown},
        )
    for mode in ("light", "dark"):
        if mode in value:
            _validate_theme_override(mode, value[mode])


# 키별 검증 훅 — 이 키에 한해 서버 검증(다른 settings 키 계약(§4.10)에는 영향 0).
_KEY_VALIDATORS: Dict[str, Callable[[Any], None]] = {
    "ui.theme_custom": _validate_theme_custom,
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
        validator = _KEY_VALIDATORS.get(key)
        if validator is not None:
            validator(value)
    for key, value in updates.items():
        row = db.get(models.Setting, key)
        encoded = json.dumps(value, ensure_ascii=False)
        if row is None:
            db.add(models.Setting(key=key, value=encoded))
        else:
            row.value = encoded
    db.commit()
    return get_all_settings(db)
