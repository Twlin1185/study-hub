"""사이트 어댑터·목표 판정 순수 로직 단위 테스트 (S10·S13, 설계 §4.13).

DB·네트워크 없이 검증 가능한 순수 함수만 고정한다 — SSRF 리다이렉트 차단·URL ASCII
정규화·estimate 산식·단일 어댑터 목록 구성(also_on 빈 배열·refs 단일 항목)·수치 튜플
정렬·키→폴더명 파생·목표 달성(AND) 판정.
(수집·LLM 경로는 스모크로 별도 확인.)

S13 — 사설 사이트 어댑터들은 계획서 §14 F35-2 "제거 이력"에 따라 코드와 함께
삭제됐다. 그 사이트 전용 파싱·다중 어댑터 병합 테스트도 함께 제거하고, 단일
어댑터(qnet) 목록 구성 테스트로 대체했다.
"""
from __future__ import annotations

import pytest

from services import fetch_service
from services.fetchers import registry
from services.fetchers.base import ExamEntry, ParseFailedError
from services.stats_service import _evaluate_goal


# --- estimate 산식 ----------------------------------------------------------
def test_estimate_assumed_when_count_unknown():
    est = fetch_service.estimate_usage(None)
    assert est["questions_assumed"] == 60
    assert est["assumed"] is True
    assert est["approx_input_tokens"] == 60 * fetch_service.DEFAULT_TOKENS_PER_QUESTION


def test_estimate_uses_known_count():
    est = fetch_service.estimate_usage(40)
    assert est["questions_assumed"] == 40
    # 표본이 없으면 문항당 토큰이 가정치이므로 assumed=True 유지
    assert est["assumed"] is True
    assert est["approx_input_tokens"] == 40 * fetch_service.DEFAULT_TOKENS_PER_QUESTION


# --- 단일 어댑터 목록 구성(S13 — 병합·priority 채택 없음, 큐넷 우선 병합 테스트 대체) ---
def _entry(key, ref="r", cert_name="정보처리기사", exam_date=None):
    return ExamEntry(exam_key=key, label=f"{cert_name} {key}", exam_ref=ref, cert_name=cert_name, exam_date=exam_date)


def test_list_exams_single_adapter_also_on_empty_refs_single(monkeypatch):
    """등록 어댑터가 하나뿐이므로 also_on은 항상 빈 배열, refs는 단일 항목이다."""

    class _FakeQnet:
        id, priority = "qnet", 1

        def is_available(self, client):
            return True, None

        def list_exams(self, cert_ref, client):
            return [_entry("2022-2", ref="qref1"), _entry("2021-1", ref="qref2")]

    fakes = [_FakeQnet()]
    monkeypatch.setattr(registry, "get_adapters", lambda: fakes)
    monkeypatch.setattr(registry, "get_adapter", lambda aid: next((a for a in fakes if a.id == aid), None))
    monkeypatch.setattr(registry, "cache_get", lambda k: None)
    monkeypatch.setattr(registry, "cache_set", lambda k, v: None)
    monkeypatch.setattr(fetch_service, "_is_imported", lambda *a, **k: False)

    sources = [{"adapter": "qnet", "cert_ref": "x"}]
    out = fetch_service.list_exams(db=None, sources=sources)
    by_key = {e["exam_key"]: e for e in out}

    assert by_key["2022-2"]["adapter"] == "qnet"
    assert by_key["2022-2"]["also_on"] == []
    assert by_key["2022-2"]["refs"] == {"qnet": "qref1"}
    assert by_key["2022-2"]["exam_ref"] == by_key["2022-2"]["refs"]["qnet"]

    assert by_key["2021-1"]["also_on"] == []
    assert by_key["2021-1"]["refs"] == {"qnet": "qref2"}

    # 정렬 순서 — 최신 회차(2022-2)가 먼저
    assert [o["exam_key"] for o in out] == ["2022-2", "2021-1"]


def test_list_exams_unregistered_adapter_ignored(monkeypatch):
    """소스에 등록되지 않은 어댑터 id가 섞여 있어도 조용히 건너뛴다."""
    monkeypatch.setattr(registry, "get_adapters", lambda: [])
    monkeypatch.setattr(registry, "get_adapter", lambda aid: None)

    out = fetch_service.list_exams(db=None, sources=[{"adapter": "ghost", "cert_ref": "x"}])
    assert out == []


# --- 리다이렉트 SSRF 재검증(사설/메타데이터 IP로의 리다이렉트 차단) ----------
def test_open_validated_blocks_redirect_to_private_ip(monkeypatch):
    """공개 IP로 시작한 요청이 링크로컬 메타데이터 IP로 리다이렉트되면 hop 재검증에 걸린다."""
    calls = {"n": 0}

    def _fake_hop(url, host, headers):
        calls["n"] += 1
        # 첫 hop(공개 IP)은 클라우드 메타데이터 링크로컬 IP로 리다이렉트시킨다
        return ("redirect", "http://169.254.169.254/latest/meta-data/")

    monkeypatch.setattr(registry, "_single_hop_request", _fake_hop)

    with pytest.raises(ParseFailedError) as excinfo:
        # 8.8.8.8(공개 IP 리터럴)로 시작 → DNS 없이 공개 판정 통과 → 리다이렉트가 문제
        registry._open_validated(
            "http://8.8.8.8/file", headers={}, enforce_robots=False
        )

    assert "SSRF" in str(excinfo.value)
    assert calls["n"] == 1  # 두 번째 hop은 요청 전에 SSRF 검증에서 차단(재요청 안 됨)


def test_open_validated_caps_redirect_hops(monkeypatch):
    """공개 IP 사이 무한 리다이렉트는 hop 상한(5)에서 끊는다."""
    def _always_redirect(url, host, headers):
        return ("redirect", "http://8.8.4.4/next")

    monkeypatch.setattr(registry, "_single_hop_request", _always_redirect)
    with pytest.raises(ParseFailedError) as excinfo:
        registry._open_validated("http://8.8.8.8/start", headers={}, enforce_robots=False)
    assert "리다이렉트" in str(excinfo.value)


# --- 목표 달성 AND 판정 -----------------------------------------------------
def test_goal_met_and_semantics():
    assert _evaluate_goal(20, 30, 20, 30) is True         # 둘 다 충족
    assert _evaluate_goal(20, 10, 20, 30) is False        # 분 미달
    assert _evaluate_goal(5, 30, 20, None) is False       # 문항 미달(분 목표 없음)
    assert _evaluate_goal(20, 0, 20, None) is True        # 문항만 목표 → 충족
    assert _evaluate_goal(100, 100, None, None) is False  # 목표 미설정 → 달성 대상 없음


# --- URL ASCII 정규화(범용 유틸 — 게시판형 사이트의 한글 첨부 URL·mojibake Location) ---
def test_ascii_safe_url_passthrough_ascii():
    url = "https://www.example.com/dl/?module=file&act=procFileDownload&file_srl=1&sid=ab"
    assert registry._ascii_safe_url(url) == url


def test_ascii_safe_url_encodes_unicode_iri():
    # HTML href에서 추출한 진짜 유니코드 str — UTF-8 percent-encoding
    url = "https://img.example.com/download/1/품질.pdf"
    out = registry._ascii_safe_url(url)
    assert out.isascii()
    assert out == "https://img.example.com/download/1/%ED%92%88%EC%A7%88.pdf"


def test_ascii_safe_url_recovers_latin1_mojibake_location():
    # 302 Location 헤더: http.client가 UTF-8 바이트를 latin-1로 디코드한 str.
    # 원 바이트를 복원해 quote해야 서버가 아는 경로가 된다(재인코딩 금지).
    original = "https://img.example.com/download/1/품질.pdf"
    mojibake = original.encode("utf-8").decode("latin-1")
    assert registry._ascii_safe_url(mojibake) == registry._ascii_safe_url(original)


def test_ascii_safe_url_preserves_existing_percent_escapes():
    url = "https://img.example.com/a/%ED%92%88 질.pdf"
    out = registry._ascii_safe_url(url)
    assert "%25" not in out  # 기존 %XX 이중 인코딩 금지
    assert out == "https://img.example.com/a/%ED%92%88%20%EC%A7%88.pdf"


# --- 키→폴더명 단일 파생 함수(설계 §4.13 — imported 판정·convert 분류 경로 공유) ----
def test_exam_folder_name_round_key():
    assert fetch_service.exam_folder_name("2022-2") == "2022년 2회"


def test_exam_folder_name_date_key_strips_leading_zero():
    assert fetch_service.exam_folder_name("2022-04-24") == "2022년 4월 24일"
    assert fetch_service.exam_folder_name("2022-04-04") == "2022년 4월 4일"


def test_exam_folder_name_unparseable_returns_none():
    assert fetch_service.exam_folder_name("unknown") is None
    assert fetch_service.exam_folder_name("") is None


# --- 정렬이 문자열이 아닌 수치 (연도, 월, 일/회차)여야 함 --------------------
def test_list_exams_sorts_numerically_not_lexically(monkeypatch):
    """같은 해 '2016-2'(회차만, 날짜 없음)와 '2016-10-01'(날짜형)을 문자열로 비교하면
    '2016-2' > '2016-10-01'이라 순서가 뒤바뀐다 — 수치 튜플 비교로 10월이 위로 온다."""

    class _FakeQnet:
        id, priority = "qnet", 1

        def is_available(self, client):
            return True, None

        def list_exams(self, cert_ref, client):
            return [
                _entry("2016-2", ref="r1"),
                _entry("2016-10-01", ref="r2", exam_date="2016-10-01"),
            ]

    fakes = [_FakeQnet()]
    monkeypatch.setattr(registry, "get_adapters", lambda: fakes)
    monkeypatch.setattr(registry, "get_adapter", lambda aid: next((a for a in fakes if a.id == aid), None))
    monkeypatch.setattr(registry, "cache_get", lambda k: None)
    monkeypatch.setattr(registry, "cache_set", lambda k, v: None)
    monkeypatch.setattr(fetch_service, "_is_imported", lambda *a, **k: False)

    out = fetch_service.list_exams(db=None, sources=[{"adapter": "qnet", "cert_ref": "x"}])
    assert [o["exam_key"] for o in out] == ["2016-10-01", "2016-2"]  # 10월이 먼저(최신)
