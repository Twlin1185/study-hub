"""웹 임베드 북마크 카드 — 메타데이터 조회 서비스 단위 테스트 (S37, 설계 §4.30).

네트워크는 전부 모킹한다(`urllib.request.build_opener`를 페이크로 치환). 사설/루프백/
링크로컬 IP 검증은 IP 리터럴 호스트를 그대로 넘겨 `socket.getaddrinfo`가 실제 DNS 조회
없이 로컬에서 파싱하도록 한다(외부 네트워크 접근 없음 — test_fetch_logic.py의 리터럴 IP
전례와 동일한 방식).
"""
from __future__ import annotations

import urllib.error
from email.message import Message

import pytest

from exceptions import ValidationAppError
from services import web_embed_service


class _FakeResponse:
    def __init__(self, *, url: str, content_type: str, body: bytes) -> None:
        self._url = url
        self.headers = {"Content-Type": content_type}
        self._body = body
        self._pos = 0

    def geturl(self) -> str:
        return self._url

    def read(self, n: int) -> bytes:
        chunk = self._body[self._pos : self._pos + n]
        self._pos += len(chunk)
        return chunk

    def __enter__(self) -> "_FakeResponse":
        return self

    def __exit__(self, *exc: object) -> bool:
        return False


class _FakeOpener:
    def __init__(self, responses) -> None:
        self._responses = list(responses)
        self.calls = 0

    def open(self, req, timeout=None):  # noqa: ANN001
        self.calls += 1
        item = self._responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


def _http_redirect(location: str, code: int = 302) -> urllib.error.HTTPError:
    hdrs = Message()
    hdrs["Location"] = location
    return urllib.error.HTTPError("http://origin/", code, "Found", hdrs, None)


def _patch_opener(monkeypatch, responses) -> _FakeOpener:
    opener = _FakeOpener(responses)
    monkeypatch.setattr(
        web_embed_service.urllib.request, "build_opener", lambda *a, **k: opener
    )
    return opener


# --- ① 스킴 가드 ------------------------------------------------------------
def test_rejects_non_http_scheme():
    with pytest.raises(ValidationAppError) as excinfo:
        web_embed_service.fetch_preview("ftp://example.com/file")
    assert excinfo.value.detail["reason"] == "invalid_url"


def test_rejects_missing_host():
    with pytest.raises(ValidationAppError) as excinfo:
        web_embed_service.fetch_preview("http:///no-host")
    assert excinfo.value.detail["reason"] == "invalid_url"


# --- ② 주소 차단(사설/루프백/링크로컬) ---------------------------------------
def test_rejects_loopback_ip():
    with pytest.raises(ValidationAppError) as excinfo:
        web_embed_service.fetch_preview("http://127.0.0.1/")
    assert excinfo.value.detail["reason"] == "blocked_address"


def test_rejects_private_rfc1918_ip():
    with pytest.raises(ValidationAppError) as excinfo:
        web_embed_service.fetch_preview("http://10.0.0.5/")
    assert excinfo.value.detail["reason"] == "blocked_address"


def test_rejects_link_local_metadata_ip():
    with pytest.raises(ValidationAppError) as excinfo:
        web_embed_service.fetch_preview("http://169.254.169.254/latest/meta-data/")
    assert excinfo.value.detail["reason"] == "blocked_address"


# --- 리다이렉트 매 hop 재검증 --------------------------------------------------
def test_redirect_hop_is_revalidated_against_private_ip(monkeypatch):
    """공개 IP로 시작해도 리다이렉트 대상이 사설 IP면 다음 hop 진입 전에 차단된다
    (첫 hop만 검사하는 우회 금지 — 실제 두 번째 요청은 나가지 않아야 한다)."""
    opener = _patch_opener(monkeypatch, [_http_redirect("http://127.0.0.1/evil")])

    with pytest.raises(ValidationAppError) as excinfo:
        web_embed_service.fetch_preview("http://8.8.8.8/start")

    assert excinfo.value.detail["reason"] == "blocked_address"
    assert opener.calls == 1  # 두 번째 hop은 요청 전에 차단됨(재요청 없음)


def test_redirect_caps_at_five_hops(monkeypatch):
    responses = [_http_redirect("http://8.8.4.4/next") for _ in range(10)]
    opener = _patch_opener(monkeypatch, responses)

    with pytest.raises(ValidationAppError) as excinfo:
        web_embed_service.fetch_preview("http://8.8.8.8/start")

    assert excinfo.value.detail["reason"] == "fetch_failed"
    assert "리다이렉트" in excinfo.value.message
    assert opener.calls == web_embed_service.MAX_REDIRECTS + 1  # 최초 1회 + 리다이렉트 5회


# --- 응답 제한: 비HTML·본문 상한·타임아웃 -------------------------------------
def test_non_html_content_type_is_fetch_failed(monkeypatch):
    resp = _FakeResponse(url="http://8.8.8.8/x", content_type="application/json", body=b"{}")
    _patch_opener(monkeypatch, [resp])

    with pytest.raises(ValidationAppError) as excinfo:
        web_embed_service.fetch_preview("http://8.8.8.8/x")

    assert excinfo.value.detail["reason"] == "fetch_failed"


def test_body_over_512kb_is_cut_off_early(monkeypatch):
    body = b"<html><head><title>t</title></head><body>" + (b"a" * (600 * 1024)) + b"</body></html>"
    resp = _FakeResponse(url="http://8.8.8.8/big", content_type="text/html", body=body)
    _patch_opener(monkeypatch, [resp])

    with pytest.raises(ValidationAppError) as excinfo:
        web_embed_service.fetch_preview("http://8.8.8.8/big")

    assert excinfo.value.detail["reason"] == "fetch_failed"
    assert "512" in excinfo.value.message


def test_timeout_is_fetch_failed(monkeypatch):
    _patch_opener(monkeypatch, [TimeoutError("timed out")])

    with pytest.raises(ValidationAppError) as excinfo:
        web_embed_service.fetch_preview("http://8.8.8.8/slow")

    assert excinfo.value.detail["reason"] == "fetch_failed"


def test_http_error_status_is_fetch_failed(monkeypatch):
    hdrs = Message()
    err = urllib.error.HTTPError("http://8.8.8.8/missing", 404, "Not Found", hdrs, None)
    _patch_opener(monkeypatch, [err])

    with pytest.raises(ValidationAppError) as excinfo:
        web_embed_service.fetch_preview("http://8.8.8.8/missing")

    assert excinfo.value.detail["reason"] == "fetch_failed"


# --- 산출 제한: 1,000자 절단 -----------------------------------------------
def test_field_truncated_to_1000_chars(monkeypatch):
    long_desc = "가" * 2000
    html = f"""
    <html><head>
      <title>제목</title>
      <meta property="og:title" content="OG 제목">
      <meta property="og:description" content="{long_desc}">
      <meta property="og:site_name" content="예시">
      <meta property="og:image" content="/thumb.png">
      <link rel="icon" href="/favicon.ico">
    </head><body></body></html>
    """.encode("utf-8")
    resp = _FakeResponse(url="https://example.com/page", content_type="text/html; charset=utf-8", body=html)
    _patch_opener(monkeypatch, [resp])

    result = web_embed_service.fetch_preview("https://example.com/page")

    assert result["url"] == "https://example.com/page"
    assert result["title"] == "OG 제목"
    assert result["description"] is not None
    assert len(result["description"]) == web_embed_service.FIELD_MAX_CHARS
    assert result["site_name"] == "예시"
    assert result["image"] == "https://example.com/thumb.png"
    assert result["favicon"] == "https://example.com/favicon.ico"
    assert result["fetched_at"]


# --- 부분 성공(메타 없음) ----------------------------------------------------
def test_partial_success_when_no_meta_tags(monkeypatch):
    html = b"<html><head></head><body>no meta here</body></html>"
    resp = _FakeResponse(url="https://example.com/bare", content_type="text/html", body=html)
    _patch_opener(monkeypatch, [resp])

    result = web_embed_service.fetch_preview("https://example.com/bare")

    assert result["url"] == "https://example.com/bare"
    assert result["title"] is None
    assert result["description"] is None
    assert result["site_name"] is None
    assert result["image"] is None
    assert result["favicon"] is None
