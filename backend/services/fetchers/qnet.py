"""큐넷 공개문제 어댑터 — 공공데이터포털 공식 오픈API (F35-3, 설계 §4.13 S14).

S10~S13에서는 목록 스텁(`available:false`)이었다. Q-Net 웹 포털이 JS 렌더라 정적 실측이
불가능했기 때문인데(R14), 같은 데이터를 **공식 계약**으로 주는 오픈API("국가자격 공개문제
조회 서비스")를 쓰면 역설계 없이 목록·상세를 채울 수 있다. 저수준 호출·서비스키·오류
매핑은 `services/qnet_api.py`가 담당하고, 이 모듈은 도메인 로직만 갖는다.

**실측 확정 사항(2026-07-27 — 계획서 §14 F35-3이 단일 출처. 추측으로 뒤집지 말 것)**
1. `numOfRows` 최대 **50**(초과 시 930) — 전 목록 304건 = 7페이지.
2. 계열 분포: 기능사 151 · 기사/산업기사 87 · **메타 빈값 43** · 기능장 18 · 기타 5.
3. **메타 빈값 43건(14%)** — `qualgbCd/seriesCd/jmCd/jmNm`이 전부 빈 문자열인 게시물이 있다.
   → 종목 버킷을 만들지 않되(가짜 자격증 금지) **제목 검색으로는 노출**한다.
4. 첨부 포맷: PDF 14 · **ZIP 4** · HWP 0 — 실제 비대응 포맷은 ZIP(도면·과제 묶음)이다.
5. 커버리지: `jmNm=품질경영기사` → totalCount 0. **필기·필답형은 구조적으로 범위 밖.**
6. 제목 형식 불규칙 + **안내문 게시물 혼입** — 표본 5종은 tests/test_qnet_adapter.py에 고정.

**쿼터 절약 구조**: 전 목록을 24h 메모리 캐시에 **원시 1벌**만 두고 `search_certs`·
`list_exams`가 같은 캐시에서 파생한다(일 1,000건 한도·데이터 갱신 월 1회).
"""
from __future__ import annotations

import logging
import re
import threading
from typing import Any, Dict, List, Optional, Tuple

from services import qnet_api
from services.fetchers import registry
from services.fetchers.base import (
    ActivityCallback,
    Adapter,
    AdapterServiceError,
    CertRef,
    ExamEntry,
    FetchedFile,
    FetchResult,
    ParseFailedError,
    UnsupportedFormatError,
)

logger = logging.getLogger(__name__)

BASE_URL = "https://www.q-net.or.kr"

#: 전 목록 원시 캐시 키(24h) — search_certs·list_exams가 이 1벌에서 파생한다.
LIST_CACHE_KEY = "qnet:openqst:list"
_COLLECT_LOCK = threading.Lock()

#: 제목 검색 폴백용 cert_ref 접두어(종목 코드는 숫자라 충돌하지 않는다).
TITLE_REF_PREFIX = "title:"

NOTICE_TEXT = (
    "개인 학습 전용 · 수집물 재배포 금지 — 큐넷 공개문제(공공데이터포털 오픈API). "
    "수록 대상은 실기 작업형·도면 공개문제 위주입니다 — 필기·필답형 기출(예: 품질경영기사)은 "
    "여기에 없으니 [파일로 반입]·[URL로 반입]을 이용하세요."
)
KEY_REQUIRED_NOTICE = (
    "공공데이터포털 서비스키 등록 필요 — 설정 > 데이터 > 큐넷 오픈API에서 등록하세요. "
    "등록 전에는 [파일로 반입]·[URL로 반입]을 이용할 수 있습니다."
)


# ---------------------------------------------------------------------------
# 정규화 — 빈 문자열과 None을 **한 곳에서** 같게 다룬다(실측 3 방어의 단일 지점).
# 산발적인 `if not x` 분기를 만들지 말 것.
# ---------------------------------------------------------------------------
def clean(value: Any) -> Optional[str]:
    """빈 문자열·공백뿐인 값·None을 전부 None으로 정규화한다."""
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _norm(text: Optional[str]) -> str:
    """검색 비교용 정규화 — 공백 제거 + 소문자."""
    return "".join((text or "").split()).lower()


def normalize_item(raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """오픈API 목록 항목 → 내부 표현. artlSeq·title이 없으면 항목 자체를 버린다."""
    artl_seq = clean(raw.get("artlSeq"))
    title = clean(raw.get("title"))
    if not artl_seq or not title:
        return None
    return {
        "artl_seq": artl_seq,
        "title": title,
        "jm_cd": clean(raw.get("jmCd")),
        "jm_nm": clean(raw.get("jmNm")),
        "qualgb_cd": clean(raw.get("qualgbCd")),
        "series_nm": clean(raw.get("seriesNm")),
        "reg_dttm": clean(raw.get("regDttm")),
        "mod_dttm": clean(raw.get("modDttm")),
    }


# ---------------------------------------------------------------------------
# 제목 파싱 (실측 6 — 표본 밖 형식을 추측하지 않는다)
# ---------------------------------------------------------------------------
_PREFIX_RE = re.compile(r"^\s*\[?\s*(공개문제|문제공개)\s*\]?\s*")
_DATE_IN_PAREN_RE = re.compile(r"\((\d{4})(\d{2})(\d{2})\)")
_YEAR_IN_PAREN_RE = re.compile(r"\((\d{4})\s*년도?\)")
#: 안내문 판정 낱말 — 제목 텍스트만 사용한다(상세 조회는 쿼터 소모).
NOTICE_WORDS = ("안내", "집행", "관련")


def has_open_question_prefix(title: str) -> bool:
    """`[공개문제]`·`[문제공개]`(대괄호·공백 유무 무관) 접두어 보유 여부."""
    return bool(_PREFIX_RE.match(title or ""))


def strip_prefix(title: str) -> str:
    return _PREFIX_RE.sub("", title or "").strip()


def is_notice_post(title: str) -> bool:
    """공개문제가 아닌 **안내·집행 공지** 판정 — 제목 텍스트만으로.

    규칙(지시서 2절): 공개문제/문제공개 접두어가 **없고** 제목에 안내·집행·관련이 있으면
    안내문으로 본다. 접두어가 있는 게시물은 판정 대상이 아니다(과잉 숨김 방지 — 숨김은
    삭제가 아니지만 기본 목록에서 빠지므로 보수적으로 좁게 잡는다)."""
    text = title or ""
    if has_open_question_prefix(text):
        return False
    return any(word in text for word in NOTICE_WORDS)


def parse_title(title: str, artl_seq: str) -> Tuple[str, str, Optional[str]]:
    """제목 → `(exam_key, kind, exam_date)`.

    - `(YYYYMMDD)` → `('YYYY-MM-DD', 'date', 'YYYY-MM-DD')` — 폴더명 파생 가능.
    - `(YYYY년도)` → `('YYYY', 'year', None)` — **회차 미상. 회차 키를 지어내지 않는다**
      (`exam_folder_name('YYYY')`는 None이라 분류 경로가 자동 생성되지 않는다).
    - 그 외 → `('qnet-{artlSeq}', 'unknown', None)` — 라벨 그대로 단독 항목.
    """
    body = strip_prefix(title)
    match = _DATE_IN_PAREN_RE.search(body)
    if match:
        year, month, day = match.groups()
        if 1 <= int(month) <= 12 and 1 <= int(day) <= 31:
            key = f"{year}-{month}-{day}"
            return key, "date", key
    match = _YEAR_IN_PAREN_RE.search(body)
    if match:
        return match.group(1), "year", None
    return f"qnet-{artl_seq}", "unknown", None


# ---------------------------------------------------------------------------
# 첨부 포맷
# ---------------------------------------------------------------------------
_EXT_RE = re.compile(r"\.([A-Za-z0-9]{1,6})\s*$")
#: 매직 바이트 — 파일 대신 HTML 안내/오류 페이지를 받는 사고를 잡는다(S12 교훈).
_MAGIC = {"pdf": b"%PDF", "zip": b"PK\x03\x04"}


def file_ext(filename: Optional[str]) -> Optional[str]:
    match = _EXT_RE.search(filename or "")
    return match.group(1).lower() if match else None


def _magic_ok(ext: Optional[str], data: bytes) -> bool:
    magic = _MAGIC.get(ext or "")
    if magic is None:
        return True
    return data.startswith(magic)


def _unsupported_message(exts: List[str], saved: List[str]) -> Tuple[str, str]:
    """포맷별 문구 분기(실측 4 — 실제 비대응 포맷은 ZIP).

    `saved`는 sources/에 실제로 저장된 첨부 파일명 목록이다 — 다운로드된 첨부는 확장자
    인식 여부와 무관하게 전부 저장되므로 `attachments`와 1:1이라, **"첨부가 실제로
    있었는가"의 근거는 `exts`가 아니라 `saved`다**. `exts`는 인식된 확장자만 모으므로
    확장자를 못 읽은 첨부가 있으면 `exts`가 비어도 `saved`는 채워진다 — 이 둘을
    `exts`만으로 구분하면 "첨부 없음"으로 오안내된다(결함 2)."""
    if not saved:
        return (
            "이 게시물에는 첨부 파일이 없습니다",
            "게시물 본문만 있는 안내글일 수 있습니다 — [파일로 반입]·[URL로 반입]을 이용하세요.",
        )
    saved_note = "원본은 sources/에 저장했습니다."
    if "zip" in exts:
        return (
            "첨부가 도면·과제 파일 묶음(ZIP)이라 자동 변환할 수 없습니다",
            f"{saved_note} 압축을 풀어 PDF·이미지를 [파일로 반입]하세요.",
        )
    if "hwp" in exts or "hwpx" in exts:
        return (
            "첨부가 한글(HWP) 문서라 자동 변환할 수 없습니다",
            f"{saved_note} 한글에서 PDF로 변환한 뒤 [파일로 반입]하세요.",
        )
    if not exts:
        return (
            "첨부가 있지만 확장자를 알 수 없어 자동 변환할 수 없습니다",
            f"{saved_note} 내려받은 원본을 확인해 [파일로 반입]하세요.",
        )
    return (
        "이 게시물에는 변환할 수 있는 PDF 첨부가 없습니다",
        f"{saved_note} 내려받은 원본을 확인해 [파일로 반입]으로 이어가세요.",
    )


class _TokenExpired(Exception):
    """첨부 다운로드 실패(토큰 만료 추정) — 상세 재조회 1회 재시도 신호(내부용)."""


# ---------------------------------------------------------------------------
# 어댑터
# ---------------------------------------------------------------------------
class QnetAdapter(Adapter):
    id = "qnet"
    name = "큐넷 공개문제 (공공데이터포털 오픈API)"
    priority = 1  # 단일 어댑터 — 정렬 의미만 남고 채택 경쟁은 없다(S13)
    notice = NOTICE_TEXT
    base_url = BASE_URL

    # -- 가용성 ------------------------------------------------------------
    def is_available(self, client: "registry.FetchClient") -> Tuple[bool, Optional[str]]:
        """서비스키 등록 여부만으로 판정한다 — 여기서 API를 두드리면 쿼터를 태운다."""
        if qnet_api.get_service_key() is None:
            return False, KEY_REQUIRED_NOTICE
        return True, None

    def status_extra(self) -> dict:
        return qnet_api.service_key_status()  # {key_registered, key_suffix} — 원문 키 없음

    # -- 목록 캐시(24h, 원시 1벌) ------------------------------------------
    def load_items(self, client: "registry.FetchClient") -> List[Dict[str, Any]]:
        cached = registry.cache_get(LIST_CACHE_KEY)
        if cached is not None:
            return cached
        with _COLLECT_LOCK:
            cached = registry.cache_get(LIST_CACHE_KEY)
            if cached is not None:  # 락 대기 중에 다른 요청이 채웠으면 재호출하지 않는다
                return cached
            raw_items = qnet_api.fetch_all_list_items(client)
            items = [x for x in (normalize_item(r) for r in raw_items) if x is not None]
            registry.cache_set(LIST_CACHE_KEY, items)
            return items

    # -- 자격증(종목) 검색 --------------------------------------------------
    def search_certs(self, query: str, client: "registry.FetchClient") -> List[CertRef]:
        """종목(jmCd·jmNm) 단위 집계 — cert_ref = jmCd.

        메타 빈값 항목(실측 3)은 **종목 버킷을 만들지 않는다**(가짜 자격증 금지). 대신 질의
        문자열이 title에 포함되면 제목 그대로 단독 항목으로 노출한다(조용한 실종 금지).
        결과 0건은 오류가 아니다 — 호출부가 커버리지 한계 안내로 렌더한다(실측 5)."""
        if qnet_api.get_service_key() is None:
            return []  # 키 미등록 = 기존 스텁과 동일 동작
        items = self.load_items(client)
        needle = _norm(query)

        buckets: Dict[str, str] = {}
        title_hits: Dict[str, str] = {}
        for item in items:
            jm_cd, jm_nm = item["jm_cd"], item["jm_nm"]
            if jm_cd and jm_nm:
                if not needle or needle in _norm(jm_nm):
                    buckets.setdefault(jm_cd, jm_nm)
                continue
            # 메타 빈값 — 제목 텍스트 검색으로만 노출(질의가 있을 때에 한해)
            if needle and needle in _norm(item["title"]):
                title_hits.setdefault(_norm(item["title"]), item["title"])

        out = [CertRef(name=name, cert_ref=cert_ref) for cert_ref, name in buckets.items()]
        out.extend(
            CertRef(name=title, cert_ref=f"{TITLE_REF_PREFIX}{norm}")
            for norm, title in title_hits.items()
        )
        return out

    # -- 회차(게시물) 목록 --------------------------------------------------
    def _items_for_cert(self, cert_ref: str, items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        ref = (cert_ref or "").strip()
        if ref.startswith(TITLE_REF_PREFIX):
            needle = ref[len(TITLE_REF_PREFIX) :]
            return [i for i in items if _norm(i["title"]) == needle]
        return [i for i in items if i["jm_cd"] == ref]

    def list_exams(self, cert_ref: str, client: "registry.FetchClient") -> List[ExamEntry]:
        """게시물(artlSeq) 단위 — label = title, exam_ref = artlSeq, level_hint='실기'."""
        if qnet_api.get_service_key() is None:
            return []
        items = self.load_items(client)
        entries: List[ExamEntry] = []
        for item in self._items_for_cert(cert_ref, items):
            exam_key, _kind, exam_date = parse_title(item["title"], item["artl_seq"])
            entries.append(
                ExamEntry(
                    exam_key=exam_key,
                    label=item["title"],
                    exam_ref=item["artl_seq"],
                    # 메타 빈값이면 자격증명을 지어내지 않는다 — 빈 문자열이면 분류 경로도
                    # 생성되지 않는다(convert `_fetch_category_path`가 None 반환).
                    cert_name=item["jm_nm"] or "",
                    level_hint="실기",  # 공개문제는 실기 작업형·도면
                    question_count=None,  # 목록에 문항 수 없음 → estimate가 60 가정
                    source_url=None,  # fileUrl은 1시간 토큰 — 목록·캐시에 저장 금지
                    exam_date=exam_date,
                    is_notice=is_notice_post(item["title"]),
                )
            )
        return entries

    # -- 상세 + 첨부 다운로드(같은 잡에서 즉시 연속 수행) --------------------
    def _download_attachments(
        self, client: "registry.FetchClient", detail: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        """상세 응답의 fileList를 **즉시** 내려받는다(fileUrl JWT 유효 1시간).

        토큰 만료로 **추정**하는 경우만 `_TokenExpired`로 좁힌다 — ① HTTP 401/403(게이트웨이가
        만료·무효 토큰을 이렇게 돌려준다), ② 매직 바이트 불일치(파일 대신 오류 페이지). 그 외
        (50MB 초과·빈 파일·robots 거부·SSRF 차단·네트워크 오류·다른 HTTP 상태)는 원인이 다르므로
        재시도하지 않고 원 예외의 사람 말 메시지를 보존한 `AdapterServiceError`를 즉시 올린다
        (결함 1 — 전부 "토큰 만료" 취급하면 진짜 원인이 사용자에게 영영 전달되지 않는다)."""
        file_list = detail.get("fileList")
        if isinstance(file_list, dict):
            file_list = [file_list]
        if not isinstance(file_list, list):
            file_list = []

        out: List[Dict[str, Any]] = []
        for entry in file_list:
            if not isinstance(entry, dict):
                continue
            url = clean(entry.get("fileUrl"))
            name = clean(entry.get("fileNm")) or "qnet_attachment"
            if not url:
                continue
            qnet_api.assert_allowed_host(url)  # SSRF 허용 목록(apis.data.go.kr·openapi.hrdkorea.or.kr)
            try:
                data, ctype, disp_name = client.get_bytes(url)
            except ParseFailedError as exc:
                exc_detail = exc.detail if isinstance(exc.detail, dict) else {}
                http_code = exc_detail.get("http_code")
                if http_code in (401, 403):
                    logger.info("qnet 첨부 다운로드 실패(토큰 만료 추정, http_code=%s)", http_code)
                    raise _TokenExpired() from exc
                # 원인이 다른 실패(50MB 초과·빈 파일·robots 거부·SSRF·네트워크 오류 등) —
                # 재시도하지 않고 원인을 보존해 즉시 올린다. detail에는 URL을 담지 않는다
                # (fileUrl은 JWT 토큰을 포함한다 — write-only 원칙).
                logger.info("qnet 첨부 다운로드 실패(원인 보존, http_code=%s) — %s", http_code, exc.public_message)
                raise AdapterServiceError(
                    exc.public_message,
                    kind="other",
                    action="원본 첨부를 내려받지 못했습니다 — [파일로 반입]·[URL로 반입]을 이용하세요.",
                    alternatives=["file_import", "url_import"],
                ) from exc
            ext = file_ext(name) or file_ext(disp_name)
            if not _magic_ok(ext, data):
                # .pdf인데 %PDF로 시작하지 않으면 파일이 아니라 오류/안내 페이지다.
                logger.info("qnet 첨부 매직 바이트 불일치(ext=%s) — 상세 재조회 대상", ext)
                raise _TokenExpired()
            # 파일명은 **JSON 응답의 fileNm**을 우선한다 — Content-Disposition 헤더는
            # http.client가 latin-1로 디코드해 한글이 깨진 채로 온다(S12 실측 교훈).
            out.append(
                {"filename": name or disp_name, "data": data, "content_type": ctype, "ext": ext}
            )
        return out

    def fetch_exam(
        self,
        cert_ref: str,
        exam_ref: str,
        client: "registry.FetchClient",
        on_activity: ActivityCallback = None,
    ) -> FetchResult:
        """`getOpenQst` 상세 → 첨부 즉시 다운로드 → PDF 대표 1건을 FetchedFile로.

        PDF가 없으면 `UnsupportedFormatError`(원본은 이미 sources/에 저장) — 조용한 스킵 금지."""
        from services import import_service  # 지연 import(순환 방지)

        artl_seq = (str(exam_ref or "")).strip()
        if not artl_seq.isdigit():
            raise ParseFailedError(
                "큐넷 게시물 번호가 올바르지 않습니다",
                alternatives=["url_import"],
                detail={"exam_ref": exam_ref},
            )
        if qnet_api.get_service_key() is None:
            raise AdapterServiceError(
                "큐넷 오픈API 서비스키가 등록되어 있지 않습니다",
                kind="no_key",
                action="설정 > 데이터 > 큐넷 오픈API에서 공공데이터포털 서비스키를 등록하세요.",
            )

        qualgb_cd = self._qualgb_for(artl_seq)
        detail: Dict[str, Any] = {}
        attachments: List[Dict[str, Any]] = []
        for attempt in (1, 2):
            # 상세 조회 → 다운로드를 **연속으로** 수행한다(1시간 토큰 만료 원천 회피).
            detail = qnet_api.fetch_detail(client, artl_seq, qualgb_cd)
            try:
                attachments = self._download_attachments(client, detail)
                break
            except _TokenExpired:
                if attempt == 2:
                    raise AdapterServiceError(
                        "첨부 파일 다운로드 주소가 만료되었습니다(유효 1시간)",
                        kind="token",
                        action="반입을 다시 실행하세요.",
                    )
                logger.warning("qnet 첨부 다운로드 실패 — 상세 재조회 후 1회 재시도(artlSeq=%s)", artl_seq)

        title = clean(detail.get("title")) or f"공개문제 {artl_seq}"
        cert_name = clean(detail.get("jmNm"))
        exam_key, _kind, _date = parse_title(title, artl_seq)
        note = (
            f"qnet · 국가자격 공개문제 조회 서비스 · artlSeq={artl_seq} · "
            f"{qnet_api.API_BASE}/{qnet_api.DETAIL_OPERATION}"
        )

        # 첨부 **전부** sources/에 보존한다(대표 외 도면·묶음 원본 확보 — 원본 불변: 새 파일만).
        saved: List[str] = []
        for att in attachments:
            saved.append(import_service.save_source_file(att["filename"], att["data"]))
        if saved:
            logger.info("qnet 첨부 %s건을 sources/에 보존(artlSeq=%s)", len(saved), artl_seq)

        pdfs = [a for a in attachments if a["ext"] == "pdf"]
        if not pdfs:
            exts = sorted({a["ext"] for a in attachments if a["ext"]})
            message, action = _unsupported_message(exts, saved)
            raise UnsupportedFormatError(message, action=action, saved_files=saved, formats=exts)

        representative = pdfs[0]
        extra_notes: List[str] = []
        if any(a["ext"] == "zip" for a in attachments):
            extra_notes.append("도면·과제 묶음(ZIP)도 sources/에 함께 저장했습니다.")
        others = len(attachments) - 1
        if others > 0:
            extra_notes.append(f"첨부 원본 {len(attachments)}건을 모두 sources/에 저장했습니다.")

        return FetchedFile(
            filename=representative["filename"],
            data=representative["data"],
            content_type=representative["content_type"] or "application/pdf",
            cert_name=cert_name,
            exam_key=exam_key,
            exam_label=title,
            level_hint="실기",
            source_url=None,  # 1시간 토큰 URL은 저장하지 않는다
            note=note,
            extra_notes=extra_notes,
        )

    def _qualgb_for(self, artl_seq: str) -> str:
        """상세 조회용 qualgbCd — 캐시된 목록에 있으면 그 값, 없으면 T(국가기술자격)."""
        items = registry.cache_get(LIST_CACHE_KEY) or []
        for item in items:
            if item["artl_seq"] == artl_seq:
                return item["qualgb_cd"] or qnet_api.QUALGB_CD
        return qnet_api.QUALGB_CD
