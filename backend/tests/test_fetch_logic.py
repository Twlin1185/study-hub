"""사이트 어댑터·목표 판정 순수 로직 단위 테스트 (S10·S12, 설계 §4.13).

DB·네트워크 없이 검증 가능한 순수 함수만 고정한다 — 회차 키 정규화·estimate 산식·
우선순위 병합(qnet>cbtbank>comcbt)·날짜 자연 키 병합·키→폴더명 파생·목표 달성(AND) 판정.
(수집·LLM 경로는 스모크로 별도 확인.)
"""
from __future__ import annotations

import pytest

from services import fetch_service
from services.fetchers import comcbt, registry
from services.fetchers.base import ExamEntry, ParseFailedError
from services.stats_service import _evaluate_goal


# --- 회차 키 정규화(YYYY-N) -------------------------------------------------
def test_parse_exam_key_basic():
    assert comcbt._parse_exam_key("정보처리기사 필기 2022년 04월 24일(2회)(해설집 포함)") == "2022-2"


def test_parse_exam_key_merged_round_takes_first():
    # "1, 2회 통합" → 첫 회차 번호 채택
    assert comcbt._parse_exam_key("정보처리기사 필기 2020년 06월 06일(1, 2회 통합)") == "2020-1"


def test_parse_exam_key_none_for_notice_without_paren_round():
    # 괄호 밖 "1회"는 공지 제목 오탐이므로 회차로 인정하지 않는다(None → 목록에서 제외)
    assert comcbt._parse_exam_key("2020년 1회 이후 시험과목 변경 안내") is None
    assert comcbt._parse_exam_key("공지사항입니다") is None


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


# --- 큐넷 우선 병합(같은 exam_key 양쪽 존재 → qnet 채택, comcbt는 also_on) ----
def _entry(adapter_cert, key):
    return ExamEntry(exam_key=key, label=f"{adapter_cert} {key}", exam_ref="r", cert_name="정보처리기사")


def test_merge_prefers_qnet(monkeypatch):
    from services.fetchers import registry

    class _FakeQnet:
        id, priority = "qnet", 1

        def is_available(self, client):
            return True, None

        def list_exams(self, cert_ref, client):
            return [_entry("qnet", "2022-2")]

    class _FakeComcbt:
        id, priority = "comcbt", 2

        def is_available(self, client):
            return True, None

        def list_exams(self, cert_ref, client):
            return [_entry("comcbt", "2022-2"), _entry("comcbt", "2021-1")]

    fakes = [_FakeQnet(), _FakeComcbt()]
    monkeypatch.setattr(registry, "get_adapters", lambda: fakes)
    monkeypatch.setattr(registry, "get_adapter", lambda aid: next((a for a in fakes if a.id == aid), None))
    monkeypatch.setattr(registry, "cache_get", lambda k: None)
    monkeypatch.setattr(registry, "cache_set", lambda k, v: None)
    monkeypatch.setattr(fetch_service, "_is_imported", lambda *a, **k: False)

    sources = [{"adapter": "qnet", "cert_ref": "x"}, {"adapter": "comcbt", "cert_ref": "iz"}]
    out = fetch_service.list_exams(db=None, sources=sources)
    by_key = {e["exam_key"]: e for e in out}
    assert by_key["2022-2"]["adapter"] == "qnet"          # 큐넷 채택
    assert by_key["2022-2"]["also_on"] == ["comcbt"]      # comcbt는 also_on
    # refs: 양쪽 어댑터의 exam_ref를 모두 담고, 최상위 exam_ref == refs[adapter](하위 호환)
    assert set(by_key["2022-2"]["refs"].keys()) == {"qnet", "comcbt"}
    assert by_key["2022-2"]["exam_ref"] == by_key["2022-2"]["refs"]["qnet"]
    assert by_key["2021-1"]["adapter"] == "comcbt"        # 한쪽만 있으면 그대로
    assert by_key["2021-1"]["also_on"] == []
    assert set(by_key["2021-1"]["refs"].keys()) == {"comcbt"}


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


# --- URL ASCII 정규화 (S10 사후 수정: comcbt 한글 첨부 URL·mojibake Location) ---
def test_ascii_safe_url_passthrough_ascii():
    url = "https://www.comcbt.com/xe/?module=file&act=procFileDownload&file_srl=1&sid=ab"
    assert registry._ascii_safe_url(url) == url


def test_ascii_safe_url_encodes_unicode_iri():
    # HTML href에서 추출한 진짜 유니코드 str — UTF-8 percent-encoding
    url = "https://img.comcbt.com/xe/download/1/품질.pdf"
    out = registry._ascii_safe_url(url)
    assert out.isascii()
    assert out == "https://img.comcbt.com/xe/download/1/%ED%92%88%EC%A7%88.pdf"


def test_ascii_safe_url_recovers_latin1_mojibake_location():
    # 302 Location 헤더: http.client가 UTF-8 바이트를 latin-1로 디코드한 str.
    # 원 바이트를 복원해 quote해야 서버가 아는 경로가 된다(재인코딩 금지).
    original = "https://img.comcbt.com/xe/download/1/품질.pdf"
    mojibake = original.encode("utf-8").decode("latin-1")
    assert registry._ascii_safe_url(mojibake) == registry._ascii_safe_url(original)


def test_ascii_safe_url_preserves_existing_percent_escapes():
    url = "https://img.comcbt.com/a/%ED%92%88 질.pdf"
    out = registry._ascii_safe_url(url)
    assert "%25" not in out  # 기존 %XX 이중 인코딩 금지
    assert out == "https://img.comcbt.com/a/%ED%92%88%20%EC%A7%88.pdf"


# --- comcbt exam_date 추출 (S12 — 회차 번호 제공자 역할) --------------------
def test_comcbt_parses_exam_date_from_title():
    assert comcbt._parse_exam_date("정보처리기사 필기 2022년 04월 24일(2회)") == "2022-04-24"


def test_comcbt_exam_date_none_without_full_date():
    assert comcbt._parse_exam_date("공지사항입니다") is None


# --- 키→폴더명 단일 파생 함수(설계 §4.13 — imported 판정·convert 분류 경로 공유) ----
def test_exam_folder_name_round_key():
    assert fetch_service.exam_folder_name("2022-2") == "2022년 2회"


def test_exam_folder_name_date_key_strips_leading_zero():
    assert fetch_service.exam_folder_name("2022-04-24") == "2022년 4월 24일"
    assert fetch_service.exam_folder_name("2022-04-04") == "2022년 4월 4일"


def test_exam_folder_name_unparseable_returns_none():
    assert fetch_service.exam_folder_name("unknown") is None
    assert fetch_service.exam_folder_name("") is None


# --- S12 병합: 날짜 자연 키(comcbt 날짜+회차 ↔ cbtbank 날짜만) ---------------
def _entry_s12(key, cert_name="품질경영기사", exam_date=None, ref="r"):
    return ExamEntry(exam_key=key, label=f"{cert_name} {key}", exam_ref=ref, cert_name=cert_name, exam_date=exam_date)


def test_merge_by_exam_date_prefers_cbtbank_over_comcbt(monkeypatch):
    """comcbt(날짜+회차 보유) ↔ cbtbank(날짜만) — 같은 날짜로 병합, cbtbank 채택
    (priority qnet(1) > cbtbank(2) > comcbt(3)), 대표 키는 comcbt의 'YYYY-N'."""
    from services.fetchers import registry as _registry

    class _FakeCbtbank:
        id, priority = "cbtbank", 2

        def is_available(self, client):
            return True, None

        def list_exams(self, cert_ref, client):
            return [_entry_s12("2022-04-24", exam_date="2022-04-24", ref="bp20220424")]

    class _FakeComcbt:
        id, priority = "comcbt", 3

        def is_available(self, client):
            return True, None

        def list_exams(self, cert_ref, client):
            return [_entry_s12("2022-2", exam_date="2022-04-24", ref="5851061")]

    fakes = [_FakeCbtbank(), _FakeComcbt()]
    monkeypatch.setattr(_registry, "get_adapters", lambda: fakes)
    monkeypatch.setattr(_registry, "get_adapter", lambda aid: next((a for a in fakes if a.id == aid), None))
    monkeypatch.setattr(_registry, "cache_get", lambda k: None)
    monkeypatch.setattr(_registry, "cache_set", lambda k, v: None)
    monkeypatch.setattr(fetch_service, "_is_imported", lambda *a, **k: False)

    sources = [{"adapter": "cbtbank", "cert_ref": "품질경영기사"}, {"adapter": "comcbt", "cert_ref": "bp"}]
    out = fetch_service.list_exams(db=None, sources=sources)
    assert len(out) == 1
    item = out[0]
    assert item["adapter"] == "cbtbank"          # priority 최소 채택
    assert item["also_on"] == ["comcbt"]
    assert item["exam_key"] == "2022-2"           # 대표 키 = 회차 번호 보유 키(comcbt) 우선
    assert set(item["refs"].keys()) == {"cbtbank", "comcbt"}
    assert item["refs"]["cbtbank"] == "bp20220424"
    assert item["refs"]["comcbt"] == "5851061"


def test_merge_cbtbank_standalone_uses_date_key_and_folder(monkeypatch):
    """cbtbank 단독(회차 번호 미상) — 대표 키가 날짜형이고 폴더명이 'YYYY년 M월 D일'."""
    from services.fetchers import registry as _registry

    class _FakeCbtbank:
        id, priority = "cbtbank", 2

        def is_available(self, client):
            return True, None

        def list_exams(self, cert_ref, client):
            return [_entry_s12("2022-04-24", exam_date="2022-04-24", ref="bp20220424")]

    fakes = [_FakeCbtbank()]
    monkeypatch.setattr(_registry, "get_adapters", lambda: fakes)
    monkeypatch.setattr(_registry, "get_adapter", lambda aid: next((a for a in fakes if a.id == aid), None))
    monkeypatch.setattr(_registry, "cache_get", lambda k: None)
    monkeypatch.setattr(_registry, "cache_set", lambda k, v: None)
    monkeypatch.setattr(fetch_service, "_is_imported", lambda *a, **k: False)

    out = fetch_service.list_exams(db=None, sources=[{"adapter": "cbtbank", "cert_ref": "품질경영기사"}])
    assert len(out) == 1
    assert out[0]["exam_key"] == "2022-04-24"
    assert out[0]["also_on"] == []
    assert fetch_service.exam_folder_name(out[0]["exam_key"]) == "2022년 4월 24일"


def test_merge_qnet_without_exam_date_uses_legacy_key_regression(monkeypatch):
    """exam_date 없는 qnet 항목은 기존 'YYYY-N' 키 병합 그대로(하위 호환 회귀 없음)."""
    from services.fetchers import registry as _registry

    class _FakeQnet:
        id, priority = "qnet", 1

        def is_available(self, client):
            return True, None

        def list_exams(self, cert_ref, client):
            return [_entry_s12("2022-2", exam_date=None, ref="qref")]

    fakes = [_FakeQnet()]
    monkeypatch.setattr(_registry, "get_adapters", lambda: fakes)
    monkeypatch.setattr(_registry, "get_adapter", lambda aid: next((a for a in fakes if a.id == aid), None))
    monkeypatch.setattr(_registry, "cache_get", lambda k: None)
    monkeypatch.setattr(_registry, "cache_set", lambda k, v: None)
    monkeypatch.setattr(fetch_service, "_is_imported", lambda *a, **k: False)

    out = fetch_service.list_exams(db=None, sources=[{"adapter": "qnet", "cert_ref": "x"}])
    assert len(out) == 1
    assert out[0]["exam_key"] == "2022-2"
    assert out[0]["adapter"] == "qnet"


def test_merge_three_way_priority_qnet_cbtbank_comcbt(monkeypatch):
    """세 어댑터 모두 같은 날짜에 있으면 qnet 채택, also_on에 나머지 둘(정렬됨)."""
    from services.fetchers import registry as _registry

    class _FakeQnet:
        id, priority = "qnet", 1

        def is_available(self, client):
            return True, None

        def list_exams(self, cert_ref, client):
            return [_entry_s12("2022-2", exam_date="2022-04-24", ref="qref")]

    class _FakeCbtbank:
        id, priority = "cbtbank", 2

        def is_available(self, client):
            return True, None

        def list_exams(self, cert_ref, client):
            return [_entry_s12("2022-04-24", exam_date="2022-04-24", ref="bp20220424")]

    class _FakeComcbt:
        id, priority = "comcbt", 3

        def is_available(self, client):
            return True, None

        def list_exams(self, cert_ref, client):
            return [_entry_s12("2022-2", exam_date="2022-04-24", ref="5851061")]

    fakes = [_FakeQnet(), _FakeCbtbank(), _FakeComcbt()]
    monkeypatch.setattr(_registry, "get_adapters", lambda: fakes)
    monkeypatch.setattr(_registry, "get_adapter", lambda aid: next((a for a in fakes if a.id == aid), None))
    monkeypatch.setattr(_registry, "cache_get", lambda k: None)
    monkeypatch.setattr(_registry, "cache_set", lambda k, v: None)
    monkeypatch.setattr(fetch_service, "_is_imported", lambda *a, **k: False)

    sources = [
        {"adapter": "qnet", "cert_ref": "x"},
        {"adapter": "cbtbank", "cert_ref": "품질경영기사"},
        {"adapter": "comcbt", "cert_ref": "bp"},
    ]
    out = fetch_service.list_exams(db=None, sources=sources)
    assert len(out) == 1
    item = out[0]
    assert item["adapter"] == "qnet"
    assert item["also_on"] == ["cbtbank", "comcbt"]
    assert item["exam_key"] == "2022-2"


# --- 검토 후속 경검 1: 정렬이 문자열이 아닌 수치 (연도, 월, 일/회차)여야 함 ---------
def test_list_exams_sorts_numerically_not_lexically(monkeypatch):
    """같은 해 '2016-2'(회차만, 날짜 없음)와 '2016-10-01'(날짜형)을 문자열로 비교하면
    '2016-2' > '2016-10-01'이라 순서가 뒤바뀐다 — 수치 튜플 비교로 10월이 위로 온다."""
    from services.fetchers import registry as _registry

    class _FakeRoundOnly:
        id, priority = "qnet", 1

        def is_available(self, client):
            return True, None

        def list_exams(self, cert_ref, client):
            return [_entry_s12("2016-2", exam_date=None, ref="r1")]

    class _FakeDateOnly:
        id, priority = "cbtbank", 2

        def is_available(self, client):
            return True, None

        def list_exams(self, cert_ref, client):
            return [_entry_s12("2016-10-01", exam_date="2016-10-01", ref="r2")]

    fakes = [_FakeRoundOnly(), _FakeDateOnly()]
    monkeypatch.setattr(_registry, "get_adapters", lambda: fakes)
    monkeypatch.setattr(_registry, "get_adapter", lambda aid: next((a for a in fakes if a.id == aid), None))
    monkeypatch.setattr(_registry, "cache_get", lambda k: None)
    monkeypatch.setattr(_registry, "cache_set", lambda k, v: None)
    monkeypatch.setattr(fetch_service, "_is_imported", lambda *a, **k: False)

    sources = [{"adapter": "qnet", "cert_ref": "x"}, {"adapter": "cbtbank", "cert_ref": "y"}]
    out = fetch_service.list_exams(db=None, sources=sources)
    assert [o["exam_key"] for o in out] == ["2016-10-01", "2016-2"]  # 10월이 먼저(최신)


# --- 검토 후속 경검 4: 대표 키가 삽입 순서가 아닌 priority로 결정 --------------------
def test_representative_key_deterministic_by_priority_not_source_order(monkeypatch):
    """회차 번호 보유 어댑터가 둘 이상이면 priority 최소 어댑터의 키를 쓴다 —
    `sources` 요청 순서를 뒤집어도 대표 키가 바뀌지 않아야 한다."""
    from services.fetchers import registry as _registry

    class _FakeCbtbank:  # date-only, 전역 채택(priority 최소)
        id, priority = "cbtbank", 2

        def is_available(self, client):
            return True, None

        def list_exams(self, cert_ref, client):
            return [_entry_s12("2022-04-24", exam_date="2022-04-24", ref="bp1")]

    class _FakeAdapterX:  # round key 보유, priority 5
        id, priority = "adapterX", 5

        def is_available(self, client):
            return True, None

        def list_exams(self, cert_ref, client):
            return [_entry_s12("2022-9", exam_date="2022-04-24", ref="x1")]

    class _FakeAdapterY:  # round key 보유, priority 9(더 낮은 우선순위)
        id, priority = "adapterY", 9

        def is_available(self, client):
            return True, None

        def list_exams(self, cert_ref, client):
            return [_entry_s12("2022-2", exam_date="2022-04-24", ref="y1")]

    fakes = [_FakeCbtbank(), _FakeAdapterX(), _FakeAdapterY()]
    monkeypatch.setattr(_registry, "get_adapters", lambda: fakes)
    monkeypatch.setattr(_registry, "get_adapter", lambda aid: next((a for a in fakes if a.id == aid), None))
    monkeypatch.setattr(_registry, "cache_get", lambda k: None)
    monkeypatch.setattr(_registry, "cache_set", lambda k, v: None)
    monkeypatch.setattr(fetch_service, "_is_imported", lambda *a, **k: False)

    forward = [
        {"adapter": "cbtbank", "cert_ref": "a"},
        {"adapter": "adapterX", "cert_ref": "b"},
        {"adapter": "adapterY", "cert_ref": "c"},
    ]
    reversed_sources = list(reversed(forward))

    out_forward = fetch_service.list_exams(db=None, sources=forward)
    out_reversed = fetch_service.list_exams(db=None, sources=reversed_sources)

    # priority 5(adapterX)가 priority 9(adapterY)보다 우선 — 대표 키는 항상 '2022-9'
    assert out_forward[0]["exam_key"] == "2022-9"
    assert out_reversed[0]["exam_key"] == "2022-9"
