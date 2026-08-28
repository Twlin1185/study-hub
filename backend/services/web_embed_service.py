"""웹 임베드 북마크 카드 — 메타데이터 조회 (S37, 설계 §4.30, R39).

서버는 대상 URL의 HTML에서 OpenGraph/`<title>`/favicon 메타만 추출해 문자열로 돌려준다
(**원시 HTML 렌더 아님** — F43 ⓐ 불번복. HTML은 파싱 후 폐기하며 저장·전달하지 않는다).

SSRF 가드는 공용 `services/net_safety.py`를 재사용한다(§4.18 convert_service 전례와 동일
패턴 — 중복 구현 금지): 스킴 화이트리스트 → 호스트 DNS 해석 → 차단 대역 검증을 **매
리다이렉트 hop마다** 반복한다(첫 hop만 검사하는 우회 금지, 최대 5회).

DB 쓰기 0 · 파일 쓰기 0 · LLM 0 · 신규 파이썬 의존 0(urllib + html.parser 표준 라이브러리만
— 외부 HTML 파서 도입 금지). 서버측 메타 캐시도 금지(캐시는 클라이언트가 블록 JSON 안에
prop으로 보관 — §4.30 "캐시·오프라인 계약").
"""
from __future__ import annotations

import datetime as dt
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from typing import Dict, List, Optional

from exceptions import ValidationAppError
from services import net_safety

TIMEOUT_SECONDS = 5
MAX_REDIRECTS = 5
MAX_BODY_BYTES = 512 * 1024  # 512KB — 스트리밍 중 조기 차단(§4.27 ⑤ 관례)
FIELD_MAX_CHARS = 1000
_CHUNK_SIZE = 65536
_USER_AGENT = "StudyHub-WebEmbed/1.0"

# HTML 계열만 파싱 대상(§4.30 ②) — 그 외는 fetch_failed(비HTML).
_HTML_CONTENT_TYPES = ("text/html", "application/xhtml+xml")

_OG_PROPS = ("og:title", "og:description", "og:site_name", "og:image")


class _MetaParser(HTMLParser):
    """표준 라이브러리 html.parser 기반 최소 메타 추출기 — OpenGraph `og:*` +
    `<title>` + favicon `<link>`만 본다. 깨진 HTML도 관대하게(HTMLParser 기본 동작) 부분
    추출을 허용한다(예외를 던지지 않는다)."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._in_title = False
        self.title_parts: List[str] = []
        self.og: Dict[str, str] = {}
        self.icon_href: Optional[str] = None

    def handle_starttag(self, tag: str, attrs: List[tuple]) -> None:  # noqa: D401
        attrs_d = {(k or "").lower(): v for k, v in attrs}
        if tag == "title":
            self._in_title = True
        elif tag == "meta":
            prop = (attrs_d.get("property") or attrs_d.get("name") or "").lower()
            content = attrs_d.get("content")
            if prop in _OG_PROPS and content and prop not in self.og:
                self.og[prop] = content
        elif tag == "link":
            rel = (attrs_d.get("rel") or "").lower()
            href = attrs_d.get("href")
            if "icon" in rel and href and self.icon_href is None:
                self.icon_href = href

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title_parts.append(data)


def _fetch_failed(message: str) -> ValidationAppError:
    return ValidationAppError(message, detail={"reason": "fetch_failed"})


def _invalid_url(message: str) -> ValidationAppError:
    return ValidationAppError(message, detail={"reason": "invalid_url"})


def _assert_public_host(host: str) -> None:
    """호스트 재검증 — `net_safety`의 예외를 §4.30 계약 422 코드(`blocked_address`/
    `fetch_failed`)로 감싼다. DNS 해석 자체가 안 되는 경우는 "요청 형식은 유효하나 접속에
    실패"로 보아 `fetch_failed`로 분류한다(스킴은 이미 유효했으므로 invalid_url이 아니고,
    차단 대역으로 확정된 것도 아니므로 blocked_address도 아니다)."""
    try:
        net_safety.assert_public_host(host)
    except net_safety.HostResolveError as exc:
        raise _fetch_failed(f"호스트를 확인할 수 없습니다: {host}") from exc
    except net_safety.UnsafeHostError as exc:
        raise ValidationAppError(
            "사설·루프백·링크로컬 등 로컬 네트워크 주소로의 요청은 허용되지 않습니다(SSRF 방지)",
            detail={"reason": "blocked_address", "host": host, "ip": exc.ip},
        ) from exc


def _extract_charset(content_type_raw: str) -> str:
    for part in content_type_raw.split(";")[1:]:
        part = part.strip()
        if part.lower().startswith("charset="):
            charset = part.split("=", 1)[1].strip().strip('"').strip("'")
            if charset:
                try:
                    "".encode(charset)
                    return charset
                except LookupError:
                    return "utf-8"
    return "utf-8"


def _truncate(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    value = value.strip()
    if not value:
        return None
    return value[:FIELD_MAX_CHARS]


def _resolve_url(base: str, href: Optional[str]) -> Optional[str]:
    if not href:
        return None
    href = href.strip()
    if not href:
        return None
    return urllib.parse.urljoin(base, href)


def fetch_preview(url: str) -> dict:
    """§4.30 ① 계약 — 성공 시 부분 성공(필드별 null) 허용, 가드 위반·조회 실패는 422로
    던진다(라우터가 그대로 전파 → main.py AppError 핸들러가 §3 포맷으로 변환)."""
    current_url = url
    opener = urllib.request.build_opener(net_safety.NoRedirectHandler(), net_safety.https_handler())

    for _hop in range(MAX_REDIRECTS + 1):  # 최초 1회 + 리다이렉트 최대 5회
        parsed = urllib.parse.urlparse(current_url)
        if parsed.scheme not in ("http", "https"):
            raise _invalid_url("http/https URL만 허용됩니다")
        host = parsed.hostname
        if not host:
            raise _invalid_url("URL에 호스트가 없습니다")
        _assert_public_host(host)

        req = urllib.request.Request(current_url, headers={"User-Agent": _USER_AGENT})
        try:
            resp = opener.open(req, timeout=TIMEOUT_SECONDS)
        except urllib.error.HTTPError as exc:
            if exc.code in net_safety.REDIRECT_CODES:
                location = exc.headers.get("Location") if exc.headers else None
                if not location:
                    raise _fetch_failed("리다이렉트 대상 URL이 없습니다") from exc
                current_url = urllib.parse.urljoin(current_url, location)
                continue
            raise _fetch_failed(f"메타데이터를 가져오지 못했습니다(HTTP {exc.code})") from exc
        except (urllib.error.URLError, OSError, TimeoutError) as exc:
            raise _fetch_failed(f"메타데이터를 가져오는 중 오류가 발생했습니다: {exc}") from exc

        with resp:
            final_url = resp.geturl() or current_url
            content_type_raw = resp.headers.get("Content-Type", "")
            content_type = content_type_raw.split(";")[0].strip().lower()
            if content_type not in _HTML_CONTENT_TYPES:
                raise _fetch_failed("HTML 문서가 아니어서 메타데이터를 추출할 수 없습니다")
            charset = _extract_charset(content_type_raw)

            chunks: List[bytes] = []
            total = 0
            while True:
                chunk = resp.read(_CHUNK_SIZE)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_BODY_BYTES:
                    raise _fetch_failed("응답 본문이 상한(512KB)을 초과합니다")
                chunks.append(chunk)
            data = b"".join(chunks)

        html_text = data.decode(charset, errors="replace")
        parser = _MetaParser()
        parser.feed(html_text)
        parser.close()
        del html_text, data  # HTML은 파싱 후 폐기(저장·전달 0 — §4.30 ②)

        title = parser.og.get("og:title") or "".join(parser.title_parts).strip() or None
        description = parser.og.get("og:description") or None
        site_name = parser.og.get("og:site_name") or None
        image = _resolve_url(final_url, parser.og.get("og:image"))
        favicon = _resolve_url(final_url, parser.icon_href)

        return {
            "url": url,
            "title": _truncate(title),
            "description": _truncate(description),
            "site_name": _truncate(site_name),
            "image": _truncate(image),
            "favicon": _truncate(favicon),
            "fetched_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        }

    raise _fetch_failed("리다이렉트가 너무 많습니다(5회 초과)")
