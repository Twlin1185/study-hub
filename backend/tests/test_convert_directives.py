"""분류 경로 미리 지정(S13 F40-③, 설계 §4.11) · 출력 잘림 오안내(F40-④) 단위 테스트.

DB·네트워크·LLM 없이 검증 가능한 순수 함수만 고정한다.
"""
from __future__ import annotations

import pytest

from exceptions import ValidationAppError
from services import convert_service


# --- ① category_path 검증 -------------------------------------------------------
def test_category_path_normalizes_whitespace():
    assert (
        convert_service.normalize_category_path("  품질경영기사 / 필기 /2022년 2회 ")
        == "품질경영기사/필기/2022년 2회"
    )


def test_category_path_allows_five_levels():
    path = "/".join(["a", "b", "c", "d", "e"])
    assert convert_service.normalize_category_path(path) == path


def test_category_path_unset_is_none():
    assert convert_service.normalize_category_path(None) is None
    assert convert_service.normalize_category_path("   ") is None


def test_category_path_rejects_six_levels():
    with pytest.raises(ValidationAppError) as excinfo:
        convert_service.normalize_category_path("a/b/c/d/e/f")
    assert excinfo.value.status_code == 422


def test_category_path_rejects_empty_segment():
    with pytest.raises(ValidationAppError):
        convert_service.normalize_category_path("품질경영기사//2022년 2회")
    with pytest.raises(ValidationAppError):
        convert_service.normalize_category_path("품질경영기사/필기/")


def test_category_path_rejects_long_segment():
    with pytest.raises(ValidationAppError):
        convert_service.normalize_category_path("가" * 61)
    assert convert_service.normalize_category_path("가" * 60) == "가" * 60


# --- ② 지시 문자열에 경로가 정확히 1건 ------------------------------------------
def test_directives_pin_exactly_one_path():
    text = convert_service._manual_category_directives("품질경영기사/필기/2022년 2회")
    assert text is not None
    assert text.count("suggest_categories") == 1
    assert '["품질경영기사/필기/2022년 2회"]' in text
    assert "고정하라" in text
    # source_detail 형식 지시도 같은 생성기를 재사용한다(마지막 단계를 라벨로)
    assert '"2022년 2회 M번"' in text


def test_directives_none_when_path_unset():
    assert convert_service._manual_category_directives(None) is None
    assert convert_service._manual_category_directives("") is None


def test_fetch_directives_share_the_same_generator():
    """사이트 반입도 같은 생성기를 쓰므로 경로 고정 지시 형식이 동일하다(중복 구현 금지)."""

    class _Fetched:
        cert_name = "품질경영기사"
        level_hint = "필기"
        exam_key = "2022-2"
        exam_label = "2022년 2회"
        note = None

    text = convert_service._fetch_directives(_Fetched(), cli=True)
    assert text.count("suggest_categories") == 1
    assert '["품질경영기사/필기/2022년 2회"]' in text


def test_directive_path_is_json_escaped():
    """따옴표가 섞인 경로도 프롬프트의 JSON 표기를 깨뜨리지 않는다."""
    text = convert_service._manual_category_directives('기사"X/필기')
    assert '["기사\\"X/필기"]' in text


# --- ③ 출력 잘림 오안내 수정 (F40-④) -------------------------------------------
def _error_info_for(text: str) -> dict:
    with pytest.raises(convert_service.InvalidLlmOutputError) as excinfo:
        convert_service._parse_json_payload(text)
    return convert_service._fallback_error_info(excinfo.value)


def test_truncated_json_reports_invalid_output():
    truncated = '{"format_version": 1, "documents": [{"type": "past_question", "title": "1번 문항", "content": "본문이 여기서 잘'
    info = _error_info_for(truncated)
    assert info["kind"] == "invalid_output"
    assert "잘렸을 수 있습니다" in info["message"]
    assert "나눠 올려" in info["action"]
    assert info["fallback_available"] is False


def test_invalid_output_never_leaks_raw():
    truncated = '{"documents": [{"title": "비밀원문MARKER", "content": "잘린 출력'
    with pytest.raises(convert_service.InvalidLlmOutputError) as excinfo:
        convert_service._parse_json_payload(truncated)
    exc = excinfo.value
    assert exc.detail is None  # AppError.detail에 raw를 담지 않는다
    info = convert_service._fallback_error_info(exc)
    assert "MARKER" not in repr(info)
    assert "raw" not in info


def test_non_truncated_parse_failure_uses_general_message():
    """열려 있지 않은(완결형) 쓰레기 출력은 같은 kind + 일반 문구."""
    info = _error_info_for('{"a": 1,}')
    assert info["kind"] == "invalid_output"
    assert "잘렸을 수 있습니다" not in info["message"]


def test_invalid_output_action_does_not_promise_engine_swap():
    """[API로 재시도] 버튼은 `fallback_available=False`라 렌더되지 않는다 — 안내 문구가
    엔진 교체를 지시하면 제공하지 않는 행동을 시키는 셈이다. 게다가 API 출력 상한
    (`API_MAX_OUTPUT_TOKENS`)은 CLI와의 비대칭을 없애려 맞춘 값이라 잘림도 해결되지 않는다."""
    for text in ('{"documents": [{"title": "잘린', '{"a": 1,}'):
        info = _error_info_for(text)
        assert info["fallback_available"] is False
        assert "엔진" not in info["action"]


def test_regenerate_invalid_output_action_is_context_appropriate():
    """F30 재생성 실패에는 반입 전용 문구('원본을 과목·회차 단위로 나눠 올리기')가 나가면 안 된다."""
    with pytest.raises(convert_service.InvalidLlmOutputError) as excinfo:
        convert_service._parse_json_payload('{"documents": [{"title": "잘린')
    exc = excinfo.value

    regen = convert_service._fallback_error_info(exc, job_kind="regenerate")
    assert regen["kind"] == "invalid_output"  # kind 계약은 유지
    assert "나눠 올리" not in regen["action"]
    assert "재생성" in regen["action"]

    # 반입 경로는 기존 안내 유지
    convert_job = convert_service._fallback_error_info(exc, job_kind="convert")
    assert "나눠 올려" in convert_job["action"]


def test_valid_json_still_parses():
    payload = convert_service._parse_json_payload('```json\n{"format_version": 1}\n```')
    assert payload == {"format_version": 1}
