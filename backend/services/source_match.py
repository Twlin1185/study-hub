"""원문 대조 검사 (S15 · F41 — 설계 §4.17 ⑥, 계획서 §8.3 v1.1).

**서버측 순수 함수 — LLM을 다시 부르지 않는다.** 변환 파이프라인(convert·fetch)이 만든
문제 문항의 지문(`content`)·보기(`choices`)가 **원본 추출 텍스트에 실재하는지** 대조해
통째 창작(PoC 실측: 추출 불가 글리프를 모델이 침묵 창작 — 10문항 중 6건)을 잡는다.

알고리즘(설계 §4.17 ⑥ 확정안 — 과설계 금지, 목적은 "통째 창작을 확실히 잡는 것"):
  - 정규화: 유니코드 문자·숫자만 남기고 공백·구두점·기호 제거 + 소문자화(원본·후보 동일).
    원본은 **잡당 1회**만 정규화한다(`SourceMatcher`가 보관).
  - ⓐ 정규화 후보 길이 <10 → 판정 생략(통과) — "다음 중 옳은 것은" 류 상투구 오탐 방지.
  - ⓑ 후보가 원본 정규화 텍스트의 부분 문자열이면 통과.
  - ⓒ 아니면 후보를 길이 12의 **비겹침 조각**(마지막 조각은 끝에서 12자)으로 나눠
    원본 내 존재 비율(커버리지) ≥ 0.6이면 통과, 미만이면 불일치.
  - 원본이 없거나 추출 실패, 또는 원본 정규화 텍스트 <200자 → **"대조 불가"**
    (`match_unavailable` — 배지·안내만, 기본 반입은 유지. 조용한 통과 금지).

**개념(concept) 문서는 대조 대상이 아니다** — 요약·재구조화가 본질이라 낮은 겹침이 정상
(G2 재실험 실증). 판정 결과는 **DB에 저장하지 않는다**(preview 게이트 신호 — DDL 0건).
"""
from __future__ import annotations

import io
import logging
from typing import Iterable, List, Optional, Sequence

_LOGGER = logging.getLogger(__name__)

# --- 임계값(설계 §4.17 ⑥ 확정 — 임의 변경 금지) ------------------------------------
MIN_SOURCE_NORM_CHARS = 200  # 원본 정규화 텍스트가 이보다 짧으면 "대조 불가"
MIN_CANDIDATE_CHARS = 10  # 정규화 후보가 이보다 짧으면 판정 생략(통과)
CHUNK_SIZE = 12  # 비겹침 조각 길이
COVERAGE_THRESHOLD = 0.6  # 조각 커버리지 통과 기준

# 텍스트로 그대로 읽어도 되는 확장자(그 외 바이너리·이미지는 "대조 불가")
TEXT_EXTENSIONS = {
    "txt",
    "md",
    "markdown",
    "html",
    "htm",
    "xhtml",
    "json",
    "csv",
    "tsv",
    "xml",
    "yaml",
    "yml",
    "rst",
    "log",
}


def normalize(text: Optional[str]) -> str:
    """문자·숫자만 남기고 소문자화 — 공백·구두점·기호·줄바꿈은 전부 제거한다.

    PDF 추출이 흔히 망가뜨리는 것(줄바꿈·하이픈·공백·기호)을 흡수하면서, 통째 창작은
    그대로 드러나게 하는 최소 정규화다."""
    if not text:
        return ""
    return "".join(ch for ch in text if ch.isalnum()).lower()


# ---------------------------------------------------------------------------
# 원본 → 텍스트 추출 (PDF = pypdf, 텍스트 계열 = 원문 그대로, 그 외 = None)
# ---------------------------------------------------------------------------
def extract_pdf_text(data: bytes) -> Optional[str]:
    """PDF 바이트 → 페이지 구분자(`--- page N ---`) 포함 텍스트. 실패는 **예외 대신 None**.

    codex 프롬프트 삽입(`codex_adapter.build_text_for_prompt`)과 원문 대조가 이 함수를
    공유한다 — 추출 구현 중복 금지(같은 텍스트로 프롬프트를 만들고 같은 텍스트로 대조한다).
    암호화 PDF는 빈 암호로 해제를 시도하며, 이때 AES 계열은 `cryptography` 의존이 필요하다
    (PoC 실측 — requirements 동봉)."""
    try:
        import pypdf
    except ImportError:
        _LOGGER.warning("pypdf가 설치되어 있지 않아 PDF 텍스트를 추출할 수 없습니다")
        return None
    try:
        reader = pypdf.PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            # 빈 암호(열람 제한만 걸린 배포용 PDF)는 해제 가능 — 실패하면 대조 불가로 떨어진다.
            try:
                reader.decrypt("")
            except Exception:  # noqa: BLE001 - cryptography 부재·암호 불일치 모두 대조 불가
                _LOGGER.info("암호화된 PDF를 해제하지 못했습니다(원문 대조 불가)")
                return None
        parts: List[str] = []
        for i, page in enumerate(reader.pages):
            try:
                text = page.extract_text() or ""
            except Exception:  # noqa: BLE001 - 페이지 하나가 깨져도 나머지는 살린다
                text = ""
            parts.append(f"--- page {i + 1} ---\n{text}")
        return "\n\n".join(parts)
    except Exception as exc:  # noqa: BLE001 - 손상·미지원 PDF는 "대조 불가"로 흡수
        _LOGGER.info("PDF 텍스트 추출 실패(원문 대조 불가): %s", exc)
        return None


def _extension(filename: Optional[str]) -> str:
    if not filename or "." not in filename:
        return ""
    return filename.rsplit(".", 1)[-1].lower()


def extract_source_text(filename: Optional[str], data: Optional[bytes]) -> Optional[str]:
    """원본 바이트 → 대조용 텍스트. 추출할 수 없으면 None("대조 불가")."""
    if not data:
        return None
    ext = _extension(filename)
    if ext == "pdf":
        return extract_pdf_text(data)
    if ext in TEXT_EXTENSIONS:
        return data.decode("utf-8", errors="replace")
    if ext:
        # 이미지·엑셀 등 — 텍스트 추출기가 없다(M16 F42 B군 추출기가 들어오면 넓어진다).
        return None
    # 확장자가 없는 파일은 텍스트일 때만 채택(엄격 디코드 — 실패하면 바이너리로 본다).
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return None


# ---------------------------------------------------------------------------
# 대조기 — 원본 정규화 1회 + 후보 문자열 판정
# ---------------------------------------------------------------------------
def _chunks(candidate: str) -> List[str]:
    """길이 12의 비겹침 조각(마지막 조각은 끝에서 12자 — 꼬리를 버리지 않는다)."""
    n = len(candidate)
    full = n - (n % CHUNK_SIZE)
    parts = [candidate[i : i + CHUNK_SIZE] for i in range(0, full, CHUNK_SIZE)]
    if n % CHUNK_SIZE:
        parts.append(candidate[-CHUNK_SIZE:])
    return parts or [candidate]


class SourceMatcher:
    """원본 추출 텍스트 1건에 대한 대조기. `available=False`면 "대조 불가" 상태다."""

    def __init__(self, source_text: Optional[str]) -> None:
        self.normalized = normalize(source_text)
        self.available = len(self.normalized) >= MIN_SOURCE_NORM_CHARS

    def matches(self, candidate: Optional[str]) -> bool:
        """후보 문자열이 원본에 실재하는가(설계 §4.17 ⑥ ⓐ~ⓒ). 대조 불가 상태면 True
        (판정하지 않는다 — 호출부가 `match_unavailable`로 따로 표시한다)."""
        if not self.available:
            return True
        norm = normalize(candidate)
        if len(norm) < MIN_CANDIDATE_CHARS:
            return True  # ⓐ 상투구 오탐 방지
        if norm in self.normalized:
            return True  # ⓑ 부분 문자열
        parts = _chunks(norm)  # ⓒ 조각 커버리지
        hit = sum(1 for part in parts if part in self.normalized)
        return (hit / len(parts)) >= COVERAGE_THRESHOLD - 1e-9

    def missing(self, candidates: Iterable[Optional[str]]) -> List[str]:
        """불일치한 후보만 돌려준다(로그·진단용). 대조 불가면 항상 빈 목록."""
        if not self.available:
            return []
        return [c for c in candidates if c and not self.matches(c)]

    def all_match(self, candidates: Sequence[Optional[str]]) -> bool:
        """지문·보기 중 **1건이라도 불일치면 False**(문항 판정 — 설계 §4.17 ⑥)."""
        return not self.missing(candidates)
