"""CBT문제은행(cbtbank.kr) 어댑터 (F35-2 3호, 설계 §4.13, S12).

**실측 결과(2026-07-26, 요청 간격 2초 준수 — `FetchClient` 경유)**
- robots.txt: `User-agent: *`에 `/exam/`·`/category/`·`/`를 **명시 Allow**(`/bbs/`·`/adm/`·
  `/data/`·`/include/` 등만 Disallow). `sitemap_index.xml`이 존재하고 `sitemap_1.xml`
  단일 사이트맵을 가리킨다 — 전 사이트 URL(약 1.7만 건)이 여기 담겨 있고, `/category/{슬러그}`
  (자격증 색인, 727건)와 `/exam/{code}`(회차 페이지, 15,767건)가 함께 나열된다.
  → **자격증 색인은 sitemap의 `/category/` 항목에서 추출**(추측 셀렉터 아님 — 실측 확정).
  슬러그는 이미 "공백→하이픈" 형태로 저장돼 있다(예: `9급-국가직-공무원-건축계획`,
  단일 단어는 하이픈 없이 `품질경영기사`).
- 자격증 페이지 `/category/{슬러그}`: 회차 링크가
  `<a href="/exam/{code}">{자격증명} (YYYY-MM-DD)</a>` 형태로 나열된다 —
  **회차 번호 표기 없음, 날짜만**(품질경영기사 실측 시 37개 회차 확인). 문항 수·필기/실기
  구분은 이 페이지에 없다(레벨은 회차 페이지에서만 확인 가능하나 이 사이트는 필기만
  다루는 것으로 실측됨 — 실기 지원은 범위 외, level_hint 기본값 '필기' 유지).
- 회차 페이지 `/exam/{code}`(예: `bp20220424`, 품질경영기사 2022-04-24 필기 — 실측 시
  100문항/5과목·23문항 이미지 포함): title/h1이 "{자격증명} {필기|실기} 기출문제(복원)
  (YYYY-MM-DD)" 형태. 문항은 `question-num="N"` 속성을 가진 블록에 순서대로 나열되고,
  각 블록 앞에 `<p class="text-center text-dark">N과목: 과목명</p>`(`.exam-class-title`)이
  나오면 그 뒤 문항들이 해당 과목에 속한다. 보기는
  `<ol class="circlednumbers" correct="N">`(N=정답 보기 번호, 1-based) 안의 `<li>` 4개.
  **AI 해설**은 문항 블록 안의 리플라이 영역에서 닉네임이 "CBT문제은행AI"인 항목의
  `reply-comment` div 텍스트(원문 그대로 사용 — 재가공하지 않는다, 비공식 해설 가능성은
  기존 LLM 검수·미리보기 승인·F30 신고로 방어). 이미지는 문제 본문 안 `<img src="/images/...">`
  (사이트 루트 기준 절대 경로 — 다운로드는 기존 `_save_fetch_images`가 담당).
- 그누보드 엔진, 기출 열람(회차 목록·문항 페이지)에 **로그인 불필요**(로그인 코드 일절
  작성 금지 — 강제 조항).

DOM/URL 상수는 이 모듈 상단에 모아 두었다 — 사이트 구조 변경 시 여기만 고친다(R14).
"""
from __future__ import annotations

import html
import re
from typing import Dict, List, Optional, Tuple

from services.fetchers import registry
from services.fetchers.base import (
    ActivityCallback,
    Adapter,
    CertRef,
    ExamEntry,
    FetchedExam,
    FetchedQuestion,
    FetchResult,
    ParseFailedError,
)

# --- DOM/URL 상수 (실측 기준 — 변경 시 이 블록만 수정) -----------------------
BASE_URL = "https://cbtbank.kr"
HOME_URL = BASE_URL + "/"
SITEMAP_INDEX_URL = BASE_URL + "/sitemap_index.xml"
CATEGORY_URL = BASE_URL + "/category/{slug}"
EXAM_URL = BASE_URL + "/exam/{code}"

# sitemap_index.xml → 개별 사이트맵 <loc> 목록
SITEMAP_LOC_RE = re.compile(r"<loc>([^<]+)</loc>")
# 개별 사이트맵의 자격증 색인: <loc>https://cbtbank.kr/category/{slug}</loc>
CATEGORY_LOC_RE = re.compile(r"<loc>https://cbtbank\.kr/category/([^<]+)</loc>")

# 자격증 페이지의 회차 링크: <a href="/exam/bp20220424">품질경영기사 (2022-04-24)</a>
EXAM_LINK_RE = re.compile(
    r'href="/exam/([a-zA-Z0-9]+)">([^<(]+)\(\s*(\d{4}-\d{2}-\d{2})\s*\)</a>'
)
# 자격증 슬러그(cert_ref) 검증 — 한글·영숫자·하이픈, 1~100자(하이픈 시작 금지).
# `_cert_map`이 만든 값만 정상 통과하지만, 요청 경로에서 임의 문자열이 그대로
# CATEGORY_URL에 꽂히므로 형식 검증으로 원치 않는 요청 조립을 막는다(경검 5).
CERT_REF_RE = re.compile(r"^[0-9A-Za-z가-힣][0-9A-Za-z가-힣\-]{0,99}$")
# 과목 구분 접두("1과목: ", "2과목 : " 등) 제거 — 순수 과목명만 남긴다(직렬화 시
# "과목: 1과목: …" 중복·태그 오염 방지, 경검 2).
SUBJECT_PREFIX_RE = re.compile(r"^\s*\d+\s*과목\s*[:：]\s*")

# 회차 페이지 파싱
TITLE_RE = re.compile(r"<title>(.*?)</title>", re.S)
SUBJECT_RE = re.compile(
    r'exam-class-title.*?<p class="text-center text-dark">(.*?)</p>', re.S
)
QSTART_RE = re.compile(r'question-num="(\d+)"')
STEM_RE = re.compile(
    r'<p class="exam-title"><span class="exam-number">\d+</span>\.(.*?)</p>', re.S
)
CHOICES_RE = re.compile(r'<ol class="circlednumbers" correct="(\d+)">(.*?)</ol>', re.S)
LI_RE = re.compile(r"<li[^>]*>(.*?)</li>", re.S)
IMG_RE = re.compile(r'<img[^>]+src="([^"]+)"')
AI_NICK = "CBT문제은행AI"
REPLY_BLOCK_RE = re.compile(
    r"nick'>" + re.escape(AI_NICK) + r".*?reply-comment'>(.*?)</div>", re.S
)


def _strip_tags(text: str) -> str:
    text = re.sub(r"<sup>(.*?)</sup>", r"^(\1)", text, flags=re.S)
    text = re.sub(r"<sub>(.*?)</sub>", r"_(\1)", text, flags=re.S)
    text = re.sub(r"<br\s*/?>", " ", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def _normalize(name: str) -> str:
    return re.sub(r"\s+", "", name).lower()


def _clean_subject(text: str) -> str:
    """'1과목: 실험계획법' → '실험계획법'(순수 과목명만 — 직렬화 접두 중복 방지)."""
    return SUBJECT_PREFIX_RE.sub("", text).strip()


def _abs_image_url(src: str) -> str:
    if src.startswith("http://") or src.startswith("https://"):
        return src
    if src.startswith("/"):
        return BASE_URL + src
    return BASE_URL + "/" + src


class CbtbankAdapter(Adapter):
    id = "cbtbank"
    name = "CBT문제은행 (cbtbank.kr)"
    priority = 2  # qnet=1 다음, comcbt=3 위(구조화 추출 품질·비용 우위 — 2026-07-26 확정)
    notice = "개인 학습 전용 · 수집물 재배포 금지 — cbtbank.kr 기출·AI 해설(비공식 가능)"
    base_url = BASE_URL

    # -- 자격증 색인(sitemap → /category/ 항목, 24h 캐시) --------------------
    def _cert_map(self, client: registry.FetchClient) -> List[CertRef]:
        cached = registry.cache_get("cbtbank:certmap")
        if cached is not None:
            return cached
        index_body = client.get_text(SITEMAP_INDEX_URL)
        sitemap_urls = SITEMAP_LOC_RE.findall(index_body)
        if not sitemap_urls:
            raise ParseFailedError("사이트맵 색인을 찾지 못했습니다", detail={"url": SITEMAP_INDEX_URL})

        seen = set()
        certs: List[CertRef] = []
        for sitemap_url in sitemap_urls:
            body = client.get_text(html.unescape(sitemap_url))
            for slug in CATEGORY_LOC_RE.findall(body):
                slug = html.unescape(slug).strip()
                if not slug or slug in seen:
                    continue
                seen.add(slug)
                name = slug.replace("-", " ").strip()
                if not name or not re.search(r"[가-힣A-Za-z0-9]", name):
                    continue
                certs.append(CertRef(name=name, cert_ref=slug))
        registry.cache_set("cbtbank:certmap", certs)
        return certs

    def _cert_name(self, client: registry.FetchClient, slug: str) -> Optional[str]:
        for cert in self._cert_map(client):
            if cert.cert_ref == slug:
                return cert.name
        return slug.replace("-", " ").strip() or None

    # -- 인터페이스 -----------------------------------------------------------
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
        if not cert_ref or not CERT_REF_RE.fullmatch(cert_ref):
            raise ParseFailedError("올바르지 않은 자격증 참조입니다", detail={"cert_ref": cert_ref})
        cert_name = self._cert_name(client, cert_ref) or cert_ref
        body = client.get_text(CATEGORY_URL.format(slug=cert_ref))
        entries: List[ExamEntry] = []
        seen = set()
        for code, _label_name, date in EXAM_LINK_RE.findall(body):
            if date in seen:
                continue
            seen.add(date)
            entries.append(
                ExamEntry(
                    exam_key=date,  # 회차 번호 미상 — 잠정 날짜형 키(S12 병합 규칙)
                    label=f"{cert_name} ({date})",
                    exam_ref=code,
                    cert_name=cert_name,
                    level_hint="필기",  # 실측: 필기만 확인, 실기 지원은 범위 외
                    question_count=None,  # 목록에 문항 수 없음 → estimate가 60 가정
                    source_url=EXAM_URL.format(code=code),
                    exam_date=date,
                )
            )
        entries.sort(key=lambda e: e.exam_key, reverse=True)
        return entries

    def fetch_exam(
        self,
        cert_ref: str,
        exam_ref: str,
        client: registry.FetchClient,
        on_activity: ActivityCallback = None,
    ) -> FetchResult:
        if not re.fullmatch(r"[a-zA-Z0-9]+", exam_ref or ""):
            raise ParseFailedError("올바르지 않은 회차 참조입니다", detail={"exam_ref": exam_ref})
        cert_name = self._cert_name(client, cert_ref) or cert_ref
        exam_url = EXAM_URL.format(code=exam_ref)
        body = client.get_text(exam_url)

        title = ""
        m = TITLE_RE.search(body)
        if m:
            title = _strip_tags(html.unescape(m.group(1)))
        level = "실기" if "실기" in title else "필기"

        date_m = re.search(r"(\d{4}-\d{2}-\d{2})", title)
        exam_date = date_m.group(1) if date_m else None
        exam_key = exam_date or "unknown"
        # <title>은 사이트 접미("- CBT문제은행")·자격증명 중복이 섞여 있어 그대로 쓰지
        # 않고 직접 구성한다(source_detail·프롬프트 헤더 유입 방지, 경검 3).
        exam_label = f"{cert_name} {exam_date or exam_ref} {level} 기출문제"

        # 과목 경계(SUBJECT_RE)와 문항 시작(QSTART_RE) 위치를 문서 순서대로 병합해
        # 각 문항이 속한 과목을 스캔한다(설계 §4.13 — subject는 태그 제안 소재).
        markers: List[Tuple[int, str, str]] = []
        for sm in SUBJECT_RE.finditer(body):
            markers.append((sm.start(), "subject", sm.group(1)))
        for qm in QSTART_RE.finditer(body):
            markers.append((qm.start(), "qstart", qm.group(1)))
        markers.sort(key=lambda t: t[0])

        cur_subject: Optional[str] = None
        q_positions: List[Tuple[int, str, Optional[str]]] = []
        for pos, kind, val in markers:
            if kind == "subject":
                cur_subject = _clean_subject(_strip_tags(val))
            else:
                q_positions.append((pos, val, cur_subject))

        if not q_positions:
            raise ParseFailedError(
                "이 회차에서 문항을 찾지 못했습니다",
                alternatives=["url_import", "other_adapter"],
                detail={"exam_ref": exam_ref},
            )

        questions: List[FetchedQuestion] = []
        for i, (pos, no_str, subject) in enumerate(q_positions):
            end = q_positions[i + 1][0] if i + 1 < len(q_positions) else len(body)
            block = body[pos:end]

            sm = STEM_RE.search(block)
            stem_raw = sm.group(1) if sm else ""
            images = [_abs_image_url(u) for u in IMG_RE.findall(stem_raw)]
            stem = _strip_tags(stem_raw)

            cm = CHOICES_RE.search(block)
            answer: Optional[str] = None
            choices: List[str] = []
            if cm:
                answer = cm.group(1)
                choices = [_strip_tags(li) for li in LI_RE.findall(cm.group(2))]

            rm = REPLY_BLOCK_RE.search(block)
            explanation = _strip_tags(rm.group(1)) if rm else None

            if not stem or len(choices) < 2:
                # 문항 단위 결함(보기 누락 등) — 회차 전체는 계속 진행, LLM/미리보기가
                # 결손 항목을 다루도록 둔다(설계 §4.13 파싱 실패 처리, 문항 단위는 관용).
                continue

            questions.append(
                FetchedQuestion(
                    no=int(no_str),
                    stem=stem,
                    choices=choices,
                    answer=answer,
                    explanation=explanation,
                    images=images,
                    subject=subject,
                )
            )

        if not questions:
            raise ParseFailedError(
                "회차 문항 구조를 해석하지 못했습니다(사이트 구조가 변경되었을 수 있습니다)",
                alternatives=["url_import", "other_adapter"],
                detail={"exam_ref": exam_ref},
            )

        return FetchedExam(
            cert_name=cert_name,
            exam_key=exam_key,
            exam_label=exam_label,
            level_hint=level,
            questions=questions,
            source_url=exam_url,
            note=f"cbtbank · {exam_url}",
        )
