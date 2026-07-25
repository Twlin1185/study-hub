"""큐넷(Q-Net) 공개자료 어댑터 (F35-2, 설계 §4.13).

**실측 결과(2026-07-25)**
- `q-net.or.kr/robots.txt`는 표준 robots가 아니라 "일부 서비스 원활하지 않음" HTML 오류
  페이지를 반환한다(부분 점검 상태). 지시자가 없어 표준상 전부 허용으로 해석된다.
- 공개문제 카탈로그(`crf005.do` 등)는 **JS 포털**이라 정적 HTML로는 목록을 얻을 수 없었다.
  Q-Net은 대다수 필기 기출을 공개하지 않으며(비공개 종목은 목록 제외 — 로그인 우회 금지),
  공개되는 실기 공개문제도 서버 렌더가 아닌 스크립트 구동이라 **셀렉터 실측 불가**.

따라서 이 어댑터는 인터페이스(우선순위 1)만 확정하고, `search_certs`/`list_exams`는
**빈 목록 + 안내**를 반환한다 — 추측 셀렉터를 넣지 않는다(설계 §4.13 원칙). 공개 파일의
직접 URL이 주어지면 `fetch_exam`이 F35-1 다운로드 경로(registry의 SSRF·스로틀 적용
`get_bytes`)로 내려받아 convert에 투입한다. Q-Net 포털 구조가 확정되면 이 모듈만 채우면 된다.
"""
from __future__ import annotations

import re
import urllib.parse
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

BASE_URL = "https://www.q-net.or.kr"
HOME_URL = BASE_URL + "/"

# 공개 파일 직접 URL 화이트리스트(Q-Net 도메인만) — fetch_exam이 받는 exam_ref 검증용.
_QNET_HOST_RE = re.compile(r"(^|\.)q-net\.or\.kr$", re.I)


class QnetAdapter(Adapter):
    id = "qnet"
    name = "큐넷 공개자료 (Q-Net)"
    priority = 1  # 중복 회차 시 채택(공단 원본이 정본) — 2026-07-25 사용자 확정
    notice = "개인 학습 전용 · 수집물 재배포 금지 — 큐넷 공개자료"
    base_url = BASE_URL

    def is_available(self, client: registry.FetchClient) -> Tuple[bool, Optional[str]]:
        # 포털 공개문제 카탈로그 구조가 실측되지 않아 목록 제공은 보류 상태임을 알린다.
        return (
            False,
            "큐넷 공개문제 목록 연동은 준비 중입니다 — 공개 파일 URL은 [URL로 반입]을 이용하세요",
        )

    def search_certs(self, query: str, client: registry.FetchClient) -> List[CertRef]:
        # 공개 카탈로그 미확정 — 추측 셀렉터 대신 빈 목록(설계 §4.13 원칙).
        return []

    def list_exams(self, cert_ref: str, client: registry.FetchClient) -> List[ExamEntry]:
        return []

    def fetch_exam(
        self,
        cert_ref: str,
        exam_ref: str,
        client: registry.FetchClient,
        on_activity: ActivityCallback = None,
    ) -> FetchResult:
        """exam_ref = Q-Net 공개 파일의 직접 URL일 때만 지원(F35-1 다운로드 경로 재사용)."""
        parsed = urllib.parse.urlparse(exam_ref or "")
        if parsed.scheme not in ("http", "https") or not parsed.hostname or not _QNET_HOST_RE.search(parsed.hostname):
            raise ParseFailedError(
                "큐넷 회차 자동 수집은 아직 지원되지 않습니다",
                alternatives=["url_import", "other_adapter"],
                detail={"exam_ref": exam_ref},
            )
        data, ctype, disp_name = client.get_bytes(exam_ref)
        filename = disp_name or (parsed.path.rsplit("/", 1)[-1] or "qnet_download.pdf")
        return FetchedFile(
            filename=filename,
            data=data,
            content_type=ctype,
            cert_name=None,
            exam_key=None,
            exam_label=None,
            level_hint="필기",
            source_url=exam_ref,
            note=f"qnet · {exam_ref}",
        )
