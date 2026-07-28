"""변환 신뢰 게이트 (S15 · F41 — 설계 §4.17 ⑤·⑥, 계획서 §8.2 v1.1) 단위 테스트.

불변 규칙 7의 **예외** — 반입 정확성에 직결되는 핵심 로직이라 `services/sm2.py`와 같은 급의
필수 테스트로 취급한다(stage-15 3·5절).

고정하는 계약:
  ① 원문 대조 알고리즘(정규화 · 부분 문자열 · 12자 조각 커버리지 0.6 · 길이<10 생략 · 원본 <200자)
  ② 창작 의심 검출(원본에 없는 보기) → `fabrication_suspect`
  ③ `answer_source: "solved"` → `solved_answer`(기본 반입 제외 신호)
  ④ 대조 불가(`match_unavailable`)는 **조용한 통과 금지** — 배지는 뜨되 기본 포함 유지
  ⑤ 객관식 `answer` 번호 정합(파이프라인=번호만, 직접 업로드=전체 일치 시 번호로 정규화)
  ⑥ 순수 JSON 위반 = `invalid_output` (관대한 코드펜스 벗겨내기 없음)
  ⑦ 직접 업로드 JSON에는 대조 배지가 붙지 않는다(원본이 서버에 없음)
  ⑧ 보존→복구 경로에서도 warnings가 유지된다(F40-① 정합)
"""
from __future__ import annotations

import json

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base
from services import convert_service, import_service, preview_store, source_match


# ---------------------------------------------------------------------------
# 픽스처
# ---------------------------------------------------------------------------
@pytest.fixture()
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


@pytest.fixture(autouse=True)
def isolated_dirs(tmp_path, monkeypatch):
    auto_dir = tmp_path / "import" / "auto"
    sources_dir = tmp_path / "sources"
    auto_dir.mkdir(parents=True)
    sources_dir.mkdir(parents=True)
    monkeypatch.setattr(preview_store, "AUTO_DIR", auto_dir)
    monkeypatch.setattr(preview_store, "SOURCES_DIR", sources_dir)
    monkeypatch.setattr(import_service, "SOURCES_DIR", sources_dir)
    import_service._PREVIEW_CACHE.clear()
    import_service._COMMITTED.clear()
    yield
    import_service._PREVIEW_CACHE.clear()
    import_service._COMMITTED.clear()


# 원본 텍스트(정규화 200자 이상 — "대조 불가"가 아닌 정상 대조 상태를 만든다)
SOURCE_TEXT = """
--- page 1 ---
품질경영기사 2022년 2회 필기

1. 다음 중 제3정규형(3NF)의 조건으로 옳은 것은?
 1) 이행적 함수 종속을 제거한 상태이다
 2) 부분 함수 종속을 제거한 상태이다
 3) 모든 속성이 원자값만 갖는 상태이다
 4) 모든 결정자가 후보키인 상태이다

2. 관리도에서 군내변동과 군간변동을 비교해 공정의 안정 상태를 판정하는 지표로 옳은 것은?
 1) 공정능력지수 Cp
 2) 공정성능지수 Pp
 3) 시그마 수준
 4) 관리한계선의 폭

3. 다음 중 데이터베이스 트랜잭션의 원자성에 대한 설명으로 가장 옳은 것은?
 1) 트랜잭션의 연산은 모두 반영되거나 전혀 반영되지 않아야 한다
 2) 트랜잭션이 성공하면 결과는 영구적으로 반영되어야 한다
 3) 동시에 수행되는 트랜잭션은 서로 영향을 주지 않아야 한다
 4) 트랜잭션 수행 전후에 데이터베이스는 일관된 상태를 유지해야 한다

정답: 1번 ①, 2번 ①, 3번 ①
"""


def _envelope(documents: list) -> bytes:
    return json.dumps(
        {"format_version": 1, "source": {"filename": "기출.txt"}, "documents": documents},
        ensure_ascii=False,
    ).encode("utf-8")


def _question(**overrides) -> dict:
    doc = {
        "type": "past_question",
        "title": "2022-2회 1번: 제3정규형",
        "content": "다음 중 제3정규형(3NF)의 조건으로 옳은 것은?",
        "choices": [
            "이행적 함수 종속을 제거한 상태이다",
            "부분 함수 종속을 제거한 상태이다",
            "모든 속성이 원자값만 갖는 상태이다",
            "모든 결정자가 후보키인 상태이다",
        ],
        "answer": "1",
        "answer_source": "original",
    }
    doc.update(overrides)
    return doc


def _preview(db, documents, **kwargs):
    kwargs.setdefault("source_filename", "기출.txt")
    kwargs.setdefault("source_bytes", SOURCE_TEXT.encode("utf-8"))
    kwargs.setdefault("gate", True)
    kwargs.setdefault("strict", True)
    return import_service.create_preview(db, json_bytes=_envelope(documents), **kwargs)


# ---------------------------------------------------------------------------
# ① 원문 대조 알고리즘 (설계 §4.17 ⑥ ⓐ~ⓒ)
# ---------------------------------------------------------------------------
def test_normalize_keeps_only_letters_and_digits():
    assert source_match.normalize("가나-다 (라) 3NF!\n마") == "가나다라3nf마"
    assert source_match.normalize(None) == ""


def test_substring_candidate_passes():
    matcher = source_match.SourceMatcher(SOURCE_TEXT)
    assert matcher.available is True
    assert matcher.matches("다음 중 제3정규형(3NF)의 조건으로 옳은 것은?") is True
    # 공백·구두점·줄바꿈이 달라도 통과(정규화가 흡수한다)
    assert matcher.matches("다음중 제 3 정규형 3NF 의 조건으로 옳은 것은") is True


def test_short_candidate_is_skipped():
    """정규화 길이 <10 상투구는 판정 생략(오탐 방지) — 원본에 없어도 통과."""
    matcher = source_match.SourceMatcher(SOURCE_TEXT)
    assert source_match.normalize("옳은 것은?") == "옳은것은"
    assert matcher.matches("옳은 것은?") is True


def test_fabricated_candidate_fails():
    matcher = source_match.SourceMatcher(SOURCE_TEXT)
    assert matcher.matches("표본평균의 표준편차는 모표준편차를 표본크기의 제곱근으로 나눈 값이다") is False


def test_partial_extraction_noise_passes_by_chunk_coverage():
    """추출 과정의 글리프 소실(중간 몇 글자 깨짐)은 조각 커버리지 0.6이 흡수한다."""
    matcher = source_match.SourceMatcher(SOURCE_TEXT)
    noisy = "관리도에서 군내변동과 군간변동을 비교해 XX공정의 안정 상태를 판정하는 지표로 옳은 것은?"
    assert matcher.matches(noisy) is True


def test_chunks_cover_the_tail():
    """마지막 조각은 끝에서 12자 — 꼬리를 버리지 않는다."""
    parts = source_match._chunks("abcdefghijklmnop")  # 16자
    assert parts[0] == "abcdefghijkl"
    assert parts[-1] == "efghijklmnop"


def test_short_source_is_match_unavailable():
    """원본 정규화 텍스트 <200자 = 대조 불가(이미지 PDF·추출 붕괴)."""
    matcher = source_match.SourceMatcher("짧은 원본")
    assert matcher.available is False
    # 대조 불가 상태에서는 판정하지 않는다(항상 통과 — 배지로만 알린다)
    assert matcher.matches("원본에 전혀 없는 문장이지만 대조 불가라 통과한다 그렇다") is True
    assert source_match.SourceMatcher(None).available is False


def test_extract_source_text_rejects_binary_formats():
    assert source_match.extract_source_text("그림.png", b"\x89PNG\r\n") is None
    assert source_match.extract_source_text("기출.txt", "본문".encode("utf-8")) == "본문"
    assert source_match.extract_source_text("기출.pdf", b"not a pdf") is None
    assert source_match.extract_source_text(None, None) is None


# ---------------------------------------------------------------------------
# ② 창작 의심 검출 (원본에 없는 보기 문자열)
# ---------------------------------------------------------------------------
def test_clean_item_has_no_warnings(db):
    preview = _preview(db, [_question()])
    assert preview.items[0].status == "ok"
    assert preview.items[0].warnings == []
    assert preview.summary.warning == 0


def test_fabricated_choice_is_flagged(db):
    fabricated = _question(
        choices=[
            "이행적 함수 종속을 제거한 상태이다",
            "표본크기가 커질수록 신뢰구간의 폭은 넓어진다",  # 원본에 없는 창작 보기
            "모든 속성이 원자값만 갖는 상태이다",
            "모든 결정자가 후보키인 상태이다",
        ]
    )
    preview = _preview(db, [fabricated])
    assert preview.items[0].warnings == ["fabrication_suspect"]
    assert preview.summary.warning == 1


def test_fabricated_stem_is_flagged(db):
    preview = _preview(
        db,
        [_question(content="다음 중 계수형 샘플링검사의 OC곡선에 대한 설명으로 옳지 않은 것은?")],
    )
    assert "fabrication_suspect" in preview.items[0].warnings


def test_concept_documents_are_not_matched(db):
    """개념 문서는 요약·재구조화가 본질 — 대조 대상에서 제외(설계 §4.17 ⑥, G2 실증)."""
    concept = {
        "type": "concept",
        "title": "정규화 개요",
        "content": "정규화는 이상현상을 제거하기 위해 릴레이션을 분해하는 과정이다(원본에 없는 재구성 문장).",
    }
    preview = _preview(db, [concept])
    assert preview.items[0].status == "ok"
    assert preview.items[0].warnings == []


# ---------------------------------------------------------------------------
# ③ answer_source: solved → 기본 반입 제외 신호
# ---------------------------------------------------------------------------
def test_solved_answer_is_flagged(db):
    preview = _preview(db, [_question(answer_source="solved")])
    assert preview.items[0].warnings == ["solved_answer"]
    assert preview.summary.warning == 1


def test_solved_and_fabrication_can_stack(db):
    preview = _preview(
        db,
        [
            _question(
                answer_source="solved",
                content="원본 어디에도 없는 완전히 새로운 지문을 모델이 만들어 냈다고 하자",
            )
        ],
    )
    assert set(preview.items[0].warnings) == {"solved_answer", "fabrication_suspect"}
    assert preview.summary.warning == 1  # 경고 '항목 수'다(경고 개수가 아니다)


def test_missing_answer_source_is_error_in_pipeline(db):
    item = _question()
    del item["answer_source"]
    preview = _preview(db, [item])
    assert preview.items[0].status == "error"
    assert any("answer_source" in e for e in preview.items[0].errors)


def test_invalid_answer_source_value_is_error(db):
    preview = _preview(db, [_question(answer_source="guessed")])
    assert preview.items[0].status == "error"


def test_missing_answer_source_is_original_for_direct_upload(db):
    """직접 업로드 JSON은 누락 허용 → original 간주(§8.2 v1.1 하위 호환)."""
    item = _question()
    del item["answer_source"]
    preview = _preview(db, [item], gate=False, strict=False)
    assert preview.items[0].status == "ok"
    assert preview.items[0].warnings == []


# ---------------------------------------------------------------------------
# ④ 대조 불가 — 조용한 통과 금지, 단 기본 반입은 유지
# ---------------------------------------------------------------------------
def test_match_unavailable_when_source_text_cannot_be_extracted(db):
    preview = _preview(
        db, [_question()], source_filename="스캔본.png", source_bytes=b"\x89PNG\r\n\x1a\n"
    )
    assert preview.items[0].warnings == ["match_unavailable"]
    assert preview.items[0].status == "ok"  # 기본 반입은 유지(상태는 정상)


def test_match_unavailable_when_no_source_file(db):
    preview = _preview(db, [_question()], source_filename=None, source_bytes=None)
    assert preview.items[0].warnings == ["match_unavailable"]


def test_match_unavailable_does_not_imply_fabrication(db):
    """대조 불가 상태에서 창작 의심을 함께 붙이지 않는다(판정을 못 한 것이지 실패가 아니다)."""
    preview = _preview(
        db,
        [_question(content="원본에 없는 지문이지만 대조 자체가 불가능한 상황")],
        source_filename=None,
        source_bytes=None,
    )
    assert preview.items[0].warnings == ["match_unavailable"]


# ---------------------------------------------------------------------------
# ⑤ 객관식 answer 번호 정합 (§8.2 v1.1)
# ---------------------------------------------------------------------------
def test_choice_number_answer_is_kept(db):
    preview = _preview(db, [_question(answer="4")])
    assert preview.items[0].status == "ok"
    state = import_service._PREVIEW_CACHE[preview.preview_id]
    assert state["items"][0]["doc"]["answer"] == "4"


def test_text_answer_is_error_in_pipeline(db):
    preview = _preview(db, [_question(answer="이행적 함수 종속을 제거한 상태이다")])
    assert preview.items[0].status == "error"
    assert any("보기 번호" in e for e in preview.items[0].errors)


def test_text_answer_is_normalized_for_direct_upload(db):
    """직접 업로드는 choices와 **전체 일치**할 때만 번호로 정규화해 수용한다."""
    preview = _preview(
        db,
        [_question(answer="모든 결정자가 후보키인 상태이다")],
        gate=False,
        strict=False,
    )
    assert preview.items[0].status == "ok"
    state = import_service._PREVIEW_CACHE[preview.preview_id]
    assert state["items"][0]["doc"]["answer"] == "4"


def test_partial_text_answer_is_error_for_direct_upload(db):
    """부분 일치는 조용한 추측 매칭 금지 — 오류로 잡는다."""
    preview = _preview(db, [_question(answer="후보키")], gate=False, strict=False)
    assert preview.items[0].status == "error"


def test_out_of_range_number_answer_falls_through_to_text_match(db):
    """§8.2 v1.1: **범위 밖 숫자는 번호가 아니다** — 수치형 보기의 값일 수 있으므로 텍스트
    경로로 내려가 보기와 전체 일치하면 번호로 정규화한다(PoC I2의 바로 그 사례)."""
    numeric = _question(
        content="다음 중 관리한계선 계산에 쓰이는 계수 값으로 옳은 것은?",
        choices=["10", "20", "30"],
        answer="20",
    )
    preview = _preview(db, [numeric], gate=False, strict=False)
    assert preview.items[0].status == "ok"
    state = import_service._PREVIEW_CACHE[preview.preview_id]
    assert state["items"][0]["doc"]["answer"] == "2"


def test_out_of_range_number_without_text_match_is_error(db):
    """보기 텍스트와도 일치하지 않으면 기존대로 오류(범위 안내 문구 유지)."""
    preview = _preview(db, [_question(answer="5")], gate=False, strict=False)
    assert preview.items[0].status == "error"
    assert any("범위" in e for e in preview.items[0].errors)


def test_out_of_range_number_is_error_in_pipeline(db):
    """변환 파이프라인은 보기 번호만 허용 — 범위 밖은 텍스트 일치 여부와 무관하게 오류."""
    numeric = _question(
        content="다음 중 관리한계선 계산에 쓰이는 계수 값으로 옳은 것은?",
        choices=["10", "20", "30"],
        answer="20",
    )
    preview = _preview(db, [numeric])
    assert preview.items[0].status == "error"
    assert any("범위" in e for e in preview.items[0].errors)


def test_numeric_choices_are_always_read_as_index(db):
    """수치형 보기의 번호/텍스트 이중 해석 제거(PoC I2) — "2"는 항상 2번 보기다."""
    numeric = _question(
        content="다음 중 표본크기가 12일 때의 자유도로 옳은 것은?",
        choices=["10", "11", "12", "13"],
        answer="2",
    )
    preview = _preview(db, [numeric], gate=False, strict=False)
    state = import_service._PREVIEW_CACHE[preview.preview_id]
    assert state["items"][0]["doc"]["answer"] == "2"  # "11"로 바뀌지 않는다


def test_ambiguous_duplicate_choice_answer_is_error(db):
    dup = _question(choices=["같은 보기", "같은 보기", "다른 보기"], answer="같은 보기")
    preview = _preview(db, [dup], gate=False, strict=False)
    assert preview.items[0].status == "error"


# ---------------------------------------------------------------------------
# content 필수 (§8.2 v1.1 — PoC E4)
# ---------------------------------------------------------------------------
def test_missing_content_is_error_in_pipeline(db):
    item = _question()
    del item["content"]
    preview = _preview(db, [item])
    assert preview.items[0].status == "error"
    assert any("content" in e for e in preview.items[0].errors)


def test_missing_content_is_tolerated_for_direct_upload(db):
    item = _question()
    del item["content"]
    preview = _preview(db, [item], gate=False, strict=False)
    assert preview.items[0].status == "ok"


# ---------------------------------------------------------------------------
# ⑥ 순수 JSON 위반 = invalid_output (관대한 벗겨내기 없음)
# ---------------------------------------------------------------------------
def test_code_fenced_output_is_invalid_output():
    with pytest.raises(convert_service.InvalidLlmOutputError) as excinfo:
        convert_service._parse_json_payload('```json\n{"format_version": 1}\n```')
    exc = excinfo.value
    assert exc.impure is True
    info = convert_service._fallback_error_info(exc)
    assert info["kind"] == "invalid_output"
    assert "순수 JSON" in info["message"]


def test_prose_wrapped_output_is_invalid_output():
    text = '변환 결과입니다:\n{"format_version": 1}\n필요하면 알려주세요.'
    with pytest.raises(convert_service.InvalidLlmOutputError):
        convert_service._parse_json_payload(text)


def test_pure_json_still_parses():
    assert convert_service._parse_json_payload('  {"format_version": 1}  ') == {
        "format_version": 1
    }


# ---------------------------------------------------------------------------
# ⑦ 직접 업로드 JSON에는 대조 배지가 없다
# ---------------------------------------------------------------------------
def test_direct_upload_has_no_match_badges(db):
    """원본이 서버에 없으므로 비적용 — `match_unavailable`조차 붙이지 않는다(설계 §4.17 ⑥)."""
    preview = _preview(
        db,
        [_question(content="원본에 없는 지문")],
        gate=False,
        strict=False,
        source_filename=None,
        source_bytes=None,
    )
    assert preview.items[0].warnings == []
    assert preview.summary.warning == 0


# ---------------------------------------------------------------------------
# ⑧ 보존 → 복구 경로에서도 warnings 유지 (F40-① 정합)
# ---------------------------------------------------------------------------
def test_warnings_survive_disk_recovery(db):
    first = _preview(
        db,
        [_question(answer_source="solved"), _question(content="원본에 없는 창작 지문입니다 정말로")],
        preserve=True,
    )
    assert first.items[0].warnings == ["solved_answer"]
    assert "fabrication_suspect" in first.items[1].warnings

    import_service._PREVIEW_CACHE.clear()  # 서버 재시작·TTL 만료

    again = import_service.get_preview(db, first.preview_id)
    assert again.recovered is True
    assert again.items[0].warnings == first.items[0].warnings
    assert again.items[1].warnings == first.items[1].warnings
    assert again.summary.warning == first.summary.warning


def test_fabrication_survives_recovery_without_source_file(db):
    """**DoD 3 구멍 회귀**: 원본 파일이 없는 경로(사이트 반입 FetchedExam — 구조화 텍스트만
    있고 `source_bytes`가 없다)에서 복구하면 `fabrication_suspect`가 `match_unavailable`로
    강등돼 기본 반입에 **포함**되던 결함. 복구는 재판정이 아니라 최초 판정의 복원이다."""
    first = import_service.create_preview(
        db,
        json_bytes=_envelope(
            [_question(), _question(content="원본 어디에도 없는 창작 지문을 지어냈다고 하자")]
        ),
        source_filename=None,
        source_bytes=None,  # 원본 파일 없음 — 대조 소재는 구조화 텍스트뿐
        source_text=SOURCE_TEXT,
        gate=True,
        strict=True,
        preserve=True,
    )
    assert first.items[0].warnings == []
    assert first.items[1].warnings == ["fabrication_suspect"]

    import_service._PREVIEW_CACHE.clear()
    again = import_service.get_preview(db, first.preview_id)

    assert again.recovered is True
    assert again.items[0].warnings == []
    assert again.items[1].warnings == ["fabrication_suspect"]  # 강등되지 않는다
    assert "match_unavailable" not in again.items[1].warnings
    assert again.summary.warning == 1


def test_saved_warnings_sidecar_is_written_and_ignored_on_reimport(db):
    """보존 파일의 `preview_warnings`는 §8.2 규격 밖 사이드카 — 사람이 그대로 재반입해도
    무시된다(전방 호환)."""
    preview = import_service.create_preview(
        db,
        json_bytes=_envelope([_question(content="원본에 없는 창작 지문을 지어냈다고 하자 정말로")]),
        source_filename=None,
        source_bytes=None,
        source_text=SOURCE_TEXT,
        gate=True,
        strict=True,
        preserve=True,
    )
    path = preview_store.find(preview.preview_id)
    assert path is not None
    raw = json.loads(path.read_text(encoding="utf-8"))
    assert raw[preview_store.WARNINGS_KEY] == {"0": ["fabrication_suspect"]}
    assert raw["format_version"] == 1 and len(raw["documents"]) == 1  # 본문은 그대로

    # 같은 파일을 직접 업로드로 재반입 — 사이드카는 판정에 쓰이지 않고 오류도 나지 않는다
    # (직접 업로드는 원본이 서버에 없어 대조 비적용 — 설계 §4.17 ⑥).
    reimported = import_service.create_preview(
        db,
        json_bytes=path.read_bytes(),
        source_filename=None,
        source_bytes=None,
    )
    assert reimported.items[0].status in ("ok", "duplicate_suspect")
    assert reimported.items[0].warnings == []


def test_item_that_was_error_at_first_gets_judged_on_recovery(db):
    """**사이드카 도입이 만든 구멍 회귀**: 최초 preview에서 strict 오류였던 항목은 판정되지
    않았으므로 사이드카에 키가 없다. 복구는 `strict=False`라 그 항목이 유효 항목으로
    살아나는데, "키 없음 = 경고 없음"으로 확정하면 배지 0으로 조용히 기본 반입에 포함된다.
    키가 없으면 **그때 판정**해야 한다(원본이 없으면 최소 `match_unavailable`)."""
    bad = _question(content="원본 어디에도 없는 창작 지문을 지어냈다고 하자 정말로")
    del bad["answer_source"]  # strict 위반 → 최초에는 error(판정되지 않음)

    first = import_service.create_preview(
        db,
        json_bytes=_envelope([_question(answer_source="solved"), bad]),
        source_filename=None,
        source_bytes=None,
        source_text=SOURCE_TEXT,
        gate=True,
        strict=True,
        preserve=True,
    )
    assert first.items[0].warnings == ["solved_answer"]
    assert first.items[1].status == "error"

    raw = json.loads(preview_store.find(first.preview_id).read_text(encoding="utf-8"))
    assert raw[preview_store.WARNINGS_KEY] == {"0": ["solved_answer"]}  # error 항목은 키 없음

    import_service._PREVIEW_CACHE.clear()
    again = import_service.get_preview(db, first.preview_id)

    assert again.items[0].warnings == ["solved_answer"]  # 판정된 항목은 보존값 그대로
    assert again.items[1].status == "ok"  # 복구는 관대 검증이라 살아난다
    assert again.items[1].warnings  # 배지 0으로 조용히 통과하지 않는다
    assert "match_unavailable" in again.items[1].warnings  # 원본이 없으므로 대조 불가
    assert again.summary.warning == 2


def test_zero_warning_items_are_recorded_as_empty_list(db):
    """경고 없는 항목도 `[]`로 명시 기록된다 — "키 없음 = 판정 안 됨"이 성립해야 한다."""
    preview = import_service.create_preview(
        db,
        json_bytes=_envelope([_question()]),
        source_filename=None,
        source_bytes=None,
        source_text=SOURCE_TEXT,
        gate=True,
        strict=True,
        preserve=True,
    )
    assert preview.items[0].warnings == []
    raw = json.loads(preview_store.find(preview.preview_id).read_text(encoding="utf-8"))
    assert raw[preview_store.WARNINGS_KEY] == {"0": []}

    import_service._PREVIEW_CACHE.clear()
    again = import_service.get_preview(db, preview.preview_id)
    # 보존값(빈 배열)이 정본 — 원본이 없다고 match_unavailable로 뒤집히지 않는다
    assert again.items[0].warnings == []


def test_legacy_preserved_file_without_sidecar_recomputes(db):
    """구버전 보존본(S15 이전 — 사이드카 없음)은 기존 재계산 동작을 그대로 유지한다."""
    payload = _envelope([_question()])
    path = preview_store.AUTO_DIR / "imp_legacy1__nosrc__old.json"
    path.write_bytes(payload)

    recovered = import_service.recover_preview(db, "imp_legacy1")
    assert recovered is not None
    # 원본이 없으므로 재계산 결과는 "대조 불가"(조용한 통과 금지) — 기존 동작 유지
    assert recovered.items[0].warnings == ["match_unavailable"]
