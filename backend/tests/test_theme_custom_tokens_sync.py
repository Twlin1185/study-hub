"""S28 — ui.theme_custom 대비 검증용 하드코딩 사본이 tokens.css(정본)와 어긋나지
않는지 확인하는 회귀 테스트 (stage-28 검토 권고 이행).

settings_service.py는 서버 측 명도 대비 계산을 위해 styles/tokens.css의 --ink-*,
--text, --text-muted, --bg, --surface 값을 상수로 복제해 갖고 있다(단일 출처는
CSS). 프론트가 tokens.css 값을 바꾸는데 이 사본을 안 고치면 대비 검증 결과가
실제 렌더와 어긋난다 — 이 테스트가 그 드리프트를 실패로 잡는다.
"""
from __future__ import annotations

import re
from pathlib import Path

from services import settings_service

TOKENS_CSS_PATH = (
    Path(__file__).resolve().parents[2] / "frontend" / "src" / "styles" / "tokens.css"
)

_VAR_RE = re.compile(r"--([\w-]+):\s*(#[0-9a-fA-F]{6})")


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
