"""전자문제집 CBT(comcbt.com) 어댑터 (F35-2, 설계 §4.13).

**실측 결과(2026-07-25, 요청 간격 2초 준수)**
- robots.txt: `User-agent: * / Allow: /` — 전 경로 수집 허용.
- 자격증 검색: 홈페이지에 730여 종목이 `<a href='//www.comcbt.com/xe/{mid}'>{name}</a>`
  (작은따옴표) 형태로 나열 — {mid}(2~3자)가 게시판 식별자(cert_ref).
- 회차 목록: 게시판 `/xe/{mid}` 페이지가 회차를 글(`/xe/{mid}/{srl}`)로 나열,
  제목이 "…YYYY년 MM월 DD일(N회)…" — 여기서 `YYYY-N` 키를 뽑는다.
- **문항 본문은 정적 HTML에 없다.** 실제 풀이는 인터랙티브 CBT 웹앱(`cbt/index2.php`,
  JS/세션 기반)에서 이뤄지고, 글에는 **회차별 PDF 첨부(학생용/교사용/해설집)**가 로그인
  없이 내려받히도록 걸려 있다. 따라서 `fetch_exam`은 **PDF 첨부를 내려받아 원본 파일로
  반환**(FetchedFile)하고 convert(LLM)가 구조를 추출한다 — 추측 셀렉터로 JS 앱을
  역설계하지 않는다(설계 §4.13 "실측 어려우면 parse_failed 경로에 집중" 원칙).

DOM 의존 상수는 이 모듈 상단에 모아 두었다 — 사이트 구조 변경 시 여기만 고친다.
"""
from __future__ import annotations

import html
import re
from typing import List, Optional, Tuple

from services.fetchers import registry
from services.fetchers.base import (
    ActivityCallback,
    Adapter,
    CertRef,
    ExamEntry,
    FetchedFile,
    FetchResult,
    ParseFailedError,
)

# --- DOM/URL 셀렉터 상수 (실측 기준 — 변경 시 이 블록만 수정) ---------------
BASE_URL = "https://www.comcbt.com"
HOME_URL = BASE_URL + "/"
BOARD_URL = BASE_URL + "/xe/{mid}"
EXAM_URL = BASE_URL + "/xe/{mid}/{srl}"

# 홈페이지 자격증 링크: <a href='//www.comcbt.com/xe/iz' ...>정보처리기사</a>
CERT_LINK_RE = re.compile(
    r"href='(?://www\.comcbt\.com)?/xe/([a-z0-9]{2,3})'[^>]*>([^<]+)</a>"
)
# 게시판 회차 글 링크: <a href="https://www.comcbt.com/xe/iz/5851061">...2022년 04월 24일(2회)...</a>
EXAM_LINK_RE = re.compile(
    r'href="(?:https://www\.comcbt\.com)?/xe/([a-z0-9]{2,3})/(\d+)"[^>]*>(.*?)</a>',
    re.DOTALL,
)
# 첨부 파일 다운로드 링크: <a href="...module=file...procFileDownload...">파일명</a>
ATTACH_RE = re.compile(
    r'href="([^"]*module=file[^"]*procFileDownload[^"]*)"[^>]*>([^<]*)'
)
# 회차 키: "2022년 04월 24일(2회)" → year=2022, round=2
YEAR_RE = re.compile(r"(20\d{2})\s*년")
# 회차는 괄호 안에서만 인정한다(공지 제목의 "1회 이후 안내" 등 오탐 방지).
# "(2회)" → 2, "(1, 2회 통합)" → 1(첫 번호 채택).
ROUND_RE = re.compile(r"\(\s*(\d+)(?:\s*,\s*\d+)*\s*회")
# 시험 날짜(S12 — 병합 자연 키): "2022년 04월 24일" → exam_date '2022-04-24'.
DATE_RE = re.compile(r"(20\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일")

# 첨부 선호 순위: 해설집(정답·해설 포함) > 학생용(문제) > 교사용 > 기타
_ATTACH_PREF = ["해설집", "학생용", "교사용"]


def _strip_tags(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", text)).strip()


def _normalize(name: str) -> str:
    return re.sub(r"\s+", "", name).lower()


def _parse_exam_key(title: str) -> Optional[str]:
    year_m = YEAR_RE.search(title)
    round_m = ROUND_RE.search(title)
    if not year_m or not round_m:
        return None
    return f"{year_m.group(1)}-{round_m.group(1)}"


def _parse_exam_date(title: str) -> Optional[str]:
    """"2022년 04월 24일" → '2022-04-24'(S12 — 회차 번호 제공자 역할, 병합 자연 키)."""
    m = DATE_RE.search(title)
    if not m:
        return None
    year, month, day = m.groups()
    return f"{year}-{int(month):02d}-{int(day):02d}"


class ComcbtAdapter(Adapter):
    id = "comcbt"
    name = "전자문제집 CBT (comcbt.com)"
    priority = 3  # qnet=1, cbtbank=2 다음(S12 갱신 — PDF 전체 재구조화라 구조화 추출보다 아래)
    notice = "개인 학습 전용 · 수집물 재배포 금지 — comcbt.com 기출 자료"
    base_url = BASE_URL

    # -- 자격증 이름 ↔ 게시판 mid 맵 (홈 1회 크롤 → 24h 캐시) -----------------
    def _cert_map(self, client: registry.FetchClient) -> List[CertRef]:
        cached = registry.cache_get("comcbt:certmap")
        if cached is not None:
            return cached
        body = client.get_text(HOME_URL)
        seen = set()
        certs: List[CertRef] = []
        for mid, name in CERT_LINK_RE.findall(body):
            name = html.unescape(name).strip()
            if not name or not re.search(r"[가-힣A-Za-z]", name):
                continue
            key = (mid, name)
            if key in seen:
                continue
            seen.add(key)
            certs.append(CertRef(name=name, cert_ref=mid))
        registry.cache_set("comcbt:certmap", certs)
        return certs

    def _cert_name(self, client: registry.FetchClient, mid: str) -> Optional[str]:
        for cert in self._cert_map(client):
            if cert.cert_ref == mid:
                return cert.name
        return None

    # -- 인터페이스 ---------------------------------------------------------
    def is_available(self, client: registry.FetchClient) -> Tuple[bool, Optional[str]]:
        try:
            if not client.can_fetch(HOME_URL):
                return False, "robots.txt가 수집을 허용하지 않습니다 — URL 반입을 이용하세요"
        except Exception:  # noqa: BLE001 - 진단 실패는 사용 불가로 취급
            return False, "접속 상태를 확인할 수 없습니다"
        return True, None

    def search_certs(self, query: str, client: registry.FetchClient) -> List[CertRef]:
        q = _normalize(query)
        certs = self._cert_map(client)
        if not q:
            return certs[:50]
        return [c for c in certs if q in _normalize(c.name)]

    def list_exams(self, cert_ref: str, client: registry.FetchClient) -> List[ExamEntry]:
        if not re.fullmatch(r"[a-z0-9]{2,3}", cert_ref or ""):
            raise ParseFailedError("올바르지 않은 자격증 참조입니다", detail={"cert_ref": cert_ref})
        cert_name = self._cert_name(client, cert_ref) or cert_ref
        body = client.get_text(BOARD_URL.format(mid=cert_ref))
        entries: List[ExamEntry] = []
        seen_keys = set()
        for mid, srl, raw_title in EXAM_LINK_RE.findall(body):
            if mid != cert_ref:
                continue
            title = _strip_tags(html.unescape(raw_title))
            exam_key = _parse_exam_key(title)
            if exam_key is None or exam_key in seen_keys:
                continue
            seen_keys.add(exam_key)
            level = "실기" if "실기" in title else "필기"
            entries.append(
                ExamEntry(
                    exam_key=exam_key,
                    label=title,
                    exam_ref=srl,
                    cert_name=cert_name,
                    level_hint=level,
                    question_count=None,  # 목록에 문항 수 없음 → estimate가 60 가정
                    source_url=EXAM_URL.format(mid=cert_ref, srl=srl),
                    exam_date=_parse_exam_date(title),  # S12 — 회차 번호 제공자 역할
                )
            )
        # 최신 회차 우선(게시판 정렬은 대체로 최신순이나 exam_key 내림차순으로 안정화)
        entries.sort(key=lambda e: e.exam_key, reverse=True)
        return entries

    def _pick_attachment(self, attachments: List[Tuple[str, str]]) -> Optional[Tuple[str, str]]:
        """(url, name) 목록에서 PDF 우선·선호도(해설집>학생용>교사용) 순으로 하나 고른다."""
        def score(name: str) -> tuple:
            n = name.lower()
            is_pdf = n.endswith(".pdf")
            pref = next((len(_ATTACH_PREF) - i for i, k in enumerate(_ATTACH_PREF) if k in name), 0)
            return (1 if is_pdf else 0, pref)

        pdfs = [a for a in attachments if a[1].lower().endswith((".pdf", ".hwp"))]
        if not pdfs:
            return None
        pdfs.sort(key=lambda a: score(a[1]), reverse=True)
        return pdfs[0]

    def fetch_exam(
        self,
        cert_ref: str,
        exam_ref: str,
        client: registry.FetchClient,
        on_activity: ActivityCallback = None,
    ) -> FetchResult:
        if not re.fullmatch(r"\d+", exam_ref or ""):
            raise ParseFailedError("올바르지 않은 회차 참조입니다", detail={"exam_ref": exam_ref})
        cert_name = self._cert_name(client, cert_ref) or cert_ref
        exam_url = EXAM_URL.format(mid=cert_ref, srl=exam_ref)
        body = client.get_text(exam_url)

        title = ""
        m = re.search(r"<title>(.*?)</title>", body, re.DOTALL)
        if m:
            title = _strip_tags(html.unescape(m.group(1)))
        exam_key = _parse_exam_key(title) or "unknown"
        level = "실기" if "실기" in title else "필기"

        attachments = [
            (html.unescape(url).replace("&amp;", "&"), html.unescape(name).strip())
            for url, name in ATTACH_RE.findall(body)
        ]
        picked = self._pick_attachment(attachments)
        if picked is None:
            # 정적 HTML엔 문항이 없고 첨부도 없으면 수집 불가 — 대안 안내(설계 §4.13 parse_failed)
            raise ParseFailedError(
                "이 회차에서 내려받을 수 있는 기출 파일을 찾지 못했습니다",
                alternatives=["url_import", "other_adapter"],
                detail={"exam_ref": exam_ref},
            )
        file_url, file_name = picked
        # XE procFileDownload는 302로 파일 서버(img.comcbt.com)에 넘긴다(Location에
        # 한글 파일명 — registry가 인코딩 복원). Referer는 게시판형 사이트의
        # 직접 요청 차단 정책 대비 방어적으로 함께 보낸다.
        data, ctype, disp_name = client.get_bytes(file_url, referer=exam_url)
        filename = disp_name or file_name or f"comcbt_{cert_ref}_{exam_ref}.pdf"
        # 매직 바이트로 PDF 확인 — 확장자는 믿지 않는다(.pdf 이름으로 HTML 오류
        # 페이지가 오는 경우가 실측됨. 확장자만 보면 그대로 LLM에 들어간다).
        if data[:5] != b"%PDF-":
            if filename.lower().endswith(".hwp"):
                # HWP 등 LLM이 직접 못 읽는 형식이면 파싱 실패로 안내
                raise ParseFailedError(
                    "이 회차는 PDF 기출 파일이 제공되지 않습니다(HWP 등)",
                    alternatives=["url_import", "other_adapter"],
                    detail={"filename": filename},
                )
            raise ParseFailedError(
                "기출 파일 대신 사이트 안내 페이지가 응답되었습니다",
                alternatives=["url_import", "other_adapter"],
                detail={"filename": filename, "content_type": ctype},
            )
        return FetchedFile(
            filename=filename,
            data=data,
            content_type=ctype or "application/pdf",
            cert_name=cert_name,
            exam_key=exam_key,
            exam_label=title,
            level_hint=level,
            source_url=exam_url,
            note=f"comcbt · {exam_url}",
        )
