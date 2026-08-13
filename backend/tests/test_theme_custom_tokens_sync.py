"""S28 — ui.theme_custom 대비 검증용 하드코딩 사본이 tokens.css(정본)·프론트 미러
(themeCustomPresets.ts·color.ts)와 어긋나지 않는지 확인하는 회귀 테스트
(stage-28 검토 권고 이행 + 3차 검토 경미-7 확장).

settings_service.py는 서버 측 명도 대비 계산을 위해 styles/tokens.css의 --ink-*,
--text, --text-muted, --bg, --surface 값을 상수로 복제해 갖고 있다(단일 출처는
CSS). 프론트도 즉시 피드백용으로 같은 값을 themeCustomPresets.ts(INK_HEX·
DEFAULT_TOKEN_VALUES)·color.ts(CONTRAST_MIN·CONTRAST_MIN_MUTED)에 복제한다 —
3중 복제(tokens.css·백엔드·프론트)가 이 파일에서 전부 기계로 봉인된다.
프론트 TS 파일은 실행하지 않고 **텍스트로만 파싱**한다(빌드 불요 — 백엔드
pytest가 프론트 타입스크립트를 import할 수 없으므로 정규식 파싱이 유일한 방법).
"""
from __future__ import annotations

import re
from pathlib import Path

from services import settings_service

FRONTEND_SRC = Path(__file__).resolve().parents[2] / "frontend" / "src"
TOKENS_CSS_PATH = FRONTEND_SRC / "styles" / "tokens.css"
THEME_PRESETS_TS_PATH = FRONTEND_SRC / "utils" / "themeCustomPresets.ts"
COLOR_TS_PATH = FRONTEND_SRC / "utils" / "color.ts"

_VAR_RE = re.compile(r"--([\w-]+):\s*(#[0-9a-fA-F]{6})")
_TS_KV_RE = re.compile(r"(\w+):\s*'(#[0-9a-fA-F]{6})'")


def _extract_balanced_block(text: str, open_brace_pattern: str) -> str:
    """`open_brace_pattern`(정규식, 여는 `{`로 끝나야 함)이 매치되는 지점부터 짝이
    맞는 `}`까지(중첩 허용)의 내부 텍스트.

    TS 객체 리터럴은 중첩되므로(예: `INK_HEX = { light: {...}, dark: {...} }`)
    단순 `[^}]*` 정규식으로는 바깥쪽에서 끊긴다 — 중괄호 카운팅으로 정확히 짝을
    맞춘다. `export const NAME: Record<X, { ... }> = {`처럼 타입 주석 안에 `{`가
    먼저 나오는 경우를 피하려면 패턴에 `[^=]*=\\s*\\{`를 넣어 "=" 뒤의 진짜
    이니셜라이저 `{`까지 건너뛴다. 형식(줄바꿈·들여쓰기)에는 둔감, 값 불일치에는
    민감하다.
    """
    match = re.search(open_brace_pattern, text)
    assert match is not None, f"패턴 '{open_brace_pattern}'을 찾지 못했습니다"
    brace_start = match.end() - 1
    assert text[brace_start] == "{", (
        f"패턴 '{open_brace_pattern}'이 '{{'로 끝나야 합니다"
    )
    depth = 0
    for i in range(brace_start, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                return text[brace_start + 1 : i]
    raise AssertionError(f"'{open_brace_pattern}' 블록의 닫는 중괄호를 찾지 못했습니다")


def _extract_block(css_text: str, selector_line_pattern: str) -> dict[str, str]:
    """최상위(들여쓰기 없는) 셀렉터 블록 하나를 찾아 --var: #hex 쌍을 뽑는다.

    `@media print` 안의 `:root,\n  .dark {` 같은 결합 셀렉터는 들여써 있으므로
    MULTILINE `^` 앵커가 걸러낸다(현재 tokens.css 포맷 — 사람이 읽는 CSS라 재포맷
    시 이 테스트가 먼저 깨질 수 있다. 그럴 땐 이 파서를 갱신할 것).
    """
    match = re.search(
        rf"^{selector_line_pattern} \{{([^}}]*)\}}", css_text, re.MULTILINE
    )
    assert match is not None, f"tokens.css에서 '{selector_line_pattern}' 블록을 찾지 못했습니다"
    return dict(_VAR_RE.findall(match.group(1)))


def _load_tokens() -> tuple[dict[str, str], dict[str, str]]:
    css_text = TOKENS_CSS_PATH.read_text(encoding="utf-8")
    light = _extract_block(css_text, r":root")
    dark = _extract_block(css_text, r"\.dark")
    return light, dark


def test_ink_hex_matches_tokens_css() -> None:
    light, dark = _load_tokens()
    for name in ("red", "orange", "yellow", "green", "blue", "purple", "gray"):
        assert settings_service._INK_HEX["light"][name] == light[f"ink-{name}"], (
            f"light ink-{name} 드리프트 — settings_service._INK_HEX를 tokens.css에 맞춰라"
        )
        assert settings_service._INK_HEX["dark"][name] == dark[f"ink-{name}"], (
            f"dark ink-{name} 드리프트 — settings_service._INK_HEX를 tokens.css에 맞춰라"
        )


def test_default_text_and_muted_match_tokens_css() -> None:
    light, dark = _load_tokens()
    assert settings_service._DEFAULT_TEXT_HEX["light"] == light["text"]
    assert settings_service._DEFAULT_TEXT_HEX["dark"] == dark["text"]
    assert settings_service._DEFAULT_MUTED_HEX["light"] == light["text-muted"]
    assert settings_service._DEFAULT_MUTED_HEX["dark"] == dark["text-muted"]


def test_default_bg_and_surface_match_tokens_css() -> None:
    light, dark = _load_tokens()
    assert settings_service._DEFAULT_BG_HEX["light"] == light["bg"]
    assert settings_service._DEFAULT_BG_HEX["dark"] == dark["bg"]
    assert settings_service._DEFAULT_SURFACE_HEX["light"] == light["surface"]
    assert settings_service._DEFAULT_SURFACE_HEX["dark"] == dark["surface"]


# --- 프론트 미러 (frontend/src/utils/themeCustomPresets.ts · color.ts) ---
# 텍스트 파싱만 — TS 컴파일·실행 없음(백엔드 pytest 환경에는 Node/TS 툴체인이 없다).


def _load_theme_presets_ts() -> str:
    return THEME_PRESETS_TS_PATH.read_text(encoding="utf-8")


def test_frontend_ink_hex_matches_settings_service() -> None:
    ts_text = _load_theme_presets_ts()
    ink_block = _extract_balanced_block(ts_text, r"export const INK_HEX[^=]*=\s*\{")
    light_block = _extract_balanced_block(ink_block, r"light\s*:\s*\{")
    dark_block = _extract_balanced_block(ink_block, r"dark\s*:\s*\{")
    frontend_light = dict(_TS_KV_RE.findall(light_block))
    frontend_dark = dict(_TS_KV_RE.findall(dark_block))

    for name in ("red", "orange", "yellow", "green", "blue", "purple", "gray"):
        assert frontend_light[name] == settings_service._INK_HEX["light"][name], (
            f"frontend themeCustomPresets.ts INK_HEX.light.{name} 드리프트"
            " — settings_service._INK_HEX와 어긋난다"
        )
        assert frontend_dark[name] == settings_service._INK_HEX["dark"][name], (
            f"frontend themeCustomPresets.ts INK_HEX.dark.{name} 드리프트"
            " — settings_service._INK_HEX와 어긋난다"
        )


def test_frontend_default_token_values_match_settings_service() -> None:
    ts_text = _load_theme_presets_ts()
    block = _extract_balanced_block(
        ts_text, r"export const DEFAULT_TOKEN_VALUES[^=]*=\s*\{"
    )
    light_block = _extract_balanced_block(block, r"light\s*:\s*\{")
    dark_block = _extract_balanced_block(block, r"dark\s*:\s*\{")
    frontend_light = dict(_TS_KV_RE.findall(light_block))
    frontend_dark = dict(_TS_KV_RE.findall(dark_block))

    assert frontend_light["bg"] == settings_service._DEFAULT_BG_HEX["light"]
    assert frontend_dark["bg"] == settings_service._DEFAULT_BG_HEX["dark"]
    assert frontend_light["surface"] == settings_service._DEFAULT_SURFACE_HEX["light"]
    assert frontend_dark["surface"] == settings_service._DEFAULT_SURFACE_HEX["dark"]
    assert frontend_light["text"] == settings_service._DEFAULT_TEXT_HEX["light"]
    assert frontend_dark["text"] == settings_service._DEFAULT_TEXT_HEX["dark"]
    assert frontend_light["textMuted"] == settings_service._DEFAULT_MUTED_HEX["light"]
    assert frontend_dark["textMuted"] == settings_service._DEFAULT_MUTED_HEX["dark"]


def test_frontend_contrast_thresholds_match_settings_service() -> None:
    color_ts_text = COLOR_TS_PATH.read_text(encoding="utf-8")

    min_match = re.search(r"CONTRAST_MIN\s*=\s*([\d.]+)", color_ts_text)
    assert min_match is not None, "color.ts에서 CONTRAST_MIN을 찾지 못했습니다"
    assert float(min_match.group(1)) == settings_service.CONTRAST_MIN

    muted_match = re.search(r"CONTRAST_MIN_MUTED\s*=\s*([\d.]+)", color_ts_text)
    assert muted_match is not None, "color.ts에서 CONTRAST_MIN_MUTED를 찾지 못했습니다"
    assert float(muted_match.group(1)) == settings_service.CONTRAST_MIN_MUTED
