"""사이트 어댑터·목표 판정 순수 로직 단위 테스트 (S10, 설계 §4.13).

DB·네트워크 없이 검증 가능한 순수 함수만 고정한다 — 회차 키 정규화·estimate 산식·
큐넷 우선 병합·목표 달성(AND) 판정. (수집·LLM 경로는 스모크로 별도 확인.)
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
