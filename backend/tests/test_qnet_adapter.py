"""큐넷 오픈API 어댑터 단위 테스트 (S14, 지시서 2절 ①~⑤ · 설계 §4.13).

네트워크 없이 검증 가능한 지점만 고정한다 — **실측 확정 사항**(계획서 §14 F35-3)이
구현에서 유지되는지가 목적이다:

① `numOfRows`는 50을 넘는 요청을 만들지 않는다(초과 시 resultCode 930 — 구현 버그 신호).
② 메타 빈값 항목(실측 43건/14%)이 종목 목록을 오염시키지 않고, 제목 검색으로는 노출된다.
③ 실측 표본 제목 5종의 파싱·안내문 분류 결과 고정(회차를 지어내지 않는다).
④ 단일 어댑터 계약 — `also_on == []`, `refs == {'qnet': exam_ref}`, 최신순 정렬.
⑤ 서비스키 미등록이면 S13 스텁과 동일 동작(빈 목록 + available:false).
"""
from __future__ import annotations

import json
from typing import Any, Dict, List

import pytest

from services import fetch_service, qnet_api, secrets_store
from services.fetchers import registry
from services.fetchers.base import AdapterServiceError, ParseFailedError
from services.fetchers.qnet import QnetAdapter
from services.fetchers import qnet as qnet_adapter

# --- 실측 표본(계획서 §14 F35-3 "실측 확정 사항" 6) ---------------------------
SAMPLE_TITLES = [
    "[공개문제]봉제기능사(20260714)",
    "[공개문제]양식조리산업기사(2026년도)",
    "[문제공개]와전류비파괴검사기사",
    "[공개문제] 2025년 미용사(일반) 실기시험관련 안내",
    "미용사(일반)과제 조별 집행 안내",
]


def _raw(artl_seq: int, title: str, jm_cd: str = "", jm_nm: str = "") -> Dict[str, Any]:
    """오픈API 목록 항목 원형 — 메타 빈값 게시물은 전 필드가 빈 문자열로 온다(실측 3)."""
    return {
        "artlSeq": artl_seq,
        "title": title,
        "regDttm": "20260220074523",
        "modDttm": "20260714173905",
        "qualgbCd": "T" if jm_cd else "",
        "qualgbNm": "국가기술자격" if jm_cd else "",
        "seriesCd": "04" if jm_cd else "",
        "seriesNm": "기능사" if jm_cd else "",
        "jmCd": jm_cd,
        "jmNm": jm_nm,
    }


SAMPLE_ITEMS = [
    _raw(1001, SAMPLE_TITLES[0], "9776", "봉제기능사"),
    _raw(1002, SAMPLE_TITLES[1], "7920", "양식조리산업기사"),
    _raw(1003, SAMPLE_TITLES[2], "6210", "와전류비파괴검사기사"),
    _raw(1004, SAMPLE_TITLES[3], "7802", "미용사(일반)"),
    _raw(1005, SAMPLE_TITLES[4], "7802", "미용사(일반)"),
    _raw(1006, "[공개문제]보석디자인산업기사"),  # 메타 전 필드 빈 문자열(실측 3)
]


@pytest.fixture(autouse=True)
def _clear_cache():
    """목록 캐시(24h)는 프로세스 전역이라 테스트마다 비운다."""
    registry._CACHE.clear()
    yield
    registry._CACHE.clear()


@pytest.fixture
def registered_key(monkeypatch):
    """서비스키가 등록된 상태를 가정(원문 키를 테스트에 두지 않는다 — 더미 문자열)."""
    monkeypatch.setattr(qnet_api, "get_service_key", lambda: "dummy-service-key")
    return "dummy-service-key"


class FakeClient:
    """registry.FetchClient 대역 — 호출된 URL을 전부 기록한다."""

    def __init__(self, pages: List[List[Dict[str, Any]]], total: int) -> None:
        self.pages = pages
        self.total = total
        self.urls: List[str] = []

    def get_text(self, url: str) -> str:
        self.urls.append(url)
        page_no = int(url.split("pageNo=")[1].split("&")[0])
        items = self.pages[page_no - 1] if page_no - 1 < len(self.pages) else []
        return json.dumps(
            {
                "header": {"resultCode": "00", "resultMsg": "NORMAL SERVICE"},
                "body": {"items": items, "numOfRows": 50, "pageNo": page_no, "totalCount": self.total},
            },
            ensure_ascii=False,
        )


# --- ① numOfRows 50 상한 -----------------------------------------------------
def test_num_of_rows_constant_is_50():
    assert qnet_api.MAX_NUM_OF_ROWS == 50


def test_pagination_never_requests_more_than_50(monkeypatch, registered_key):
    """전 목록 순회는 페이지 크기 50 고정 — 51 이상은 resultCode 930이 난다(실측 1)."""
    pages = [[_raw(i, f"[공개문제]종목{i}", "1234", "종목") for i in range(50)] for _ in range(3)]
    pages.append([_raw(999, "[공개문제]마지막", "1234", "종목")])
    client = FakeClient(pages, total=151)

    items = qnet_api.fetch_all_list_items(client)

    assert len(items) == 151
    assert len(client.urls) == 4  # 50×3 + 1 → 4페이지
    for url in client.urls:
        num = int(url.split("numOfRows=")[1].split("&")[0])
        assert num <= qnet_api.MAX_NUM_OF_ROWS


def test_oversized_num_of_rows_is_forced_down(monkeypatch, registered_key):
    """상수를 우회한 호출이 있어도 내부에서 50으로 강제한다(930 원천 차단)."""
    client = FakeClient([[_raw(1, "[공개문제]종목", "1", "종목")]], total=1)
    qnet_api._request(client, qnet_api.LIST_OPERATION, {"numOfRows": 500, "pageNo": 1})
    assert "numOfRows=50" in client.urls[0]


def test_930_maps_to_bug_signal_not_user_guidance(monkeypatch, registered_key, caplog):
    """930은 사용자 안내가 아니라 구현 버그 신호 — 서버 경고 로그를 남긴다."""

    class _Client930:
        def get_text(self, url: str) -> str:
            return json.dumps({"header": {"resultCode": "930", "resultMsg": "..."}, "body": {}})

    with caplog.at_level("WARNING"):
        with pytest.raises(Exception) as excinfo:
            qnet_api.fetch_list_page(_Client930(), 1)
    assert "930" in caplog.text
    assert "930" not in str(excinfo.value)  # 사용자 메시지에 코드 원문을 흘리지 않는다


# --- 오류 코드 사람 말 매핑 + 서비스키 유출 0 --------------------------------
@pytest.mark.parametrize(
    "code, needle",
    [("22", "한도"), ("30", "올바르지"), ("31", "만료"), ("941", "만료")],
)
def test_error_codes_map_to_human_messages(registered_key, code, needle):
    class _Client:
        def get_text(self, url: str) -> str:
            return json.dumps({"header": {"resultCode": code, "resultMsg": "RAW"}, "body": {}})

    with pytest.raises(Exception) as excinfo:
        qnet_api.fetch_list_page(_Client(), 1)
    message = str(excinfo.value)
    assert needle in message
    assert "RAW" not in message  # 원문 응답 미노출


def test_http_401_maps_to_key_error_without_leaking_url(registered_key):
    """게이트웨이는 잘못된 키를 본문 코드가 아니라 **HTTP 401**로 돌려준다(실측).
    원 예외 detail에는 키가 포함된 URL이 있으므로 반드시 걷어내야 한다."""
    leaky_url = f"{qnet_api.API_BASE}/getOpenQstList?serviceKey=dummy-service-key"

    class _Client401:
        def get_text(self, url: str) -> str:
            raise ParseFailedError("사이트 응답 오류(HTTP 401)", detail={"url": leaky_url, "http_code": 401})

    with pytest.raises(AdapterServiceError) as excinfo:
        qnet_api.fetch_list_page(_Client401(), 1)
    exc = excinfo.value
    assert exc.kind == "key"
    assert "서비스키" in exc.public_message
    assert "dummy-service-key" not in json.dumps(exc.detail) + exc.public_message + exc.action


def test_http_error_detail_never_carries_service_key(registered_key):
    class _Client500:
        def get_text(self, url: str) -> str:
            raise ParseFailedError(
                "사이트 응답 오류(HTTP 500)",
                detail={"url": f"{qnet_api.API_BASE}/x?serviceKey=dummy-service-key", "http_code": 500},
            )

    with pytest.raises(ParseFailedError) as excinfo:
        qnet_api.fetch_list_page(_Client500(), 1)
    assert "dummy-service-key" not in json.dumps(excinfo.value.detail)


def test_key_change_clears_list_cache(monkeypatch, tmp_path):
    """키 삭제 직후에는 이전 키로 모은 목록이 남아 있으면 안 된다(스텁 동작 복귀)."""
    monkeypatch.setattr(secrets_store, "SECRETS_PATH", tmp_path / "secrets.json")
    registry.cache_set(qnet_adapter.LIST_CACHE_KEY, [{"artl_seq": "1"}])
    qnet_api.delete_service_key()
    assert registry.cache_get(qnet_adapter.LIST_CACHE_KEY) is None


def test_secrets_are_merged_not_overwritten(monkeypatch, tmp_path):
    """anthropic 키와 파일을 공유하므로 저장은 항상 병합이어야 한다(F34 훼손 금지)."""
    path = tmp_path / "secrets.json"
    monkeypatch.setattr(secrets_store, "SECRETS_PATH", path)
    secrets_store.set_secret("anthropic_api_key", "sk-ant-dummy")
    secrets_store.set_secret(qnet_api.SERVICE_KEY_NAME, "qnet-dummy")

    stored = json.loads(path.read_text(encoding="utf-8"))
    assert stored == {"anthropic_api_key": "sk-ant-dummy", "qnet_service_key": "qnet-dummy"}

    secrets_store.delete_secret(qnet_api.SERVICE_KEY_NAME)
    assert json.loads(path.read_text(encoding="utf-8")) == {"anthropic_api_key": "sk-ant-dummy"}
    assert secrets_store.key_status("anthropic_api_key") == {
        "key_registered": True,
        "key_suffix": "ummy",
    }


def test_mask_url_hides_service_key():
    url = f"{qnet_api.API_BASE}/getOpenQstList?numOfRows=50&serviceKey=SUPERSECRETKEY&pageNo=1"
    masked = qnet_api.mask_url(url)
    assert "SUPERSECRETKEY" not in masked
    assert "serviceKey=***" in masked


def test_encoded_key_is_not_double_encoded(monkeypatch):
    """포털의 Encoding 키(퍼센트 인코딩)를 붙여 넣어도 이중 인코딩(→401)이 되지 않는다."""
    monkeypatch.setattr(qnet_api, "get_service_key", lambda: qnet_api.normalize_key("aB%2Bc%2Fd%3D%3D"))
    client = FakeClient([[_raw(1, "[공개문제]종목", "1", "종목")]], total=1)
    qnet_api.fetch_list_page(client, 1)
    assert "%252B" not in client.urls[0]  # %2B가 다시 인코딩되지 않았다
    assert "serviceKey=aB%2Bc%2Fd%3D%3D" in client.urls[0]
    assert qnet_api.normalize_key("plainAlnumKey0123") == "plainAlnumKey0123"


def test_ssrf_allowlist_rejects_other_hosts():
    qnet_api.assert_allowed_host("http://openapi.hrdkorea.or.kr/rest/openQst/dwldOpenQstFile?token=x")
    qnet_api.assert_allowed_host("https://apis.data.go.kr/B490007/openQst/getOpenQst")
    with pytest.raises(Exception):
        qnet_api.assert_allowed_host("https://example.com/file.pdf")
    with pytest.raises(Exception):
        qnet_api.assert_allowed_host("http://127.0.0.1/file.pdf")


# --- ② 메타 빈값 방어(실측 3) ------------------------------------------------
def _adapter_with_items(monkeypatch, items=None):
    monkeypatch.setattr(qnet_api, "fetch_all_list_items", lambda client: items or SAMPLE_ITEMS)
    return QnetAdapter()


def test_empty_meta_items_do_not_create_fake_cert(monkeypatch, registered_key):
    adapter = _adapter_with_items(monkeypatch)
    certs = adapter.search_certs("", client=None)
    names = [c.name for c in certs]
    refs = [c.cert_ref for c in certs]

    assert "" not in refs and None not in refs
    assert not any("미상" in n for n in names)  # "(종목 미상)" 버킷 금지
    assert "[공개문제]보석디자인산업기사" not in names  # 종목 집계에는 끼지 않는다
    assert sorted(refs) == ["6210", "7802", "7920", "9776"]


def test_empty_meta_item_found_by_title_search(monkeypatch, registered_key):
    """조용히 사라지지 않는다 — 질의가 title에 포함되면 제목 그대로 노출된다."""
    adapter = _adapter_with_items(monkeypatch)
    certs = adapter.search_certs("보석디자인", client=None)
    assert [c.name for c in certs] == ["[공개문제]보석디자인산업기사"]
    assert certs[0].cert_ref.startswith(qnet_adapter.TITLE_REF_PREFIX)

    entries = adapter.list_exams(certs[0].cert_ref, client=None)
    assert [e.exam_ref for e in entries] == ["1006"]
    assert entries[0].cert_name == ""  # 자격증명을 지어내지 않는다 → 분류 경로도 안 만든다


def test_clean_treats_empty_string_and_none_identically():
    assert qnet_adapter.clean("") is None
    assert qnet_adapter.clean("   ") is None
    assert qnet_adapter.clean(None) is None
    assert qnet_adapter.clean(" 9776 ") == "9776"


# --- ③ 제목 파싱 표본 5종(실측 6) --------------------------------------------
def test_title_sample_1_date_key():
    key, kind, date = qnet_adapter.parse_title(SAMPLE_TITLES[0], "1001")
    assert (key, kind, date) == ("2026-07-14", "date", "2026-07-14")
    assert fetch_service.exam_folder_name(key) == "2026년 7월 14일"
    assert qnet_adapter.is_notice_post(SAMPLE_TITLES[0]) is False


def test_title_sample_2_year_only_does_not_invent_round():
    """`(2026년도)`는 연도만 안다 — 회차 키('2026-1' 등)를 지어내지 않는다."""
    key, kind, date = qnet_adapter.parse_title(SAMPLE_TITLES[1], "1002")
    assert (key, kind, date) == ("2026", "year", None)
    assert fetch_service.exam_folder_name(key) is None  # 분류 폴더 자동 생성 없음
    assert qnet_adapter.is_notice_post(SAMPLE_TITLES[1]) is False


def test_title_sample_3_unknown_is_standalone_entry():
    key, kind, date = qnet_adapter.parse_title(SAMPLE_TITLES[2], "1003")
    assert (key, kind, date) == ("qnet-1003", "unknown", None)
    assert fetch_service.exam_folder_name(key) is None
    assert qnet_adapter.is_notice_post(SAMPLE_TITLES[2]) is False


def test_title_sample_4_prefixed_notice_like_title_stays_standalone():
    """접두어가 있으면 안내문으로 숨기지 않는다(과잉 숨김 방지) — 회차는 식별 불가."""
    key, kind, _date = qnet_adapter.parse_title(SAMPLE_TITLES[3], "1004")
    assert (key, kind) == ("qnet-1004", "unknown")
    assert qnet_adapter.is_notice_post(SAMPLE_TITLES[3]) is False


def test_title_sample_5_is_notice_post():
    """접두어 없이 안내·집행만 있는 게시물 = 안내문(기본 숨김 대상)."""
    assert qnet_adapter.is_notice_post(SAMPLE_TITLES[4]) is True
    key, kind, _date = qnet_adapter.parse_title(SAMPLE_TITLES[4], "1005")
    assert (key, kind) == ("qnet-1005", "unknown")


def test_prefix_variants_are_equivalent():
    assert qnet_adapter.strip_prefix("[공개문제]봉제기능사") == "봉제기능사"
    assert qnet_adapter.strip_prefix("[문제공개] 봉제기능사") == "봉제기능사"
    assert qnet_adapter.strip_prefix("공개문제 봉제기능사") == "봉제기능사"
    assert qnet_adapter.strip_prefix("봉제기능사") == "봉제기능사"


# --- ④ 단일 어댑터 계약(also_on·refs·정렬) + 안내문 기본 숨김 ----------------
def _patch_registry(monkeypatch, adapter):
    monkeypatch.setattr(registry, "get_adapters", lambda: [adapter])
    monkeypatch.setattr(registry, "get_adapter", lambda aid: adapter if aid == "qnet" else None)
    monkeypatch.setattr(fetch_service, "_is_imported", lambda *a, **k: False)


def test_list_exams_contract_and_notice_hidden_by_default(monkeypatch, registered_key):
    adapter = _adapter_with_items(monkeypatch)
    _patch_registry(monkeypatch, adapter)
    sources = [{"adapter": "qnet", "cert_ref": "7802"}]  # 미용사(일반) — 1004·1005

    out = fetch_service.list_exams(db=None, sources=sources)
    assert [e["exam_ref"] for e in out] == ["1004"]  # 1005(안내문)은 기본 숨김
    assert out[0]["also_on"] == []
    assert out[0]["refs"] == {"qnet": "1004"}
    assert out[0]["exam_ref"] == out[0]["refs"]["qnet"]
    assert out[0]["label"] == SAMPLE_TITLES[3]
    assert out[0]["is_notice"] is False

    with_notices = fetch_service.list_exams(db=None, sources=sources, include_notices=True)
    assert sorted(e["exam_ref"] for e in with_notices) == ["1004", "1005"]
    assert [e["is_notice"] for e in with_notices if e["exam_ref"] == "1005"] == [True]


def test_list_exams_level_hint_is_practical_and_sorted_newest_first(monkeypatch, registered_key):
    """공개문제는 실기 작업형·도면 → level_hint='실기'. 정렬은 (연도, 월, 일) 수치 튜플."""
    items = [
        _raw(2001, "[공개문제]종목(20240301)", "1111", "종목"),
        _raw(2002, "[공개문제]종목(20260714)", "1111", "종목"),
        _raw(2003, "[공개문제]종목(2025년도)", "1111", "종목"),
        _raw(2004, "[문제공개]종목", "1111", "종목"),
    ]
    adapter = _adapter_with_items(monkeypatch, items)
    _patch_registry(monkeypatch, adapter)

    entries = adapter.list_exams("1111", client=None)
    assert {e.level_hint for e in entries} == {"실기"}

    out = fetch_service.list_exams(db=None, sources=[{"adapter": "qnet", "cert_ref": "1111"}])
    assert [e["exam_key"] for e in out] == ["2026-07-14", "2025", "2024-03-01", "qnet-2004"]


def test_search_certs_zero_result_is_not_an_error(monkeypatch, registered_key):
    """품질경영기사처럼 수록되지 않은 종목은 **0건 정상 응답**이다(실측 5)."""
    adapter = _adapter_with_items(monkeypatch)
    _patch_registry(monkeypatch, adapter)
    monkeypatch.setattr(registry, "new_client", lambda *a, **k: None)

    assert fetch_service.search_certs("품질경영기사") == []


# --- ⑤ 서비스키 미등록 = S13 스텁과 동일 동작 --------------------------------
def test_without_service_key_behaves_like_stub(monkeypatch):
    monkeypatch.setattr(qnet_api, "get_service_key", lambda: None)

    def _boom(client):  # 키가 없으면 API를 두드리지도 않는다(쿼터·불필요 호출 0)
        raise AssertionError("서비스키 없이 오픈API를 호출하면 안 된다")

    monkeypatch.setattr(qnet_api, "fetch_all_list_items", _boom)
    adapter = QnetAdapter()

    available, notice = adapter.is_available(client=None)
    assert available is False
    assert "서비스키" in (notice or "")
    assert adapter.search_certs("기사", client=None) == []
    assert adapter.list_exams("9776", client=None) == []
    assert adapter.status_extra() == {"key_registered": False, "key_suffix": None}


def test_adapter_notice_states_coverage_limit():
    """커버리지 한계(실기 위주·필기 범위 밖)가 notice에 고정 노출된다(DoD 8)."""
    notice = QnetAdapter().notice
    assert "실기" in notice
    assert "필기" in notice


# --- 비지원 포맷 문구 분기(실측 4 — 실제 대상은 ZIP) -------------------------
def test_unsupported_format_messages_branch_by_format():
    zip_msg, zip_action = qnet_adapter._unsupported_message(["zip"], ["a.zip"])
    assert "ZIP" in zip_msg
    assert "압축" in zip_action and "sources/" in zip_action

    hwp_msg, hwp_action = qnet_adapter._unsupported_message(["hwp"], ["a.hwp"])
    assert "한글" in hwp_msg and "PDF" in hwp_action

    none_msg, _ = qnet_adapter._unsupported_message([], [])
    assert "첨부 파일이 없습니다" in none_msg


def test_magic_bytes_guard_rejects_html_disguised_as_pdf():
    assert qnet_adapter._magic_ok("pdf", b"%PDF-1.7 ...") is True
    assert qnet_adapter._magic_ok("pdf", b"<html><body>error</body></html>") is False
    assert qnet_adapter._magic_ok("zip", b"PK\x03\x04rest") is True
    assert qnet_adapter._magic_ok("xlsx", b"anything") is True  # 검사 대상 밖은 통과


def test_unsupported_format_unknown_extension_with_saved_files_is_not_reported_as_no_attachment():
    """결함 2·3 — 확장자를 못 읽었지만 첨부는 실제로 저장됐다면 '첨부 없음'이 아니다."""
    msg, action = qnet_adapter._unsupported_message([], ["a.unknownext"])
    assert "첨부 파일이 없습니다" not in msg
    assert "확장자" in msg
    assert "sources/" in action  # 저장 안내가 살아 있어야 한다


# --- 결함 1 — 첨부 다운로드 실패 원인 분기(401/403=토큰 만료 추정, 그 외=원인 보존) -------
_ATTACH_URL = "https://openapi.hrdkorea.or.kr/rest/openQst/dwldOpenQstFile?token=leaked-jwt"


def _detail_with_one_attachment() -> Dict[str, Any]:
    return {"fileList": [{"fileUrl": _ATTACH_URL, "fileNm": "a.pdf"}]}


class _AttachClient:
    """get_bytes가 지정된 예외를 올리는 대역 — 재시도 여부 확인용으로 호출 횟수를 센다."""

    def __init__(self, exc: Exception) -> None:
        self.exc = exc
        self.calls = 0

    def get_bytes(self, url: str):
        self.calls += 1
        raise self.exc


@pytest.mark.parametrize("http_code", [401, 403])
def test_download_attachments_401_403_is_treated_as_token_expired(http_code):
    adapter = QnetAdapter()
    client = _AttachClient(
        ParseFailedError(
            f"사이트 응답 오류(HTTP {http_code})",
            detail={"url": _ATTACH_URL, "http_code": http_code},
        )
    )
    with pytest.raises(qnet_adapter._TokenExpired):
        adapter._download_attachments(client, _detail_with_one_attachment())


@pytest.mark.parametrize(
    "exc",
    [
        ParseFailedError("파일 크기가 상한(50MB)을 초과합니다", detail={"url": _ATTACH_URL}),
        ParseFailedError(
            "사이트 응답 오류(HTTP 500)", detail={"url": _ATTACH_URL, "http_code": 500}
        ),
        ParseFailedError("다운로드한 파일이 비어 있습니다", detail={"url": _ATTACH_URL}),
    ],
)
def test_download_attachments_other_failures_preserve_cause_without_retry(exc):
    """50MB 초과류(그 외 http_code·http_code 없음)는 토큰 만료로 오분류하지 않는다 —
    원인을 보존한 채 즉시 올리고, URL(JWT 토큰 포함)은 detail에 남기지 않는다."""
    adapter = QnetAdapter()
    client = _AttachClient(exc)

    with pytest.raises(AdapterServiceError) as excinfo:
        adapter._download_attachments(client, _detail_with_one_attachment())

    raised = excinfo.value
    assert raised.public_message == exc.public_message  # 원인 보존
    assert client.calls == 1  # 이 지점에서 재시도하지 않는다
    assert "leaked-jwt" not in json.dumps(raised.detail or {})


def test_fetch_exam_non_token_attachment_failure_raises_immediately(monkeypatch, registered_key):
    """상세 재조회(1회 재시도)는 토큰 만료 추정일 때만 — 그 외는 즉시 원인 보존 오류."""
    calls = {"n": 0}

    def _fake_fetch_detail(client, artl_seq, qualgb_cd=None):
        calls["n"] += 1
        return {"title": "[공개문제]종목(20260101)", "jmNm": "종목", **_detail_with_one_attachment()}

    monkeypatch.setattr(qnet_api, "fetch_detail", _fake_fetch_detail)
    client = _AttachClient(
        ParseFailedError("사이트 응답 오류(HTTP 500)", detail={"url": _ATTACH_URL, "http_code": 500})
    )
    adapter = QnetAdapter()

    with pytest.raises(AdapterServiceError) as excinfo:
        adapter.fetch_exam("9999", "1234", client)

    assert excinfo.value.public_message == "사이트 응답 오류(HTTP 500)"  # 원인 보존(사람 말)
    assert calls["n"] == 1  # 상세 재조회 없음(재시도 아님)


def test_fetch_exam_401_retries_once_then_reports_token_expired(monkeypatch, registered_key):
    calls = {"n": 0}

    def _fake_fetch_detail(client, artl_seq, qualgb_cd=None):
        calls["n"] += 1
        return {"title": "[공개문제]종목(20260101)", "jmNm": "종목", **_detail_with_one_attachment()}

    monkeypatch.setattr(qnet_api, "fetch_detail", _fake_fetch_detail)
    client = _AttachClient(
        ParseFailedError("사이트 응답 오류(HTTP 401)", detail={"url": _ATTACH_URL, "http_code": 401})
    )
    adapter = QnetAdapter()

    with pytest.raises(AdapterServiceError) as excinfo:
        adapter.fetch_exam("9999", "1234", client)

    assert "만료" in excinfo.value.public_message
    assert calls["n"] == 2  # 상세 재조회 1회(401/403만 재시도)


# --- 결함 4 — save_service_key는 정규화된 키 기준으로 저장·suffix 산출 ---------------
def test_save_service_key_normalizes_so_suffix_matches_status(monkeypatch, tmp_path):
    """퍼센트 인코딩(Encoding 형) 키를 저장해도 suffix는 정규화(디코딩) 기준과 같아야
    한다 — `service_key_status()`는 항상 `get_service_key()`(정규화 후) 기준이다."""
    monkeypatch.setattr(secrets_store, "SECRETS_PATH", tmp_path / "secrets.json")
    monkeypatch.setattr(qnet_api, "validate_service_key", lambda key: None)
    encoded = "aB%2Bc%2Fd%3D%3D"
    decoded = qnet_api.normalize_key(encoded)
    assert decoded != encoded  # 전제 확인 — 정규화가 실제로 값을 바꾼다

    suffix = qnet_api.save_service_key(encoded)

    assert suffix == secrets_store.key_suffix(decoded)
    assert qnet_api.service_key_status()["key_suffix"] == suffix
    assert secrets_store.get_secret(qnet_api.SERVICE_KEY_NAME) == decoded
