"""공공데이터포털 "국가자격 공개문제 조회 서비스" 저수준 클라이언트 (F35-3, 설계 §4.13 S14).

`apis.data.go.kr/B490007/openQst` — 역설계·스크랩이 아닌 **공식 계약**이다. 이 모듈은
서비스키 관리·요청 조립·resultCode 사람 말 매핑만 담당하고, 목록 파생·제목 파싱 등
도메인 로직은 `services/fetchers/qnet.py`(어댑터)가 맡는다.

**불변 규칙**
- **서비스키는 write-only** — 응답·로그·오류 메시지 어디에도 원문을 담지 않는다. 요청 URL을
  로깅할 때는 `mask_url()`로 `serviceKey`를 가린다.
- **`numOfRows`는 50이 상한**(실측 확정 — 초과 시 `resultCode 930`). 상수 1곳(`MAX_NUM_OF_ROWS`)
  으로 고정하고, 930은 사용자 안내가 아니라 **구현 버그 신호**로 취급한다(서버 경고 로그 +
  내부 50 강제).
- 원문 XML/JSON은 사용자에게 노출하지 않는다(F34 오류 구조화 원칙).
- HTTP는 반드시 registry의 `FetchClient`를 통해서만 — 2초 스로틀·SSRF·리다이렉트 검증 공유.
"""
from __future__ import annotations

import json
import logging
import re
import urllib.parse
from typing import Any, Dict, List, Optional, Tuple

from exceptions import ValidationAppError
from services import secrets_store
from services.fetchers.base import AdapterServiceError, ParseFailedError

logger = logging.getLogger(__name__)

# --- 서비스 계약 상수 -------------------------------------------------------
API_BASE = "https://apis.data.go.kr/B490007/openQst"
LIST_OPERATION = "getOpenQstList"
DETAIL_OPERATION = "getOpenQst"

#: 실측 확정(2026-07-27) — 51 이상은 resultCode 930. **여기 한 곳에서만 정한다.**
MAX_NUM_OF_ROWS = 50
#: 국가기술자격만 사용(과정평가형 C·일학습병행 W는 범위 밖 — stage-14 "하지 않는 것").
QUALGB_CD = "T"
#: 전 목록 순회 안전 상한(실측 7페이지 = 304건). 스펙 변경으로 totalCount가 튀어도 폭주 금지.
MAX_PAGES = 40

API_HOST = "apis.data.go.kr"
FILE_HOST = "openapi.hrdkorea.or.kr"
#: SSRF 허용 목록(S14) — 오픈API 호스트와 첨부 파일 호스트뿐이다.
ALLOWED_HOSTS = frozenset({API_HOST, FILE_HOST})

SERVICE_KEY_NAME = "qnet_service_key"

_MASK_RE = re.compile(r"(serviceKey=)[^&]*", re.I)


def mask_url(url: str) -> str:
    """로깅용 — serviceKey 값을 가린다(원문 로깅 금지)."""
    return _MASK_RE.sub(r"\1***", url or "")


# ---------------------------------------------------------------------------
# 서비스키 (루트 secrets.json — DB/settings 금지, write-only)
# ---------------------------------------------------------------------------
_PCT_ESCAPE_RE = re.compile(r"%[0-9A-Fa-f]{2}")


def normalize_key(key: str) -> str:
    """공공데이터포털은 같은 키를 **Encoding/Decoding 두 형태**로 보여준다 — 사용자가 어느
    쪽을 붙여 넣어도 동작하도록 퍼센트 인코딩된 키는 디코드해 둔다(요청 조립 시 다시
    인코딩되므로 이중 인코딩 = 401을 막는다). 디코딩 키(base64 계열)에는 `%`가 없어 안전."""
    key = (key or "").strip()
    if _PCT_ESCAPE_RE.search(key):
        return urllib.parse.unquote(key)
    return key


def get_service_key() -> Optional[str]:
    key = secrets_store.get_secret(SERVICE_KEY_NAME)
    return normalize_key(key) if key else None


def service_key_status() -> Dict[str, Any]:
    """`{key_registered, key_suffix}` — 원문 키 미포함. 읽기 경로는 `get_service_key` 하나."""
    key = get_service_key()
    return {"key_registered": key is not None, "key_suffix": secrets_store.key_suffix(key)}


def save_service_key(key: str) -> Optional[str]:
    """즉석 검증(getOpenQstList numOfRows=1) 성공 시에만 병합 저장. 반환은 suffix뿐.

    `normalize_key()`를 먼저 적용해 **정규화(디코딩) 키를 저장·검증·suffix 산출에
    일관되게** 쓴다 — 원문(Encoding 형) 기준으로 저장하면 `service_key_status()`(항상
    `get_service_key()`의 정규화 결과 기준)와 suffix가 달라진다(결함 4). 기존 등록 키는
    이미 디코딩 형이라 영향 없다."""
    key = normalize_key(key)
    validate_service_key(key)
    secrets_store.set_secret(SERVICE_KEY_NAME, key)
    _reset_caches()
    return secrets_store.key_suffix(key)


def delete_service_key() -> None:
    secrets_store.delete_secret(SERVICE_KEY_NAME)
    _reset_caches()


def _reset_caches() -> None:
    """키가 바뀌면 이전 키로 모은 목록 캐시는 버린다 — 삭제 직후 '스텁과 동일 동작'
    (빈 목록)이 되어야 하고, 재등록 시에는 새 키로 다시 수집해야 한다."""
    from services.fetchers import registry  # 지연 import(순환 방지)

    registry.cache_clear()


def validate_service_key(key: str) -> None:
    """등록 전 즉석 검증 — 실패 사유는 사람 말로, 원문 응답은 노출하지 않는다."""
    key = (key or "").strip()
    if not key:
        raise ValidationAppError("서비스키를 입력하세요")
    from services.fetchers import registry  # 지연 import(순환 방지)

    client = registry.new_client()
    try:
        _request(
            client,
            LIST_OPERATION,
            {"numOfRows": 1, "pageNo": 1, "qualgbCd": QUALGB_CD},
            service_key=key,
        )
    except AdapterServiceError as exc:
        raise ValidationAppError(exc.public_message, detail={"reason": exc.kind}) from exc
    except ParseFailedError as exc:
        raise ValidationAppError(
            "공공데이터포털에 연결하지 못했습니다 — 잠시 후 다시 시도하세요",
            detail={"reason": "unreachable"},
        ) from exc


# ---------------------------------------------------------------------------
# 오류 코드 → 사람 말 (원문 XML/JSON 노출 금지)
# ---------------------------------------------------------------------------
#: code → (kind, message, action)
_ERROR_MAP: Dict[str, Tuple[str, str, str]] = {
    "22": (
        "quota",
        "오늘 큐넷 오픈API 호출 한도를 모두 사용했습니다",
        "내일 다시 시도하거나, 그동안은 [파일로 반입]·[URL로 반입]을 이용하세요.",
    ),
    "30": (
        "key",
        "등록된 큐넷 서비스키가 올바르지 않습니다",
        "설정 > 데이터 > 큐넷 오픈API에서 서비스키를 다시 등록하세요.",
    ),
    "31": (
        "key",
        "큐넷 서비스키의 활용 기간이 만료되었습니다",
        "공공데이터포털에서 활용 기간을 연장한 뒤 설정 > 데이터에서 다시 등록하세요.",
    ),
    "941": (
        "token",
        "첨부 파일 다운로드 주소가 만료되었습니다(유효 1시간)",
        "반입을 다시 실행하세요.",
    ),
}

#: 구현 버그 신호 — 사용자 안내 대상이 아니다(서버 경고 로그 + 내부 50 강제).
BUG_SIGNAL_CODE = "930"

_GENERIC_ERROR = (
    "other",
    "큐넷 오픈API가 요청을 처리하지 못했습니다",
    "잠시 후 다시 시도하고, 계속되면 [파일로 반입]·[URL로 반입]을 이용하세요.",
)


def _raise_for_code(code: str, *, context: str) -> None:
    """resultCode를 사람 말 오류로 올린다. 성공 코드('00')는 호출부가 걸러 온다."""
    if code == BUG_SIGNAL_CODE:
        # 930 = "한 페이지당 조회 가능한 최대 목록 수는 50개를 넘을 수 없습니다" —
        # 사용자가 고칠 수 있는 게 없다. 페이지 크기 상수가 깨졌다는 뜻이므로 경고 로그.
        logger.warning(
            "qnet 오픈API 930(페이지 크기 초과) — numOfRows는 %s를 넘을 수 없다(구현 버그 신호, %s)",
            MAX_NUM_OF_ROWS,
            context,
        )
    kind, message, action = _ERROR_MAP.get(code, _GENERIC_ERROR)
    raise AdapterServiceError(
        message,
        kind=kind,
        action=action,
        alternatives=["file_import", "url_import"],
        detail={"result_code": code},
    )


_XML_CODE_RE = re.compile(
    r"<(?:resultCode|returnReasonCode|errMsg)>\s*([^<]+?)\s*</(?:resultCode|returnReasonCode|errMsg)>",
    re.I,
)


def _parse_payload(text: str, *, context: str) -> Dict[str, Any]:
    """JSON 응답을 dict로. 게이트웨이 오류는 JSON이 아니라 XML로 오는 경우가 있어
    코드만 추출해 사람 말로 바꾼다(원문은 로그에만)."""
    try:
        data = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        match = _XML_CODE_RE.search(text or "")
        code = (match.group(1) if match else "").strip()
        logger.info("qnet 오픈API 비JSON 응답(%s) code=%s", context, code or "?")
        if code.isdigit():
            _raise_for_code(code.lstrip("0") or code, context=context)
        raise ParseFailedError(
            "공개문제 응답 구조가 변경되었을 수 있습니다",
            alternatives=["url_import"],
            detail={"operation": context},
        )
    if not isinstance(data, dict):
        raise ParseFailedError(
            "공개문제 응답 구조가 변경되었을 수 있습니다",
            alternatives=["url_import"],
            detail={"operation": context},
        )
    return data


def _request(
    client,
    operation: str,
    params: Dict[str, Any],
    *,
    service_key: Optional[str] = None,
) -> Dict[str, Any]:
    """오픈API 1회 호출 → body(dict). 실패는 AdapterServiceError/ParseFailedError."""
    key = normalize_key(service_key) if service_key is not None else get_service_key()
    if not key:
        raise AdapterServiceError(
            "큐넷 오픈API 서비스키가 등록되어 있지 않습니다",
            kind="no_key",
            action="설정 > 데이터 > 큐넷 오픈API에서 공공데이터포털 서비스키를 등록하세요.",
            alternatives=["file_import", "url_import"],
        )
    num_rows = params.get("numOfRows")
    if num_rows is not None and int(num_rows) > MAX_NUM_OF_ROWS:
        # 방어선 — 상수를 우회한 호출이 930을 유발하지 못하게 내부에서 강제한다.
        logger.warning(
            "qnet numOfRows=%s 요청을 %s로 강제(930 방지 — 구현 버그 신호)", num_rows, MAX_NUM_OF_ROWS
        )
        params = dict(params, numOfRows=MAX_NUM_OF_ROWS)

    query = dict(params)
    query["dataFormat"] = "JSON"
    # serviceKey는 마지막에 붙인다(로깅 마스킹 정규식과 순서 무관하지만 가독성 목적).
    url = f"{API_BASE}/{operation}?" + urllib.parse.urlencode(
        {**query, "serviceKey": key}, quote_via=urllib.parse.quote, safe=""
    )
    logger.debug("qnet 오픈API 호출: %s", mask_url(url))

    try:
        text = client.get_text(url)
    except ParseFailedError as exc:
        # 게이트웨이는 키 오류를 본문(resultCode)이 아니라 **HTTP 401**로 돌려주기도 한다
        # (실측: 잘못된 serviceKey → 401 "Unauthorized" text/plain). 또한 원 예외의 detail에는
        # **키가 들어 있는 요청 URL**이 담겨 있으므로 여기서 반드시 걷어낸다(write-only).
        http_code = exc.detail.get("http_code") if isinstance(exc.detail, dict) else None
        if http_code in (401, 403):
            raise AdapterServiceError(
                "큐넷 서비스키가 올바르지 않거나 이 서비스에 대한 활용 승인이 없습니다",
                kind="key",
                action="공공데이터포털에서 '국가자격 공개문제 조회 서비스' 활용신청 승인 여부를 확인하고, "
                "설정 > 데이터 > 큐넷 오픈API에서 서비스키를 다시 등록하세요.",
                detail={"http_code": http_code},
            ) from exc
        if http_code == 429:
            kind, message, action = _ERROR_MAP["22"]
            raise AdapterServiceError(
                message, kind=kind, action=action, detail={"http_code": http_code}
            ) from exc
        raise ParseFailedError(
            "큐넷 오픈API에 연결하지 못했습니다",
            alternatives=["url_import"],
            detail={"operation": operation, "http_code": http_code},
        ) from exc
    data = _parse_payload(text, context=operation)
    header = data.get("header") if isinstance(data.get("header"), dict) else {}
    code = str(header.get("resultCode") or "").strip()
    if code and code != "00":
        _raise_for_code(code, context=operation)
    body = data.get("body")
    if not isinstance(body, dict):
        raise ParseFailedError(
            "공개문제 응답 구조가 변경되었을 수 있습니다",
            alternatives=["url_import"],
            detail={"operation": operation},
        )
    return body


# ---------------------------------------------------------------------------
# 목록 / 상세
# ---------------------------------------------------------------------------
def fetch_list_page(client, page_no: int, *, jm_nm: Optional[str] = None) -> Dict[str, Any]:
    """공개문제 목록 1페이지 — `numOfRows`는 항상 MAX_NUM_OF_ROWS(50) 고정."""
    params: Dict[str, Any] = {
        "numOfRows": MAX_NUM_OF_ROWS,
        "pageNo": page_no,
        "qualgbCd": QUALGB_CD,
    }
    if jm_nm:
        params["jmNm"] = jm_nm
    return _request(client, LIST_OPERATION, params)


def fetch_all_list_items(client) -> List[Dict[str, Any]]:
    """`totalCount`까지 페이지 순회로 전 목록 수집(실측 7페이지·304건).

    호출 횟수를 줄이려고 페이지 크기를 키우면 930이 난다 — 50 고정이 계약이다."""
    items: List[Dict[str, Any]] = []
    page = 1
    total = None
    while page <= MAX_PAGES:
        body = fetch_list_page(client, page)
        page_items = body.get("items")
        if isinstance(page_items, dict):  # 단건일 때 dict로 오는 방어(공공API 관례)
            page_items = [page_items]
        if not isinstance(page_items, list):
            page_items = []
        items.extend(x for x in page_items if isinstance(x, dict))
        if total is None:
            try:
                total = int(body.get("totalCount") or 0)
            except (TypeError, ValueError):
                total = 0
        if not page_items or len(items) >= (total or 0):
            break
        page += 1
    logger.info("qnet 공개문제 목록 수집 완료 — %s건(%s페이지, numOfRows=%s)", len(items), page, MAX_NUM_OF_ROWS)
    return items


def fetch_detail(client, artl_seq: str, qualgb_cd: str = QUALGB_CD) -> Dict[str, Any]:
    """게시물 상세 — `fileList[].fileUrl`은 **JWT 유효 1시간**이므로 캐시·저장 금지.
    호출 직후 같은 잡에서 즉시 다운로드해야 한다(설계 §4.13 S14)."""
    return _request(
        client,
        DETAIL_OPERATION,
        {"artlSeq": artl_seq, "qualgbCd": qualgb_cd or QUALGB_CD},
    )


def assert_allowed_host(url: str) -> None:
    """SSRF 허용 목록(S14) — 오픈API·첨부 파일 호스트 외의 주소는 내려받지 않는다.
    사설/루프백 차단·리다이렉트 hop 재검증·50MB 상한은 registry가 그대로 적용한다."""
    host = (urllib.parse.urlparse(url or "").hostname or "").lower()
    if host not in ALLOWED_HOSTS:
        raise ParseFailedError(
            "허용되지 않은 주소의 첨부는 내려받지 않습니다",
            alternatives=["url_import"],
            detail={"host": host or None},
        )
