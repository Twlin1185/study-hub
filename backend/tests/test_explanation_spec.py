"""S57(FB-35ⓐ) — 해설 규격 프롬프트 조립 단위 테스트(LLM 실호출 0)."""
from __future__ import annotations

import models
from services import convert_service

OUT_HEADER = "## 출력 형식(엄수)"


def _doc(type_: str = "past_question") -> models.Document:
    return models.Document(
        id=1, doc_no="D-1", type=type_, title="t", content="본문", answer="2", explanation=None
    )


def _explain(choices):
    return convert_service._build_explain_prompt(_doc(), choices, None, engine="api")


def _regen(type_, choices=None):
    return convert_service._build_regenerate_prompt(
        _doc(type_), [], choices, "사유", None, engine="api"
    )


def test_explain_multiple_choice_has_full_spec():
    p = _explain(["a", "b", "c", "d"])
    for word in ("정답 근거", "오답 보기", "핵심 개념", "400~700자", "창작 금지"):
        assert word in p
    assert p.index("## 해설 작성 규격") < p.index(OUT_HEADER)
    assert "\n\n## 해설 작성 규격" in p and "\n\n" + OUT_HEADER in p


def test_explain_without_choices_uses_short_block():
    p = _explain(None)
    assert "오답 보기" not in p
    assert "200~400자" in p and "정답 근거" in p and "핵심 개념" in p
    assert "400~700자" not in p


def test_regenerate_question_type_has_condition_and_spec():
    p = _regen("past_question", ["a", "b"])
    assert "explanation을 새로 쓰거나 고쳐 쓰는 경우에만 아래 규격을 따른다." in p
    assert "## 해설 작성 규격" in p and "오답 보기" in p
    assert p.index("## 해설 작성 규격") < p.index(OUT_HEADER)


def test_regenerate_concept_has_no_spec():
    p = _regen("concept")
    assert "해설 작성 규격" not in p
    assert "explanation을 새로 쓰거나" not in p


def test_output_format_lines_unchanged():
    explain = _explain(["a", "b"])
    assert '{"explanation": "...", "answer": "..." | null}' in explain
    regen = _regen("question", ["a", "b"])
    assert (
        '{"title": "...", "content": "...", "choices": ["...", ...] | null, '
        '"answer": "..." | null, "explanation": "..." | null, "difficulty": 1~5 | null, '
        '"tags": ["...", ...]}'
    ) in regen
