"""사이트 어댑터 공통 인터페이스·자료구조 (F35-2, 설계 §4.13).

어댑터는 `search_certs` / `list_exams` / `fetch_exam` 세 메서드만 노출한다. `fetch_exam`은
**구조화 문항 배열(`FetchedExam`) 또는 원본 파일(`FetchedFile`)** 중 하나를 반환하며, 두 경로
모두 최종적으로 기존 convert 잡 큐가 반입 JSON(계획서 §8.2)으로 LLM 정리한다(설계 §4.13).

크롤링(HTTP·robots·스로틀)은 어댑터가 직접 하지 않고 `registry`가 주입하는 `FetchClient`를
통해서만 수행한다 — 예의 규칙(2초 스로틀·robots·UA)을 한 곳에서 강제하기 위함이다.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, List, Optional, Union


@dataclass
class CertRef:
    """자격증 검색 결과 한 건 — `cert_ref`는 어댑터 내부 식별자(comcbt=게시판 mid 등)."""

    name: str
    cert_ref: str


@dataclass
class ExamEntry:
    """회차 목록 한 건. `exam_key`는 `YYYY-N` 정규화 키(병합·큐넷 우선 판정의 기준)."""

    exam_key: str
    label: str
    exam_ref: str
    cert_name: str
    level_hint: str = "필기"  # '필기' | '실기' — 분류 경로 2단계
    question_count: Optional[int] = None  # 목록에서 미상이면 None(estimate가 60 가정)
    source_url: Optional[str] = None


@dataclass
class FetchedQuestion:
    no: int
    stem: str
    choices: List[str] = field(default_factory=list)
    answer: Optional[str] = None
    explanation: Optional[str] = None
    images: List[str] = field(default_factory=list)  # 원본 이미지 URL(registry가 다운로드)


@dataclass
class FetchedExam:
    """comcbt 구조화 경로 — LLM 프롬프트에 구조화 텍스트로 투입된다."""

    cert_name: str
    exam_key: str
    exam_label: str
    level_hint: str
    questions: List[FetchedQuestion]
    source_url: Optional[str] = None


@dataclass
class FetchedFile:
    """qnet(및 현재 comcbt) 경로 — 원본 파일을 그대로 convert에 투입한다(LLM이 구조 추출)."""

    filename: str
    data: bytes
    content_type: Optional[str] = None
    cert_name: Optional[str] = None
    exam_key: Optional[str] = None
    exam_label: Optional[str] = None
    level_hint: str = "필기"
    source_url: Optional[str] = None
    note: Optional[str] = None  # sources.note에 기록할 수집 출처(URL·어댑터 id)


FetchResult = Union[FetchedExam, FetchedFile]

# on_activity: 잡 진행 심장박동 콜백(다운로드 청크마다 호출) — 없으면 무시.
ActivityCallback = Optional[Callable[[], None]]


class ParseFailedError(Exception):
    """회차 단위 파싱/수집 실패 — convert 잡이 error_info `kind='parse_failed'`로 구조화한다.

    원문 HTML/JSON은 절대 담지 않는다(설계 §4.13 파싱 실패 처리). `alternatives`는 프론트에
    노출할 대안 버튼 힌트('url_import' | 'other_adapter')."""

    def __init__(
        self,
        message: str,
        *,
        alternatives: Optional[List[str]] = None,
        detail: Any = None,
    ) -> None:
        super().__init__(message)
        self.public_message = message
        self.alternatives = alternatives or ["url_import"]
        self.detail = detail


class Adapter:
    """어댑터 베이스 — 하위 클래스가 세 메서드를 구현한다.

    `client`는 registry가 주입하는 `FetchClient`(스로틀·robots·UA·SSRF 적용)."""

    id: str = ""
    name: str = ""
    priority: int = 99
    notice: str = "개인 학습 전용 — 수집물 재배포 금지"
    base_url: str = ""

    def is_available(self, client: "Any") -> tuple[bool, Optional[str]]:
        """(available, notice_override). robots 비허용·접속 불가면 (False, 사유)."""
        raise NotImplementedError

    def search_certs(self, query: str, client: "Any") -> List[CertRef]:
        raise NotImplementedError

    def list_exams(self, cert_ref: str, client: "Any") -> List[ExamEntry]:
        raise NotImplementedError

    def fetch_exam(
        self,
        cert_ref: str,
        exam_ref: str,
        client: "Any",
        on_activity: ActivityCallback = None,
    ) -> FetchResult:
        raise NotImplementedError
