"""공용 아웃바운드 HTTP 안전 프리미티브 (SSRF 방지).

URL 다운로드/크롤링을 하는 곳(F35-1 convert URL 반입, F35-2 사이트 어댑터)이 공유한다 —
사설/루프백/링크로컬/메타데이터 IP 차단과 **리다이렉트 매 hop 재검증**을 위한 부품을 한 곳에
둔다(중복 구현 금지). 호출부는 자신의 예외 타입으로 감싸 사용한다.
"""
from __future__ import annotations

import ipaddress
import logging
import socket
import ssl
import urllib.request
from typing import Optional

logger = logging.getLogger(__name__)


class UnsafeHostError(Exception):
    """호스트가 사설/루프백/차단 대역 IP로 해석됨(SSRF)."""

    def __init__(self, message: str, *, host: Optional[str] = None, ip: Optional[str] = None) -> None:
        super().__init__(message)
        self.host = host
        self.ip = ip


class HostResolveError(Exception):
    """호스트 DNS 해석 실패."""

    def __init__(self, message: str, *, host: Optional[str] = None) -> None:
        super().__init__(message)
        self.host = host


class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    """자동 리다이렉트를 막고 매 hop을 호출부가 직접 검증하게 한다(SSRF 방지) — urllib은
    3xx를 HTTPError로 올려주므로, 호출부가 Location을 꺼내 호스트 재검증부터 다시 시작한다."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001, D401
        return None


# 리다이렉트로 간주하는 상태 코드(공통).
REDIRECT_CODES = (301, 302, 303, 307, 308)


_ssl_context: Optional[ssl.SSLContext] = None


def ssl_context() -> ssl.SSLContext:
    """아웃바운드 HTTPS 공용 SSL 컨텍스트 — OS 신뢰 저장소(Windows CertStore) 위에 `certifi`
    번들을 **추가로** 얹는다. 임베디드 파이썬은 OpenSSL이 Windows의 AIA 중간 인증서 자동
    조회를 쓰지 못해, 아직 캐시되지 않은 CA 체인(GitHub 릴리스 등)에서
    `CERTIFICATE_VERIFY_FAILED: unable to get local issuer certificate`가 간헐적으로 난다.
    certifi 번들을 함께 신뢰하면 두 저장소 중 하나만 체인을 알아도 검증이 통과한다.
    certifi 미설치면 기본 컨텍스트 그대로(동작 저하 없음)."""
    global _ssl_context
    if _ssl_context is None:
        ctx = ssl.create_default_context()
        try:
            import certifi  # noqa: WPS433 - 선택 의존

            ctx.load_verify_locations(cafile=certifi.where())
        except Exception as exc:  # noqa: BLE001 - certifi 부재/손상은 OS 저장소만으로 진행
            logger.warning("certifi 번들 로드 실패 — OS 신뢰 저장소만 사용: %s", exc)
        _ssl_context = ctx
    return _ssl_context


def https_handler() -> urllib.request.HTTPSHandler:
    """`urllib.request.build_opener(...)`에 끼울 HTTPS 핸들러 — `ssl_context()` 적용."""
    return urllib.request.HTTPSHandler(context=ssl_context())


def is_blocked_ip(ip_str: str) -> bool:
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return True  # 파싱 실패는 안전하게 차단
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )


def assert_public_host(host: str) -> None:
    """호스트가 해석하는 **모든** IP가 공개 대역인지 검증. 하나라도 차단 대역이면
    `UnsafeHostError`, 해석 실패면 `HostResolveError`를 던진다."""
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror as exc:
        raise HostResolveError(f"호스트를 확인할 수 없습니다: {host}", host=host) from exc
    if not infos:
        raise HostResolveError(f"호스트를 확인할 수 없습니다: {host}", host=host)
    for info in infos:
        ip = info[4][0]
        if is_blocked_ip(ip):
            raise UnsafeHostError(
                "로컬/사설 네트워크 주소로의 요청은 허용되지 않습니다(SSRF 방지)",
                host=host,
                ip=ip,
            )
