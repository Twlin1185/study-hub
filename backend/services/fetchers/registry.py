"""어댑터 등록·우선순위 + 크롤링 예의 강제 장치 (F35-2, 설계 §4.13).

**강제 조항(위반 구현 금지)**:
1. robots.txt 존중 — 사이트별 24h 캐시, 비허용 경로는 수집 거부.
2. 사이트별 **최소 2초 전역 스로틀**(목록·문항·이미지 전부) — 병렬 금지, 오류 시 백오프.
3. User-Agent `StudyHub-Personal/1.0`.
6. SSRF 방지 — 사설/루프백/링크로컬 IP 차단(F35-1 관례 유지).

**등록 어댑터: qnet 단독**(priority=1 고정 — S13에서 사설 사이트 어댑터들을 제거하고
단일 어댑터화, 계획서 §14 F35-2 "제거 이력"). 어댑터 간 병합·우선순위 채택은
없다(설계 §4.13 "회차 목록 구성" S13 재작성). 자격증/회차 목록은 서버 메모리 캐시
(TTL 24h)로 반복 크롤링을 막는다.
"""
from __future__ import annotations

import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
import datetime as dt
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from services import net_safety
from services.fetchers.base import ActivityCallback, Adapter, ParseFailedError

USER_AGENT = "StudyHub-Personal/1.0"
MIN_INTERVAL_SECONDS = 2.0  # 사이트별 최소 요청 간격 (강제 조항 2)
CACHE_TTL = dt.timedelta(hours=24)
ROBOTS_TTL = dt.timedelta(hours=24)
REQUEST_TIMEOUT = 25
MAX_FETCH_BYTES = 50 * 1024 * 1024  # 파일 다운로드 상한 (F35-1 관례)
MAX_HTML_BYTES = 8 * 1024 * 1024  # HTML 페이지 상한
MAX_BACKOFF_SECONDS = 16.0
MAX_REDIRECTS = 5  # 리다이렉트 hop 상한 (SSRF 재검증 루프)
_RETRY_CODES = (429, 500, 502, 503, 504)


# ---------------------------------------------------------------------------
# SSRF 안전 호스트 검증 (공용 net_safety를 registry 예외로 감싼다 — 중복 구현 금지)
# ---------------------------------------------------------------------------
def _assert_public_host(host: str) -> None:
    try:
        net_safety.assert_public_host(host)
    except net_safety.HostResolveError as exc:
        raise ParseFailedError("사이트 호스트를 확인할 수 없습니다", detail={"host": host}) from exc
    except net_safety.UnsafeHostError as exc:
        raise ParseFailedError(
            "로컬 네트워크 주소로의 수집은 허용되지 않습니다(SSRF 방지)",
            detail={"host": host, "ip": exc.ip},
        ) from exc


# ---------------------------------------------------------------------------
# 사이트별 전역 스로틀 (병렬 금지 — 도메인별 락 + 마지막 요청 시각)
# ---------------------------------------------------------------------------
_THROTTLE_LOCK = threading.Lock()
_DOMAIN_LOCKS: Dict[str, threading.Lock] = {}
_LAST_REQUEST_AT: Dict[str, float] = {}


def _domain_lock(host: str) -> threading.Lock:
    with _THROTTLE_LOCK:
        lock = _DOMAIN_LOCKS.get(host)
        if lock is None:
            lock = threading.Lock()
            _DOMAIN_LOCKS[host] = lock
        return lock


# ---------------------------------------------------------------------------
# 단일 hop 요청(도메인 스로틀 2초 + 5xx/429 지수 백오프) — 리다이렉트는 추종하지 않고
# ('redirect', location)을 반환해 호출부가 hop마다 SSRF/robots를 재검증하게 한다.
# ---------------------------------------------------------------------------
def _ascii_safe_url(url: str) -> str:
    """IRI(경로·쿼리에 한글 등 비ASCII 포함 URL) → ASCII URI.

    비ASCII URL은 두 경로로 들어온다 — ① HTML href의 진짜 유니코드 str,
    ② 302 Location 헤더: http.client가 UTF-8 바이트를 latin-1로 디코드한
    mojibake str(한글 파일명을 내려주는 게시판형 사이트에서 실측). ②를 UTF-8로
    재인코딩하면 깨진 URL이 되므로 latin-1 인코딩이 가능하면 원래 바이트로 복원해
    quote한다 — cpython `HTTPRedirectHandler`가 Location을 iso-8859-1로 quote하는
    것과 같은 규약. 이미 인코딩된 %XX·예약 문자는 보존(이중 인코딩 방지). 호스트는
    어댑터 허용 도메인(ASCII)뿐이라 IDN 변환은 다루지 않는다.
    """
    if url.isascii():
        return url
    try:
        raw: bytes = url.encode("latin-1")  # 헤더 경유 mojibake → 원 바이트 복원
    except UnicodeEncodeError:
        raw = url.encode("utf-8")  # 진짜 유니코드 IRI(HTML에서 추출)
    return urllib.parse.quote(raw, safe=":/?#[]@!$&'()*+,;=%")


def _single_hop_request(url: str, host: str, headers: dict):
    """반환: ('ok', response) | ('redirect', location_url). HTTP/네트워크 오류는
    ParseFailedError(detail에 http_code 있으면 HTTP 오류)로 올린다."""
    url = _ascii_safe_url(url)
    opener = urllib.request.build_opener(net_safety.NoRedirectHandler())
    lock = _domain_lock(host)
    with lock:  # 병렬 금지 — 도메인당 한 요청씩
        last = _LAST_REQUEST_AT.get(host)
        if last is not None:
            wait = MIN_INTERVAL_SECONDS - (time.monotonic() - last)
            if wait > 0:
                time.sleep(wait)
        backoff = MIN_INTERVAL_SECONDS
        attempt = 0
        while True:
            attempt += 1
            try:
                req = urllib.request.Request(url, headers=headers)
                resp = opener.open(req, timeout=REQUEST_TIMEOUT)
                _LAST_REQUEST_AT[host] = time.monotonic()
                return ("ok", resp)
            except urllib.error.HTTPError as exc:
                _LAST_REQUEST_AT[host] = time.monotonic()
                if exc.code in net_safety.REDIRECT_CODES:
                    location = exc.headers.get("Location") if exc.headers else None
                    if not location:
                        raise ParseFailedError(
                            "리다이렉트 대상 URL이 없습니다", detail={"url": url, "http_code": exc.code}
                        ) from exc
                    return ("redirect", urllib.parse.urljoin(url, location))
                if exc.code in _RETRY_CODES and attempt <= 3:
                    time.sleep(min(backoff, MAX_BACKOFF_SECONDS))
                    backoff *= 2
                    continue
                raise ParseFailedError(
                    f"사이트 응답 오류(HTTP {exc.code})", detail={"url": url, "http_code": exc.code}
                ) from exc
            except (urllib.error.URLError, OSError, TimeoutError) as exc:
                _LAST_REQUEST_AT[host] = time.monotonic()
                if attempt <= 3:
                    time.sleep(min(backoff, MAX_BACKOFF_SECONDS))
                    backoff *= 2
                    continue
                raise ParseFailedError("사이트에 접속하지 못했습니다", detail={"url": url}) from exc


def _open_validated(
    url: str,
    *,
    headers: dict,
    enforce_robots: bool,
    robots_checker: Optional[Callable[[str], bool]] = None,
):
    """리다이렉트 매 hop마다 (스킴·호스트 검증 → SSRF 공개 IP 재검증 → robots 재확인 →
    스로틀 요청)을 반복한다. 초기 URL이 사설/메타데이터 IP로 리다이렉트돼도 재검증에 걸린다."""
    current = url
    for _hop in range(MAX_REDIRECTS + 1):
        parsed = urllib.parse.urlparse(current)
        if parsed.scheme not in ("http", "https"):
            raise ParseFailedError("http/https URL만 허용됩니다", detail={"url": current})
        host = parsed.hostname
        if not host:
            raise ParseFailedError("URL에 호스트가 없습니다", detail={"url": current})
        _assert_public_host(host)  # hop마다 SSRF 재검증
        if enforce_robots:
            checker = robots_checker or _default_robots_checker
            if not checker(current):
                raise ParseFailedError(
                    "robots.txt가 이 경로의 수집을 허용하지 않습니다",
                    alternatives=["url_import"],
                    detail={"url": current},
                )
        kind, payload = _single_hop_request(current, host, headers)
        if kind == "ok":
            return payload
        current = payload  # 리다이렉트 — 다음 hop에서 호스트/robots 재검증
    raise ParseFailedError("리다이렉트가 너무 많습니다(5회 초과)", detail={"url": url})


def _default_robots_checker(url: str) -> bool:
    parsed = urllib.parse.urlparse(url)
    host = parsed.hostname
    if not host:
        return False
    robots = _get_robots(host, parsed.scheme or "https")
    if robots is None:
        return False
    return robots.can_fetch(USER_AGENT, url)


# ---------------------------------------------------------------------------
# robots.txt (도메인별 24h 캐시)
# ---------------------------------------------------------------------------
_ROBOTS_LOCK = threading.Lock()
_ROBOTS_CACHE: Dict[str, Tuple[dt.datetime, Optional[urllib.robotparser.RobotFileParser]]] = {}


def _get_robots(host: str, scheme: str) -> Optional[urllib.robotparser.RobotFileParser]:
    now = dt.datetime.now()
    with _ROBOTS_LOCK:
        cached = _ROBOTS_CACHE.get(host)
        if cached is not None and now - cached[0] < ROBOTS_TTL:
            return cached[1]
    parser: Optional[urllib.robotparser.RobotFileParser] = urllib.robotparser.RobotFileParser()
    robots_url = f"{scheme}://{host}/robots.txt"
    try:
        # robots.txt 자체도 리다이렉트 SSRF 재검증을 적용해 가져온다(robots 재확인은 끈다 —
        # 무한 재귀 방지). 스로틀·백오프는 _single_hop_request가 담당한다.
        resp = _open_validated(robots_url, headers={"User-Agent": USER_AGENT}, enforce_robots=False)
        with resp:
            raw = resp.read(512 * 1024)
        text = raw.decode("utf-8", errors="replace")
        # robots.txt가 아니라 HTML 오류 페이지를 반환하는 사이트(예: 서비스 점검)도 있다 —
        # 그 경우 지시자가 없어 전부 허용으로 해석된다(표준 동작).
        parser.parse(text.splitlines())
    except ParseFailedError as exc:
        code = (exc.detail or {}).get("http_code") if isinstance(exc.detail, dict) else None
        if code in (401, 403):
            parser = None  # 접근 제한 → 전부 불허(보수적)
        elif code is not None:
            parser.parse([])  # 404 등 그 외 HTTP 상태 → robots 없음으로 보고 전부 허용
        else:
            parser = None  # 네트워크 오류·SSRF 차단 등 못 읽으면 보수적으로 불허
    with _ROBOTS_LOCK:
        _ROBOTS_CACHE[host] = (now, parser)
    return parser


# ---------------------------------------------------------------------------
# FetchClient — 어댑터에 주입되는 유일한 HTTP 통로
# ---------------------------------------------------------------------------
class FetchClient:
    """스로틀·robots·UA·SSRF·크기 상한·백오프를 모두 적용한 HTTP 통로.

    어댑터는 이 객체의 `get_text`/`get_bytes`만 쓴다. 병렬 요청 금지 — 도메인 락으로
    한 번에 한 요청만 나가며, 요청 사이 2초를 보장한다."""

    def __init__(self, on_activity: ActivityCallback = None) -> None:
        self.on_activity = on_activity

    # -- robots --
    def can_fetch(self, url: str) -> bool:
        parsed = urllib.parse.urlparse(url)
        host = parsed.hostname
        if not host:
            return False
        robots = _get_robots(host, parsed.scheme or "https")
        if robots is None:
            return False  # robots를 못 읽었거나 401/403 → 수집 거부
        return robots.can_fetch(USER_AGENT, url)

    # -- 저수준 요청 (리다이렉트 매 hop SSRF/robots 재검증 + 스로틀 + 백오프) --
    def _open(self, url: str, *, extra_headers: Optional[dict] = None):
        headers = {"User-Agent": USER_AGENT}
        if extra_headers:
            headers.update(extra_headers)
        return _open_validated(
            url, headers=headers, enforce_robots=True, robots_checker=self.can_fetch
        )

    def get_text(self, url: str) -> str:
        resp = self._open(url)
        with resp:
            data = resp.read(MAX_HTML_BYTES)
            charset = None
            ctype = resp.headers.get("Content-Type", "")
            for part in ctype.split(";"):
                part = part.strip().lower()
                if part.startswith("charset="):
                    charset = part.split("=", 1)[1]
        if self.on_activity:
            self.on_activity()
        for enc in ([charset] if charset else []) + ["utf-8", "euc-kr", "cp949"]:
            if not enc:
                continue
            try:
                return data.decode(enc)
            except (UnicodeDecodeError, LookupError):
                continue
        return data.decode("utf-8", errors="replace")

    def get_bytes(
        self, url: str, *, max_bytes: int = MAX_FETCH_BYTES, referer: Optional[str] = None
    ) -> Tuple[bytes, Optional[str], Optional[str]]:
        """(data, content_type, filename). 크기 상한·스로틀·robots 적용.

        referer: 일부 게시판형 사이트는 다운로드 요청에 Referer가 없으면 파일 대신
        HTML 안내 페이지를 반환한다 — 그런 사이트를 위해 첨부를 발견한 게시물 URL을
        넘길 수 있는 범용 훅(현재 등록 어댑터는 사용하지 않음).
        """
        resp = self._open(url, extra_headers={"Referer": referer} if referer else None)
        with resp:
            ctype = (resp.headers.get("Content-Type") or "").split(";")[0].strip().lower() or None
            disposition = resp.headers.get("Content-Disposition") or ""
            chunks: List[bytes] = []
            total = 0
            while True:
                chunk = resp.read(65536)
                if not chunk:
                    break
                total += len(chunk)
                if total > max_bytes:
                    raise ParseFailedError(
                        "파일 크기가 상한(50MB)을 초과합니다", detail={"url": url}
                    )
                chunks.append(chunk)
                if self.on_activity:
                    self.on_activity()
            data = b"".join(chunks)
        if not data:
            raise ParseFailedError("다운로드한 파일이 비어 있습니다", detail={"url": url})
        filename = _filename_from_disposition(disposition)
        return data, ctype, filename


def _filename_from_disposition(disposition: str) -> Optional[str]:
    if not disposition:
        return None
    # filename*=UTF-8''... 또는 filename="..."
    m = urllib.parse.unquote
    import re

    star = re.search(r"filename\*\s*=\s*[^']*''([^;]+)", disposition, re.I)
    if star:
        return m(star.group(1)).strip().strip('"')
    plain = re.search(r'filename\s*=\s*"?([^";]+)"?', disposition, re.I)
    if plain:
        return plain.group(1).strip()
    return None


# ---------------------------------------------------------------------------
# 어댑터 등록 (S13 — qnet 단독, priority=1 고정. 사설 사이트 어댑터들은
# 계획서 §14 F35-2 "제거 이력"에 따라 코드와 함께 삭제됐다)
# ---------------------------------------------------------------------------
def _load_adapters() -> List[Adapter]:
    from services.fetchers.qnet import QnetAdapter

    return [QnetAdapter()]


_ADAPTERS: Optional[List[Adapter]] = None


def get_adapters() -> List[Adapter]:
    global _ADAPTERS
    if _ADAPTERS is None:
        _ADAPTERS = _load_adapters()
    return _ADAPTERS


def get_adapter(adapter_id: str) -> Optional[Adapter]:
    for adapter in get_adapters():
        if adapter.id == adapter_id:
            return adapter
    return None


# ---------------------------------------------------------------------------
# 목록 캐시 (TTL 24h) — 반복 크롤링 방지
# ---------------------------------------------------------------------------
_CACHE_LOCK = threading.Lock()
_CACHE: Dict[str, Tuple[dt.datetime, Any]] = {}


def cache_get(key: str) -> Any:
    now = dt.datetime.now()
    with _CACHE_LOCK:
        entry = _CACHE.get(key)
        if entry is None:
            return None
        ts, value = entry
        if now - ts > CACHE_TTL:
            _CACHE.pop(key, None)
            return None
        return value


def cache_set(key: str, value: Any) -> None:
    with _CACHE_LOCK:
        _CACHE[key] = (dt.datetime.now(), value)


def new_client(on_activity: ActivityCallback = None) -> FetchClient:
    return FetchClient(on_activity=on_activity)
