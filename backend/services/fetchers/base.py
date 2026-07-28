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
    """자격증 검색 결과 한 건 — `cert_ref`는 어댑터 내부 식별자(어댑터마다 규칙이 다르다)."""

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
    exam_date: Optional[str] = None  # 'YYYY-MM-DD'(S12) — 병합 자연 키. 미상이면 None(기존 하위 호환)
    # S14: 공개문제가 아닌 안내·집행 공지(제목 텍스트만으로 판정) — 기본 목록에서 숨기고
    # "안내문 N건 보기" 토글로만 노출한다(조용한 삭제 아님, 설계 §4.13).
    is_notice: bool = False


@dataclass
class FetchedQuestion:
    no: int
    stem: str
    choices: List[str] = field(default_factory=list)
    answer: Optional[str] = None
    explanation: Optional[str] = None
    images: List[str] = field(default_factory=list)  # 원본 이미지 URL(registry가 다운로드)
    subject: Optional[str] = None  # 과목 구분 — 태그 제안 소재로만 사용


@dataclass
class FetchedExam:
    """구조화 추출 경로 — LLM 프롬프트에 구조화 텍스트로 투입된다. S13 시점에 이
    경로를 쓰는 등록 어댑터는 없다(유일한 실사용 어댑터가 계획서 §14 F35-2 "제거
    이력"에 따라 제거됨) — 공식 API가 구조화 문항을 주는 경우를 위해 인터페이스만 유지."""

    cert_name: str
    exam_key: str
    exam_label: str
    level_hint: str
    questions: List[FetchedQuestion]
    source_url: Optional[str] = None
    note: Optional[str] = None  # sources.note에 기록할 수집 출처(URL·어댑터 id) — FetchedFile과 동일 계약


@dataclass
class FetchedFile:
    """qnet 경로 — 원본 파일을 그대로 convert에 투입한다(LLM이 구조 추출)."""

    filename: str
    data: bytes
    content_type: Optional[str] = None
    cert_name: Optional[str] = None
    exam_key: Optional[str] = None
    exam_label: Optional[str] = None
    level_hint: str = "필기"
    source_url: Optional[str] = None
    note: Optional[str] = None  # sources.note에 기록할 수집 출처(URL·어댑터 id)
    # S14: 대표 파일 외에 함께 확보한 원본에 대한 소표기(예: "도면 묶음(ZIP)도 함께
    # 저장했습니다") — 잡 성공 응답의 `notes`로 그대로 노출된다.
    extra_notes: List[str] = field(default_factory=list)


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


class AdapterServiceError(Exception):
    """외부 서비스가 **사람 말로 설명 가능한 이유**로 요청을 거절한 경우 (S14).

    `ParseFailedError`(구조 변경 추정)와 구분한다 — 쿼터 초과·키 오류·토큰 만료·서비스키
    미등록처럼 원인과 다음 행동이 분명한 실패다. 원문 XML/JSON은 절대 담지 않는다.

    `kind`는 서버 내부 분류('quota'|'key'|'token'|'no_key'|'unsupported_format'|'other')이며
    응답의 `error_info.kind`(§4.11 Literal)와는 별개다 — 변환은 convert_service가 한다."""

    def __init__(
        self,
        message: str,
        *,
        kind: str = "other",
        action: Optional[str] = None,
        alternatives: Optional[List[str]] = None,
        detail: Any = None,
    ) -> None:
        super().__init__(message)
        self.public_message = message
        self.kind = kind
        self.action = action or "잠시 후 다시 시도하세요."
        self.alternatives = alternatives or ["file_import", "url_import"]
        self.detail = detail


class UnsupportedFormatError(AdapterServiceError):
    """LLM에 투입할 수 있는 포맷(PDF)이 첨부에 없는 경우 (S14 — 실측상 대상은 주로 ZIP).

    **조용한 스킵 금지**: 원본은 이미 `sources/`에 저장한 뒤 이 오류로 잡을 종료하고,
    포맷별 다음 행동(압축 해제 후 파일 반입 / 한글→PDF 변환 등)을 안내한다."""

    def __init__(
        self,
        message: str,
        *,
        action: Optional[str] = None,
        saved_files: Optional[List[str]] = None,
        formats: Optional[List[str]] = None,
    ) -> None:
        super().__init__(
            message,
            kind="unsupported_format",
            action=action,
            alternatives=["file_import", "url_import"],
            detail={"saved_files": saved_files or [], "formats": formats or []},
        )
        self.saved_files = saved_files or []
        self.formats = formats or []


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

    def status_extra(self) -> dict:
        """`GET /api/fetch/adapters` 항목에 덧붙일 어댑터별 메타(기본 없음).

        S14 qnet은 `{key_registered, key_suffix?}`를 채운다 — **원문 키는 절대 담지 않는다**."""
        return {}

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
