"""멀티 벤더 LLM 엔진 변환·재생성 (F23·F30·F34→F41, 계획서 §13-B, 설계 §4.10·§4.11·§4.17).

엔진: `claude-cli`(`claude -p --output-format stream-json`) · `claude-api`(anthropic SDK
스트리밍) · `codex-cli`(`codex exec --json -o` — 설계 §4.17 ④, 원본은 pypdf 추출 텍스트를
프롬프트에 삽입하는 경로만 지원). `engine` 파라미터(`auto` 또는 엔진 id, 기본 auto=
`settings:llm.priority` 우선순위 배열의 첫 available 엔진)로 선택한다. 잡은 인메모리 +
TTL(1시간)로 관리하며(서버 재시작 시 소실 허용 — 로컬 개인용), **동시 1개**만 실행되도록
전용 워커 스레드 1개가 큐를 순차 소비한다(convert·regenerate 공용).

오류는 항상 `services.llm_engine_service.classify_engine_failure`를 거쳐 구조화된
`error_info`로 변환된다 — 엔진 원문(JSON·스택트레이스)은 절대 사용자 응답에 노출하지
않는다(로그에만 남긴다).
"""
from __future__ import annotations

import base64
import datetime as dt
import hashlib
import io
import json
import logging
import queue
import shutil
import subprocess
import threading
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

import models
from database import BASE_DIR, SessionLocal
from exceptions import AppError, ConflictError, NotFoundError, ValidationAppError
from schemas.import_schema import PreviewResponse
from services import (
    codex_adapter,
    doc_extract,
    document_service,
    fetch_service,
    import_service,
    llm_engine_service,
    net_safety,
    settings_service,
    tag_rule_service,
)
from services.fetchers.base import (
    AdapterServiceError,
    FetchedExam,
    FetchedFile,
    ParseFailedError,
    UnsupportedFormatError,
)

PROMPTS_DIR = BASE_DIR / "prompts"
CONVERT_PROMPT_PATH = PROMPTS_DIR / "convert.md"
CONVERT_TMP_DIR = BASE_DIR / "convert_tmp"

DEFAULT_TIMEOUT_SECONDS = 600  # 기본 10분 (지시서)
JOB_TTL = dt.timedelta(hours=1)

# API 엔진 출력 상한 — 이미 스트리밍(messages.stream)이라 장시간 응답 자체는 문제 없다.
# 수십 문항짜리 실제 기출 PDF의 반입 JSON은 8192 토큰을 쉽게 넘어 잘림·파싱 실패를
# 일으키므로, sonnet 계열 모델의 최대 출력 한도 내에서 넉넉히 32000으로 잡는다(초과
# 모델이면 API가 400을 반환하므로 이 값이 안전 상한이다). CLI 경로는 별도 출력 상한이
# 없어 이 상수로 엔진 간 비대칭도 없앤다.
API_MAX_OUTPUT_TOKENS = 32000

_LOGGER = logging.getLogger(__name__)

_JOBS: Dict[str, dict] = {}
_JOBS_LOCK = threading.Lock()
_QUEUE: "queue.Queue[str]" = queue.Queue()
_WORKER_LOCK = threading.Lock()
_WORKER_STARTED = False


class ClaudeCliError(Exception):
    """claude CLI 실행 실패/부재 — llm_engine_service.classify_cli_failure로 사람이 읽는
    error_info로 변환된 뒤에만 사용자에게 노출된다(원문 그대로 노출 금지)."""


# ---------------------------------------------------------------------------
# SSRF 안전 URL 다운로드 (F35 1단계, 설계 §4.11)
# ---------------------------------------------------------------------------
MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024  # 50MB 상한
DOWNLOAD_TIMEOUT_SECONDS = 30
MAX_REDIRECTS = 5
_ALLOWED_CONTENT_TYPES = {
    "application/pdf": "pdf",
    "text/html": "html",
    "application/xhtml+xml": "html",
    "text/markdown": "md",
    "text/plain": "md",
    "image/png": "image",
    "image/jpeg": "image",
    "image/gif": "image",
    "image/webp": "image",
    # S16(F42) — 설계 §4.18 ⑦ D2-⑤ 확정 5종. octet-stream은 계속 미허용(YAGNI, 파일 반입
    # 폴백이 항상 살아 있다). 다운로드 성공 후에도 ①②③ 판별 계층을 동일하게 통과한다
    # (content-type은 수신 허용 게이트일 뿐 판별 근거가 아니다 — 매직 바이트 우선).
    "application/xml": "xml",
    "text/xml": "xml",
    "text/csv": "csv",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
}


def _assert_public_host(host: str) -> None:
    """SSRF 검증 — 공용 `net_safety.assert_public_host`를 이 모듈의 ValidationAppError로 감싼다."""
    try:
        net_safety.assert_public_host(host)
    except net_safety.HostResolveError as exc:
        raise ValidationAppError(f"URL 호스트를 확인할 수 없습니다: {host}") from exc
    except net_safety.UnsafeHostError as exc:
        raise ValidationAppError(
            "사설·루프백·링크로컬 등 로컬 네트워크 주소로의 반입은 허용되지 않습니다(SSRF 방지)",
            detail={"host": host, "ip": exc.ip},
        ) from exc


def _filename_from_url(url: str, content_type: str) -> str:
    parsed = urllib.parse.urlparse(url)
    name = Path(urllib.parse.unquote(parsed.path)).name
    if not name or "." not in name:
        ext_map = {
            "pdf": "pdf",
            "html": "html",
            "md": "md",
            "image": "png",
            "xml": "xml",
            "csv": "csv",
            "docx": "docx",
            "xlsx": "xlsx",
        }
        kind = _ALLOWED_CONTENT_TYPES.get(content_type, "bin")
        name = f"download.{ext_map.get(kind, 'bin')}"
    return _safe_name(name)


def _download_source_url(url: str, *, on_activity=None) -> Tuple[str, bytes, str]:
    """안전장치: http/https만 허용, 매 리다이렉트 hop마다 호스트 DNS 재검증, 사설/루프백/
    링크로컬 IP 차단, content-type 화이트리스트(pdf/html/이미지/md), 크기 상한(50MB), 타임아웃."""
    current_url = url
    opener = urllib.request.build_opener(net_safety.NoRedirectHandler())

    for _hop in range(MAX_REDIRECTS + 1):
        parsed = urllib.parse.urlparse(current_url)
        if parsed.scheme not in ("http", "https"):
            raise ValidationAppError("http/https URL만 허용됩니다", detail={"url": current_url})
        host = parsed.hostname
        if not host:
            raise ValidationAppError("URL에 호스트가 없습니다", detail={"url": current_url})
        _assert_public_host(host)

        req = urllib.request.Request(current_url, headers={"User-Agent": "StudyHub-Import/1.0"})
        try:
            resp = opener.open(req, timeout=DOWNLOAD_TIMEOUT_SECONDS)
        except urllib.error.HTTPError as exc:
            if exc.code in (301, 302, 303, 307, 308):
                location = exc.headers.get("Location") if exc.headers else None
                if not location:
                    raise ValidationAppError(
                        "리다이렉트 대상 URL이 없습니다", detail={"url": current_url}
                    ) from exc
                current_url = urllib.parse.urljoin(current_url, location)
                if on_activity:
                    on_activity()
                continue
            raise ValidationAppError(
                f"다운로드에 실패했습니다(HTTP {exc.code})", detail={"url": current_url}
            ) from exc
        except (urllib.error.URLError, OSError, TimeoutError) as exc:
            raise ValidationAppError(
                f"다운로드 중 오류가 발생했습니다: {exc}", detail={"url": current_url}
            ) from exc

        with resp:
            content_type_raw = resp.headers.get("Content-Type", "")
            content_type = content_type_raw.split(";")[0].strip().lower()
            if content_type not in _ALLOWED_CONTENT_TYPES:
                raise ValidationAppError(
                    "허용되지 않는 파일 형식입니다(pdf·html·이미지·md·xml·csv·docx·xlsx만 허용)",
                    detail={"content_type": content_type_raw or None},
                )
            length_header = resp.headers.get("Content-Length")
            if length_header:
                try:
                    if int(length_header) > MAX_DOWNLOAD_BYTES:
                        raise ValidationAppError(
                            "파일 크기가 상한(50MB)을 초과합니다",
                            detail={"content_length": length_header},
                        )
                except ValueError:
                    pass

            chunks: List[bytes] = []
            total = 0
            while True:
                chunk = resp.read(65536)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_DOWNLOAD_BYTES:
                    raise ValidationAppError(
                        "파일 크기가 상한(50MB)을 초과합니다", detail={"limit_bytes": MAX_DOWNLOAD_BYTES}
                    )
                chunks.append(chunk)
                if on_activity:
                    on_activity()
            data = b"".join(chunks)

        if not data:
            raise ValidationAppError("다운로드한 파일 내용이 비어 있습니다", detail={"url": current_url})

        return _filename_from_url(current_url, content_type), data, content_type

    raise ValidationAppError("리다이렉트가 너무 많습니다(5회 초과)", detail={"url": url})


def _write_tmp_file(job_id: str, filename: str, data: bytes) -> Path:
    CONVERT_TMP_DIR.mkdir(exist_ok=True)
    tmp_path = CONVERT_TMP_DIR / f"{job_id}_{_safe_name(filename)}"
    tmp_path.write_bytes(data)
    return tmp_path


# ---------------------------------------------------------------------------
# 반입 파일 판별 계층 (S16 — F42, 설계 §4.18 ①②③) — phase='preparing', LLM 호출 전 비용 0
#
# 우선순위: **매직 바이트 > 텍스트성 > 인코딩 > 확장자**(content-type은 URL 수신 허용
# 게이트일 뿐 판별 근거가 아니다 — 사칭 방어). 미지원·판별 불가는 원본을 sources/에 저장한
# 뒤 UnsupportedFormatError로 종료한다(조용한 스킵 금지 — qnet `_unsupported_message` 전례
# 그대로 재사용). 판별을 거치지 않은 바이트가 API 엔진의 utf-8 강제 디코드 폴백에 닿는
# 경로는 0이어야 한다 — 이 함수를 통과한 결과(ImportDetection)만 프롬프트 조립에 쓴다.
# ---------------------------------------------------------------------------
_PDF_MAGIC = b"%PDF"
_ZIP_MAGIC = b"PK\x03\x04"
_OLE_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"

_TEXT_FILE_TYPE_MAP = {
    "md": "md",
    "markdown": "md",
    "txt": "txt",
    "html": "html",
    "htm": "html",
    "xhtml": "html",
    "xml": "xml",
    "csv": "csv",
}

# §4.18 ⑥ 확정 문안 — (message, action 뒷부분). action 앞머리 "원본은 sources/에
# 저장했습니다."는 _unsupported_error가 고정으로 붙인다.
_UNSUPPORTED_MESSAGES: Dict[str, Tuple[str, str]] = {
    "hwp": ("한글(HWP) 문서는 자동 변환할 수 없습니다", "한글에서 PDF로 저장한 뒤 다시 반입하세요."),
    "zip": ("압축 파일(ZIP)은 자동 변환할 수 없습니다", "압축을 풀어 PDF·이미지·문서 파일을 하나씩 반입하세요."),
    "doc": ("구버전 워드(doc) 문서는 지원하지 않습니다", "워드에서 docx로 저장한 뒤 다시 반입하세요."),
    "xls": ("구버전 엑셀(xls) 문서는 지원하지 않습니다", "엑셀에서 xlsx로 저장한 뒤 다시 반입하세요."),
    "ole_unknown": ("구버전 오피스·한글 계열 문서로 보입니다", "PDF 또는 docx/xlsx로 저장한 뒤 다시 반입하세요."),
    "undetected": (
        "파일 형식을 판별할 수 없습니다(지원하지 않는 바이너리 또는 인코딩)",
        "PDF·이미지 또는 UTF-8 텍스트로 저장한 뒤 다시 반입하세요.",
    ),
}


class TooLargeError(Exception):
    """추출·디코드 텍스트가 200,000자 상한을 초과(D2-⑥, §4.18 ⑤) — `error_info.kind`에
    **`'too_large'` 신설**. LLM 호출 전 실행 전 종료(비용 0). `fallback_available=False`
    (엔진을 바꿔도 같다)·`alternatives` 없음. xlsx 시트/행/열 구조 상한 초과도 같은 kind다."""

    def __init__(self, message: str, *, action: Optional[str] = None) -> None:
        super().__init__(message)
        self.public_message = message
        self.action = action or "원본을 과목·회차 단위로 나눠 개별 파일로 반입해 주세요."


_DOC_PARSE_FAILED_ACTION = "원본은 sources/에 저장했습니다. 암호를 해제하거나 PDF로 저장한 뒤 다시 반입하세요."


class DocParseFailedError(Exception):
    """B군(docx/xlsx) 파서 예외 — 판별이 docx/xlsx로 **확정된 뒤**의 추출 실패(암호·손상·
    구조 위장). `error_info.kind`는 신규 없이 기존 `'parse_failed'`를 재사용한다(§4.18 ④
    경계 규칙). 판별 자체가 미지원이면 `UnsupportedFormatError`(kind='unsupported_format').

    **원본 저장은 `unsupported_format`과 대칭(설계 v1.19 확정)**: 이 예외로 종료할 때도
    원본을 `sources/`에 저장한 뒤 종료한다 — action 앞머리 "원본은 sources/에 저장했습니다."
    고정(호출부가 저장 후 이 예외를 만든다 — 아래 `action` 기본값이 그 문안)."""

    def __init__(self, message: str, *, action: Optional[str] = None) -> None:
        super().__init__(message)
        self.public_message = message
        self.action = action or _DOC_PARSE_FAILED_ACTION


@dataclass
class ImportDetection:
    """반입 파일 판별 결과 — `group`에 따라 프롬프트 조립 방식이 갈린다.

    - `pdf`·`image`: 기존 경로 그대로(엔진별 기존 함수가 처리 — 이 판별 계층은 조기 분류만).
    - `text`(A군 md·txt·html·xml·csv): `encoding`으로 디코드한 `text` — CLI는 utf-8 계열은
      원본 tmp 그대로, cp949는 재인코딩 tmp로 전달(③). codex·api는 `text`를 프롬프트에 직접 삽입.
    - `docx`·`xlsx`(B군): `text`(추출 결과)를 **3엔진 공통**으로 프롬프트에 직접 삽입.
    """

    group: str  # 'pdf' | 'image' | 'text' | 'docx' | 'xlsx'
    file_type: str  # sources.file_type 값(자유 텍스트)
    encoding: Optional[str] = None  # group == 'text'일 때만('utf-8-sig'|'utf-8'|'cp949')
    text: Optional[str] = None  # group in ('text','docx','xlsx')일 때 디코드·추출 텍스트
    notes: List[str] = field(default_factory=list)  # 잡 notes에 붙일 소표기(§4.18 ④)


def _ext_of(filename: Optional[str]) -> str:
    name = Path(filename or "").name
    return name.rsplit(".", 1)[-1].lower() if "." in name else ""


def _detect_image_magic(data: bytes) -> Optional[str]:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return "gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


def _is_hwpx(zf: zipfile.ZipFile, names: set) -> bool:
    """hwpx 식별(§4.18 ② 확정 — S16 검토 적발 수정) — hwpx도 zip이라 내부 마커로만
    구분한다: `mimetype` 엔트리가 `application/hwp+zip`이거나 `Contents/` 최상위 구조가
    있으면 hwpx. 둘 다 표준 라이브러리 `zipfile`만 사용(신규 의존 아님)."""
    if "mimetype" in names:
        try:
            mimetype = zf.read("mimetype").decode("ascii", errors="ignore").strip()
        except Exception:  # noqa: BLE001 - 판별 실패는 그냥 hwpx 아님으로 흡수
            mimetype = ""
        if mimetype == "application/hwp+zip":
            return True
    return any(name.startswith("Contents/") for name in names)


def _detect_zip_kind(data: bytes) -> str:
    """zip `PK\\x03\\x04` 내부 판별 — docx(`word/document.xml`)·xlsx(`xl/workbook.xml`)·
    hwpx(§4.18 ②, `_is_hwpx`)·그 외는 'zip'(표준 zipfile만 사용, 신규 의존 아님)."""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            names = set(zf.namelist())
            if "word/document.xml" in names:
                return "docx"
            if "xl/workbook.xml" in names:
                return "xlsx"
            if _is_hwpx(zf, names):
                return "hwpx"
            return "zip"
    except zipfile.BadZipFile:
        return "zip"


def _detect_text_encoding(data: bytes) -> Optional[str]:
    """D2-② 확정: utf-8 BOM(utf-8-sig) → utf-8(strict) → cp949(strict). 전부 실패하면
    None(판별 불가) — chardet류 추론 라이브러리는 도입하지 않는다."""
    if data.startswith(b"\xef\xbb\xbf"):
        try:
            data.decode("utf-8-sig")
            return "utf-8-sig"
        except UnicodeDecodeError:
            return None
    try:
        data.decode("utf-8")
        return "utf-8"
    except UnicodeDecodeError:
        pass
    try:
        data.decode("cp949")
        return "cp949"
    except UnicodeDecodeError:
        return None


def _unsupported_error(filename: str, data: bytes, reason: str) -> UnsupportedFormatError:
    """C군 판별 — 원본을 sources/에 저장한 뒤 반환한다(호출부가 raise). 조용한 스킵 금지
    (qnet과 동일 정책, §4.18 ⑥). action 앞머리는 항상 "원본은 sources/에 저장했습니다." 고정."""
    message, action_tail = _UNSUPPORTED_MESSAGES[reason]
    saved = import_service.save_source_file(filename, data)
    return UnsupportedFormatError(
        message,
        action=f"원본은 sources/에 저장했습니다. {action_tail}",
        saved_files=[saved],
        formats=[reason],
    )


def _doc_parse_failed(filename: str, data: bytes, message: str) -> DocParseFailedError:
    """B군 파서 예외 → `DocParseFailedError` — **원본을 sources/에 저장한 뒤** 반환한다
    (호출부가 raise). `unsupported_format`과 대칭(설계 v1.19 확정, §4.18 ④) — 손상·암호
    파일도 사용자의 원본 자료이고 잡 tmp는 정리되므로 저장하지 않으면 서버에 남지 않는다."""
    import_service.save_source_file(filename, data)
    return DocParseFailedError(message, action=_DOC_PARSE_FAILED_ACTION)


def _extract_group_text(filename: str, data: bytes, *, kind: str) -> str:
    """B군 추출(doc_extract 위임) — 파서 예외를 구조화 예외로 좁힌다(§4.18 ④ 경계 규칙:
    판별이 docx/xlsx로 확정된 뒤의 실패만 여기로 온다)."""
    try:
        if kind == "docx":
            return doc_extract.extract_docx_text(data)
        return doc_extract.extract_xlsx_text(data)
    except doc_extract.DocTooLargeError as exc:
        raise TooLargeError(exc.public_message, action=exc.action) from exc
    except doc_extract.DocExtractError as exc:
        raise _doc_parse_failed(filename, data, exc.public_message) from exc


def _detect_import_format(filename: str, data: bytes) -> ImportDetection:
    """반입 파일 판별(§4.18 ①②③) — 매직 바이트 우선. 통과분은 이 함수 안에서 200,000자
    상한(§4.18 ⑤)까지 확인을 마친다(B군은 doc_extract 내부에서, A군은 아래에서)."""
    ext = _ext_of(filename)

    if data.startswith(_PDF_MAGIC):
        return ImportDetection(group="pdf", file_type="pdf")

    image_type = _detect_image_magic(data)
    if image_type:
        return ImportDetection(group="image", file_type=image_type)

    if data.startswith(_ZIP_MAGIC):
        zip_kind = _detect_zip_kind(data)
        if zip_kind == "docx":
            text = _extract_group_text(filename, data, kind="docx")
            notes: List[str] = []
            if doc_extract.docx_has_lost_elements(data):
                notes.append(
                    "수식·그림은 텍스트 추출에서 제외되었습니다 — 미리보기에서 원본과 대조하세요."
                )
            return ImportDetection(group="docx", file_type="docx", text=text, notes=notes)
        if zip_kind == "xlsx":
            text = _extract_group_text(filename, data, kind="xlsx")
            return ImportDetection(group="xlsx", file_type="xlsx", text=text)
        if zip_kind == "hwpx":
            # hwpx는 hwp와 문구 공통(§4.18 ⑥ "hwp·hwpx" 행 — S16 검토 적발 수정: 일반
            # zip 문구("압축을 풀어…")로 오안내되던 결함).
            raise _unsupported_error(filename, data, "hwp")
        raise _unsupported_error(filename, data, "zip")

    if data.startswith(_OLE_MAGIC):
        if ext in ("docx", "xlsx"):
            # ECMA-376 암호화 OOXML(암호 걸린 docx/xlsx)은 zip이 아니라 OLE CFB 컨테이너로
            # 저장된다 — 판별은 확장자로 docx/xlsx가 **확정**됐으므로 parse_failed(암호 해제
            # 안내)다, unsupported_format이 아니다(§4.18 ④ 확정 — S16 검토 적발 수정. 신규
            # 파서 라이브러리 도입 없음 — 판별만 추가).
            kind_label = "워드(docx)" if ext == "docx" else "엑셀(xlsx)"
            raise _doc_parse_failed(
                filename, data, f"{kind_label} 문서를 열 수 없습니다(암호가 걸려 있는 것으로 보입니다)."
            )
        if ext == "doc":
            raise _unsupported_error(filename, data, "doc")
        if ext == "xls":
            raise _unsupported_error(filename, data, "xls")
        if ext == "hwp":
            raise _unsupported_error(filename, data, "hwp")
        raise _unsupported_error(filename, data, "ole_unknown")

    if b"\x00" in data[:8192]:
        raise _unsupported_error(filename, data, "undetected")

    encoding = _detect_text_encoding(data)
    if encoding is None:
        raise _unsupported_error(filename, data, "undetected")

    text = data.decode(encoding)
    try:
        # S16 검토 6 — §4.18 ⑤ 확정 문안을 그대로 쓴다(레이블 커스터마이즈 없음):
        # "추출된 텍스트가 너무 깁니다(약 N자 — 상한 200,000자)".
        doc_extract.enforce_max_chars(text)
    except doc_extract.DocTooLargeError as exc:
        raise TooLargeError(exc.public_message, action=exc.action) from exc
    file_type = _TEXT_FILE_TYPE_MAP.get(ext, "txt")
    return ImportDetection(group="text", file_type=file_type, encoding=encoding, text=text)


def _detection_input_size(detected: ImportDetection, fallback_bytes: int) -> int:
    """LLM 사용량 사전 안내(ETA 표본, §4.11 progress) 기준 — S16 검토 8: A·B군(text·docx·
    xlsx)은 실제 LLM에 들어가는 추출·디코드 텍스트 길이(utf-8 인코딩 바이트 수)를 쓰고,
    pdf·image는 원본 바이트 길이(`fallback_bytes`)를 그대로 쓴다. `_do_convert`·`_do_fetch`
    가 공유한다(중복 구현 금지)."""
    if detected.text is not None:
        return len(detected.text.encode("utf-8"))
    return fallback_bytes


# ---------------------------------------------------------------------------
# claude CLI 실행 — stream-json (S8, 잡 진행 가시화)
# ---------------------------------------------------------------------------
def _find_claude_executable() -> str:
    for name in ("claude", "claude.exe", "claude.cmd"):
        path = shutil.which(name)
        if path:
            return path
    raise ClaudeCliError(
        "claude CLI를 찾을 수 없습니다. Claude Code가 설치되어 PATH에 등록돼 있는지 확인하세요. "
        "설치 전까지는 API 엔진으로 전환하거나, 반입 화면에서 JSON을 직접 만들어 수동으로 반입해 주세요(A방식)."
    )


def _run_claude_cli_streaming(prompt: str, *, timeout_seconds: int, job_id: str) -> str:
    """`--output-format stream-json`으로 실행해 스트림 이벤트마다 잡의 last_activity_at·
    usage를 갱신한다. 반환값은 최종 result 텍스트(기존 `_extract_text_result`와 동일 의미)."""
    exe = _find_claude_executable()
    args = [exe, "-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "bypassPermissions"]
    try:
        proc = subprocess.Popen(
            args,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            cwd=str(BASE_DIR),
        )
    except OSError as exc:
        raise ClaudeCliError(f"claude CLI 실행 파일을 찾지 못했습니다: {exc}") from exc

    try:
        if proc.stdin is not None:
            proc.stdin.write(prompt)
            proc.stdin.close()
    except (BrokenPipeError, OSError):
        pass

    state: Dict[str, Any] = {
        "result_text": None,
        "is_error": False,
        "usage": {"input_tokens": 0, "output_tokens": 0},
    }

    def _reader() -> None:
        if proc.stdout is None:
            return
        for line in proc.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            etype = event.get("type")
            if etype == "assistant":
                message = event.get("message") or {}
                usage = message.get("usage") or {}
                if usage.get("input_tokens") is not None:
                    state["usage"]["input_tokens"] = usage["input_tokens"]
                if usage.get("output_tokens") is not None:
                    state["usage"]["output_tokens"] = usage["output_tokens"]
                _touch_activity(job_id, usage=dict(state["usage"]))
            elif etype in ("user", "system"):
                _touch_activity(job_id)
            elif etype == "result":
                state["is_error"] = bool(event.get("is_error"))
                result = event.get("result")
                state["result_text"] = result if isinstance(result, str) else json.dumps(result, ensure_ascii=False)
                cost = event.get("total_cost_usd")
                if cost is not None:
                    _touch_activity(job_id, usage={"cost_usd": cost})
                _touch_activity(job_id)

    stderr_chunks: List[str] = []

    def _stderr_reader() -> None:
        if proc.stderr is None:
            return
        for line in proc.stderr:
            stderr_chunks.append(line)

    reader_thread = threading.Thread(target=_reader, daemon=True)
    stderr_thread = threading.Thread(target=_stderr_reader, daemon=True)
    reader_thread.start()
    stderr_thread.start()

    try:
        proc.wait(timeout=timeout_seconds)
    except subprocess.TimeoutExpired as exc:
        proc.kill()
        proc.wait()
        raise ClaudeCliError(
            f"claude CLI 실행이 {timeout_seconds}초 내에 끝나지 않았습니다(타임아웃). "
            "파일이 너무 크거나 응답이 지연되고 있을 수 있습니다."
        ) from exc
    # stdout·stderr 파이프를 각각 별도 스레드로 동시에 배수한다 — 한쪽만 읽으면 다른 쪽
    # 버퍼가 가득 차 자식 프로세스가 블로킹되는 교착 상태를 원천 차단한다.
    reader_thread.join(timeout=5)
    stderr_thread.join(timeout=5)
    stderr_text = "".join(stderr_chunks)

    if state["result_text"] is None:
        if proc.returncode != 0:
            raise ClaudeCliError(
                f"claude CLI 실행 실패(exit={proc.returncode}): {stderr_text.strip()[:4000]}"
            )
        raise ClaudeCliError("claude CLI 스트림에서 결과를 찾지 못했습니다.")

    if state["is_error"]:
        raise ClaudeCliError(f"claude 실행 결과가 오류를 반환했습니다: {str(state['result_text'])[:2000]}")

    return state["result_text"]


# ---------------------------------------------------------------------------
# API 엔진 실행 — anthropic SDK 스트리밍 (F34)
# ---------------------------------------------------------------------------
_IMAGE_MEDIA_TYPES = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "gif": "image/gif",
    "webp": "image/webp",
}


def _api_content_blocks_for_file(path: Path, *, group: str, file_type: str) -> List[dict]:
    """CLI는 Read 도구로 파일을 읽지만 API는 도구가 없으므로 파일 내용을 메시지에 직접
    포함한다 — PDF는 base64 document 블록, 이미지는 image 블록.

    `group`·`file_type`은 판별 계층(§4.18 ①②③, `_detect_import_format`)의 매직 바이트
    판정 결과를 그대로 받는다 — **확장자 재분기 없음**(S16 검토 적발: 확장자 없는 `%PDF`·
    PNG가 `path.suffix` 재분기로 utf-8 강제 디코드 텍스트 블록에 새던 결함의 수정. 내용
    판별이 정본, §4.18 ②-3). 이 함수는 group이 `pdf`·`image`일 때만 호출된다(text·docx·
    xlsx는 embedded-text 경로로 우회) — 아래 텍스트 폴백은 방어적 코드일 뿐 정상 경로에서
    도달하지 않는다."""
    data = path.read_bytes()
    if group == "pdf":
        b64 = base64.b64encode(data).decode("ascii")
        return [{"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": b64}}]
    if group == "image":
        media_type = _IMAGE_MEDIA_TYPES.get(file_type, "image/png")
        b64 = base64.b64encode(data).decode("ascii")
        return [{"type": "image", "source": {"type": "base64", "media_type": media_type, "data": b64}}]
    text = data.decode("utf-8", errors="replace")  # 방어적 폴백(도달 불가 경로)
    return [{"type": "text", "text": f"\n\n## 원본 파일 내용 ({path.name})\n\n{text}\n"}]


def _run_api_streaming(
    prompt_text: str,
    *,
    file_blocks: Optional[List[dict]],
    timeout_seconds: int,
    job_id: str,
    model: str,
) -> str:
    try:
        import anthropic
    except ImportError as exc:
        raise llm_engine_service.ApiEngineError(
            "서버에 anthropic SDK가 설치되어 있지 않습니다.",
            kind="not_installed",
            action="서버에서 `pip install anthropic`을 실행하거나 CLI 엔진을 사용하세요.",
        ) from exc

    api_key = llm_engine_service.get_api_key()
    if not api_key:
        raise llm_engine_service.ApiEngineError(
            "API 키가 등록되어 있지 않습니다.",
            kind="not_installed",
            action="설정에서 API 키를 등록하거나 CLI 엔진을 사용하세요.",
        )

    client = anthropic.Anthropic(api_key=api_key, timeout=timeout_seconds)
    content_blocks: List[dict] = list(file_blocks or [])
    content_blocks.append({"type": "text", "text": prompt_text})

    text_parts: List[str] = []
    try:
        with client.messages.stream(
            model=model,
            max_tokens=API_MAX_OUTPUT_TOKENS,
            messages=[{"role": "user", "content": content_blocks}],
        ) as stream:
            for event in stream:
                etype = getattr(event, "type", None)
                if etype == "content_block_delta":
                    delta = getattr(event, "delta", None)
                    text = getattr(delta, "text", None) if delta is not None else None
                    if text:
                        text_parts.append(text)
                    _touch_activity(job_id)
                elif etype in ("message_start", "content_block_start", "message_delta", "ping"):
                    _touch_activity(job_id)
            final_message = stream.get_final_message()
        usage = getattr(final_message, "usage", None)
        if usage is not None:
            _touch_activity(
                job_id,
                usage={
                    "input_tokens": getattr(usage, "input_tokens", None),
                    "output_tokens": getattr(usage, "output_tokens", None),
                },
            )
    except anthropic.APIError as exc:
        raise llm_engine_service.ApiEngineError(str(exc), original=exc) from exc

    result_text = "".join(text_parts).strip()
    if not result_text:
        raise llm_engine_service.ApiEngineError(
            "API 엔진 응답이 비어 있습니다.", kind="other", action="잠시 후 다시 시도하세요."
        )
    return result_text


# ---------------------------------------------------------------------------
# 텍스트 파싱 유틸 (기존 유지)
# ---------------------------------------------------------------------------
class InvalidLlmOutputError(ValidationAppError):
    """LLM 출력이 완결된 **순수** JSON이 아님 (S13 F40-④ / S15 §8.2 v1.1, 설계 §4.11
    `invalid_output`).

    같은 파일로 재시도하면 같은 실패이므로 "잠시 후 다시 시도"는 오안내다 — 원본 분할·
    엔진 교체를 안내한다. **원문(잘린 출력·raw)은 detail에도 담지 않는다**(로그에만).
    `impure=True`는 JSON 자체는 완결이지만 코드펜스·전후 잡문이 섞인 경우(§8.2 v1.1)."""

    def __init__(self, message: str, *, truncated: bool, impure: bool = False) -> None:
        super().__init__(message, detail=None)
        self.truncated = truncated
        self.impure = impure


# 문항이 많은 기출은 출력 상한에서 잘리는 것이 실제 실패 원인이다. 토큰 수를 직접 알 수
# 없으므로 문자 수로 대략 환산해(한국어 혼합 텍스트 ≈ 2자/토큰) 상한 근접을 추정한다.
_CHARS_PER_TOKEN = 2
_TRUNCATION_RATIO = 0.9


def _looks_truncated(cleaned: str) -> bool:
    """출력이 '중간에 잘린' 모양인지 추정 — 상한 근접이거나 JSON이 열린 채 끝났는가."""
    stripped = cleaned.rstrip()
    if not stripped:
        return False
    if len(cleaned) >= API_MAX_OUTPUT_TOKENS * _CHARS_PER_TOKEN * _TRUNCATION_RATIO:
        return True
    if stripped[-1] not in "}]":
        return True
    return stripped.count("{") > stripped.count("}") or stripped.count("[") > stripped.count("]")


def _looks_impure(cleaned: str) -> bool:
    """"JSON은 완결인데 코드펜스·전후 잡문이 섞였다"를 판별 — 안내 문구 분기 전용
    (§8.2 v1.1: 관대한 벗겨내기는 하지 않는다)."""
    if cleaned.startswith("```"):
        return True
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end <= start:
        return False
    if start == 0 and end == len(cleaned) - 1:
        return False  # 앞뒤 잡문 없음 — 그냥 깨진 JSON
    try:
        json.loads(cleaned[start : end + 1])
    except json.JSONDecodeError:
        return False
    return True


def _parse_json_payload(text: str) -> Any:
    """LLM 출력을 **순수 JSON으로만** 받아들인다 (§8.2 v1.1 / 설계 §4.17 ⑤ — PoC I1).

    코드펜스·전후 잡문을 벗겨내는 관대한 처리는 제거됐다(규율 이완 금지): 출력이 통째로
    파싱되지 않으면 `InvalidLlmOutputError`(`error_info.kind:'invalid_output'`)로 실패한다.
    원문은 서버 로그에만 남기고 사용자 응답에는 싣지 않는다(설계 §4.11 원칙)."""
    cleaned = text.strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as exc:
        _raise_invalid_output(cleaned, reason=str(exc))


def _raise_invalid_output(cleaned: str, *, reason: str) -> None:
    impure = _looks_impure(cleaned)
    truncated = False if impure else _looks_truncated(cleaned)
    _LOGGER.warning(
        "LLM 출력 파싱 실패(truncated=%s, impure=%s, %d자): %s | raw(앞 500자)=%r",
        truncated,
        impure,
        len(cleaned),
        reason,
        cleaned[:500],
    )
    if impure:
        raise InvalidLlmOutputError(
            "LLM 응답이 순수 JSON이 아닙니다 — 코드펜스·설명 문장이 섞여 있습니다",
            truncated=False,
            impure=True,
        )
    # 이 파서는 변환(convert·fetch)과 F30 재생성이 공유한다 — "문항이 많아"처럼 반입에만
    # 맞는 표현 대신 경로 중립 문구를 쓰고, 경로별 다음 행동은 `_invalid_output_action`이
    # 담당한다(재생성 실패에 "과목·회차 단위로 나눠 올리기"가 뜨던 문제).
    message = (
        "LLM 응답이 완결된 JSON이 아닙니다 — 출력이 중간에 잘렸을 수 있습니다"
        if truncated
        else "LLM 응답이 올바른 JSON이 아닙니다"
    )
    raise InvalidLlmOutputError(message, truncated=truncated)


def _safe_name(name: str) -> str:
    base = Path(name).name.replace("\\", "_").replace("/", "_").strip()
    return base or "source"


# ---------------------------------------------------------------------------
# 잡 진행 가시화 (S8, 설계 §4.11 progress) — phase/활동/usage/ETA
# ---------------------------------------------------------------------------
def _set_phase(job_id: str, phase: str, detail: Optional[str] = None) -> None:
    with _JOBS_LOCK:
        job = _JOBS.get(job_id)
        if job is None:
            return
        job["_phase"] = phase
        job["_phase_detail"] = detail
        job["_last_activity_at"] = dt.datetime.now()


def _touch_activity(job_id: str, *, usage: Optional[Dict[str, Any]] = None) -> None:
    with _JOBS_LOCK:
        job = _JOBS.get(job_id)
        if job is None:
            return
        job["_last_activity_at"] = dt.datetime.now()
        if usage:
            current = job.setdefault("_usage", {"input_tokens": 0, "output_tokens": 0, "cost_usd": None})
            for key in ("input_tokens", "output_tokens", "cost_usd"):
                if usage.get(key) is not None:
                    current[key] = usage[key]


_ETA_LOCK = threading.Lock()
_ETA_SAMPLES: Dict[str, List[Tuple[int, int]]] = {"convert": [], "regenerate": []}
_ETA_MAX_SAMPLES = 20


def _record_eta_sample(kind: str, size: int, duration_ms: int) -> None:
    """과거 완료 잡의 (입력 크기→소요 시간) 표본을 최근 N개만 유지하며 이동 평균 낸다."""
    if size <= 0 or duration_ms <= 0:
        return
    with _ETA_LOCK:
        samples = _ETA_SAMPLES.setdefault(kind, [])
        samples.append((size, duration_ms))
        if len(samples) > _ETA_MAX_SAMPLES:
            samples.pop(0)


def _estimate_eta_ms(kind: str, size: int) -> Optional[int]:
    if size <= 0:
        return None
    with _ETA_LOCK:
        samples = list(_ETA_SAMPLES.get(kind) or [])
    if not samples:
        return None  # 표본 없으면 생략(대략치조차 낼 근거가 없음)
    rates = [duration / max(sz, 1) for sz, duration in samples]  # ms per byte
    avg_rate = sum(rates) / len(rates)
    return int(avg_rate * size)


def _progress_snapshot(job: dict) -> dict:
    now = dt.datetime.now()
    started = job.get("_started_at") or job.get("created_at") or now
    last_activity = job.get("_last_activity_at") or started
    elapsed_ms = max(int((now - started).total_seconds() * 1000), 0)

    usage = job.get("_usage") or {}
    usage_out = None
    if usage:
        usage_out = {
            "input_tokens": usage.get("input_tokens", 0),
            "output_tokens": usage.get("output_tokens", 0),
            "cost_usd": usage.get("cost_usd"),
        }

    eta_ms = None
    if job.get("status") == "running":
        estimate_total = _estimate_eta_ms(job.get("kind", "convert"), job.get("_input_size") or 0)
        if estimate_total is not None:
            eta_ms = max(estimate_total - elapsed_ms, 0)

    return {
        "phase": job.get("_phase") or "preparing",
        "detail": job.get("_phase_detail"),
        "elapsed_ms": elapsed_ms,
        "last_activity_at": last_activity.isoformat(),
        "usage": usage_out,
        "eta_ms": eta_ms,
    }


# ---------------------------------------------------------------------------
# 오류 처리 — 구조화 + 한도 기억 + (fallback='auto'면) 1회 자동 엔진 전환
# ---------------------------------------------------------------------------
def _handle_engine_failure(
    job_id: str, job: dict, engine: str, exc: Exception, attempted_fallback: bool
) -> bool:
    """엔진 실패를 error_info로 구조화하고 한도를 기억한다. fallback='auto'이고 priority상
    다음 available 엔진이 있으며 아직 폴백을 시도하지 않았다면 job['_engine']을 바꾸고
    True(재시도)를 반환한다. 그렇지 않으면 job['_error_info']를 채우고 False를 반환한다
    (호출부가 그대로 raise). 다음 후보는 항상 `llm.priority` 배열에서 찾는다(설계 §4.17 ③)
    — `other = "api" if engine == "cli" else "cli"` 류의 이항 분기는 두지 않는다."""
    base = llm_engine_service.classify_engine_failure(engine, exc)

    db = SessionLocal()
    try:
        error_info = llm_engine_service.build_error_info(db, engine, base)
        llm_engine_service.remember_limit(db, engine, error_info)
        fallback_policy = settings_service.get_setting(db, "llm.fallback", "ask")
    finally:
        db.close()

    llm_engine_service.record_engine_result(engine, success=False, error_kind=error_info["kind"])

    next_engine = error_info.get("fallback_engine")
    if not attempted_fallback and fallback_policy == "auto" and next_engine:
        with _JOBS_LOCK:
            job["_engine"] = next_engine
            job["_fallback_used"] = True
        return True

    with _JOBS_LOCK:
        job["_error_info"] = error_info
    return False


def _invalid_output_action(*, truncated: bool, job_kind: str) -> str:
    """`invalid_output` 안내 문구 — **실제로 제공되는 행동만** 지시한다.

    ① 엔진 교체를 권하지 않는다: API 경로의 출력 상한(`API_MAX_OUTPUT_TOKENS`)은 CLI와
       비대칭을 없애려고 맞춘 값이라 엔진을 바꿔도 잘림 한계가 넓어지지 않는다. 게다가
       이 error_info는 `fallback_available=False`라 [API로 재시도] 버튼 자체가 렌더되지
       않는다(문구와 버튼 불일치 = 오안내).
    ② 경로별 문맥: 반입(convert·fetch)은 원본 분할이 유효하지만, F30 재생성은 문서 1건
       재작성이라 "원본을 과목·회차 단위로 나눠 올리기"가 성립하지 않는다."""
    if job_kind == "regenerate":
        return (
            "재생성 요청(사유)을 더 짧고 구체적으로 적어 다시 시도해 보세요."
            if truncated
            else "재생성을 한 번 더 시도해 보세요. 반복되면 재생성 사유를 더 구체적으로 적어 보세요."
        )
    return (
        "원본을 과목·회차 단위로 나눠 올려 다시 변환해 보세요."
        if truncated
        else "같은 원본으로 다시 변환하거나, 원본을 과목·회차 단위로 나눠 올려 보세요."
    )


def _fallback_error_info(exc: Exception, *, job_kind: str = "convert") -> dict:
    """엔진 실패가 아닌 그 외 예외(JSON 파싱 실패·다운로드 오류·사이트 파싱 실패)용 error_info.

    `job_kind`는 잡 종류(convert·fetch·regenerate) — 같은 파싱 실패라도 사용자가 있는
    화면이 달라 안내 문구가 달라진다(반입 위저드 vs 문서 상세 재생성 패널)."""
    if isinstance(exc, UnsupportedFormatError):
        # S14: 첨부에 변환 가능한 PDF가 없음 — **조용한 스킵 금지**. 원본은 이미 sources/에
        # 저장했고, 포맷별 다음 행동(압축 해제·한글→PDF 변환)을 안내한다(설계 §4.13).
        # S16 검토 5(§4.18 ⑥ v1.19 확정): convert 잡(파일·URL 반입)에서 발생한 분은
        # alternatives=[] — 실패한 반입 경로 자신([파일로 반입] → 같은 화면 회귀)은
        # 대안이 아니다. fetch 잡(qnet) 발생분은 기존 기본값을 그대로 쓴다.
        alts = [] if job_kind == "convert" else exc.alternatives
        return {
            "kind": "unsupported_format",
            "limit_kind": None,
            "resets_at": None,
            "message": exc.public_message,
            "action": exc.action,
            "fallback_available": False,
            "alternatives": alts,
        }
    if isinstance(exc, AdapterServiceError):
        # S14: 쿼터 초과·서비스키 오류·토큰 만료처럼 원인과 다음 행동이 분명한 실패 —
        # "사이트 구조 변경"(parse_failed)으로 오안내하지 않는다. 원문 XML/JSON 미포함.
        return {
            "kind": "other",
            "limit_kind": None,
            "resets_at": None,
            "message": exc.public_message,
            "action": exc.action,
            "fallback_available": False,
            "alternatives": exc.alternatives,
        }
    if isinstance(exc, ParseFailedError):
        # 사이트 어댑터 파싱/수집 실패 — 원문 노출 금지, 대안 안내(설계 §4.13).
        alts = exc.alternatives or ["url_import"]
        parts = []
        if "url_import" in alts:
            parts.append("공개 자료 URL이 있다면 [URL로 반입]으로 시도하세요")
        if "other_adapter" in alts:
            parts.append("다른 어댑터로 재시도할 수 있습니다")
        action = ". ".join(parts) or "잠시 후 다시 시도하세요."
        return {
            "kind": "parse_failed",
            "limit_kind": None,
            "resets_at": None,
            "message": f"{exc.public_message} — 사이트 구조가 변경되었을 수 있습니다.",
            "action": action,
            "fallback_available": False,
            "alternatives": alts,
        }
    if isinstance(exc, InvalidLlmOutputError):
        # S13(F40-④): 출력 잘림·파싱 실패를 'other' + "잠시 후 다시 시도"로 안내하면
        # 같은 실패를 반복하며 LLM 비용만 태운다 — 전용 kind로 다음 행동을 알려준다
        # (설계 §4.11). 원문(raw)은 여기에도 담지 않는다.
        return {
            "kind": "invalid_output",
            "limit_kind": None,
            "resets_at": None,
            "message": exc.message,
            "action": _invalid_output_action(truncated=exc.truncated, job_kind=job_kind),
            "fallback_available": False,
        }
    if isinstance(exc, TooLargeError):
        # S16(F42): 추출·디코드 텍스트가 200,000자 상한 초과(xlsx 구조 상한 포함) —
        # LLM 호출 전 비용 0으로 차단한다(§4.18 ⑤). 서버측 자동 분할은 하지 않는다.
        return {
            "kind": "too_large",
            "limit_kind": None,
            "resets_at": None,
            "message": exc.public_message,
            "action": exc.action,
            "fallback_available": False,
            "alternatives": [],
        }
    if isinstance(exc, DocParseFailedError):
        # S16(F42): 판별이 docx/xlsx로 확정된 뒤의 파서 예외(암호·손상·구조 위장) — 신규
        # kind 없이 기존 'parse_failed'를 재사용한다(§4.18 ④ 경계 규칙). action은 예외가
        # 이미 "원본은 sources/에 저장했습니다." 접두를 포함한다(v1.19 확정 — unsupported와
        # 대칭). S16 검토 5: convert 잡 발생분은 alternatives=[], fetch 잡은 기존 기본값.
        alts = [] if job_kind == "convert" else ["url_import"]
        return {
            "kind": "parse_failed",
            "limit_kind": None,
            "resets_at": None,
            "message": exc.public_message,
            "action": exc.action,
            "fallback_available": False,
            "alternatives": alts,
        }
    message = exc.message if isinstance(exc, AppError) else "변환 처리 중 알 수 없는 오류가 발생했습니다."
    return {
        "kind": "other",
        "limit_kind": None,
        "resets_at": None,
        "message": message,
        "action": "잠시 후 다시 시도하세요.",
        "fallback_available": False,
    }


# ---------------------------------------------------------------------------
# 잡 큐 (convert·regenerate 공용, 동시 1개)
# ---------------------------------------------------------------------------
def _purge_expired_jobs() -> None:
    now = dt.datetime.now()
    with _JOBS_LOCK:
        stale = [jid for jid, job in _JOBS.items() if now - job["created_at"] > JOB_TTL]
        for jid in stale:
            _JOBS.pop(jid, None)


def _ensure_worker() -> None:
    global _WORKER_STARTED
    with _WORKER_LOCK:
        if not _WORKER_STARTED:
            thread = threading.Thread(target=_worker_loop, daemon=True, name="convert-worker")
            thread.start()
            _WORKER_STARTED = True


def _worker_loop() -> None:
    while True:
        job_id = _QUEUE.get()
        _process_job(job_id)


def _process_job(job_id: str) -> None:
    with _JOBS_LOCK:
        job = _JOBS.get(job_id)
    if job is None:
        return  # TTL 만료로 이미 지워졌으면 조용히 무시
    try:
        if job["kind"] == "convert":
            result = _do_convert(job_id, job)
        elif job["kind"] == "fetch":
            result = _do_fetch(job_id, job)
        else:
            result = _do_regenerate(job_id, job)
        with _JOBS_LOCK:
            job = _JOBS.get(job_id)
            if job is not None:
                job["status"] = "done"
                job["result"] = result
                now = dt.datetime.now()
                started = job.get("_started_at") or now
                _record_eta_sample(
                    job["kind"], job.get("_input_size") or 0, int((now - started).total_seconds() * 1000)
                )
    except Exception as exc:  # noqa: BLE001 - 잡 실패를 기록하고 워커는 계속 돈다
        with _JOBS_LOCK:
            job = _JOBS.get(job_id)
            if job is not None:
                job["status"] = "error"
                if isinstance(exc, (ClaudeCliError, llm_engine_service.ApiEngineError, codex_adapter.CodexCliError)):
                    # 엔진 원문(CLI stderr·anthropic 예외 문자열)은 error_info로만 노출한다.
                    job["error"] = None
                elif isinstance(
                    exc, (AdapterServiceError, ParseFailedError, TooLargeError, DocParseFailedError)
                ):
                    # S14: 원인이 분명한 수집 실패(포맷 비지원·쿼터·키·구조 변경).
                    # S16: 판별·추출 계층 구조화 실패(too_large·docx/xlsx 파서 예외) —
                    # error_info가 사람 말로 안내하므로 traceback을 남기지 않는다.
                    job["error"] = None
                elif isinstance(exc, AppError):
                    # SSRF 차단·JSON 파싱 실패 등 이미 안전한 한국어 메시지는 그대로 보존.
                    job["error"] = exc.message
                else:
                    # 미분류 예외 — UI에는 일반 메시지만 가지만, 원인 추적을 위해
                    # 서버 콘솔에는 traceback을 남긴다(미로깅 시 원인 파악 불가).
                    job["error"] = None
                    _LOGGER.exception("잡 %s(%s) 처리 중 미분류 예외", job_id, job.get("kind"))
                if job.get("_error_info") is None:
                    job["_error_info"] = _fallback_error_info(
                        exc, job_kind=job.get("kind") or "convert"
                    )
    finally:
        tmp_path = job.get("_tmp_path") if job else None
        if tmp_path:
            Path(tmp_path).unlink(missing_ok=True)
        # S16(F42 §4.18 ③): cp949 CLI 재인코딩 tmp 등 부가 파생물 정리.
        for extra in (job.get("_extra_tmp_paths") or []) if job else []:
            Path(extra).unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# 변환(F23·F34·F35-1) — 파일 업로드/URL → LLM 엔진 → 반입 preview로 자동 연결
# ---------------------------------------------------------------------------
def _build_convert_prompt_cli(convert_md: str, tmp_path: Path) -> str:
    return (
        f"{convert_md}\n\n---\n\n"
        "## 이번 변환 대상\n"
        f"다음 경로의 원본 파일을 위 지시(§0~§8)에 따라 반입 JSON으로 변환하라.\n"
        f"파일 경로: {tmp_path.resolve()}\n"
        "Read 도구로 파일을 직접 읽어 내용을 파악하라(PDF·이미지 포함). "
        "최종 출력은 설명 문장·코드펜스 없이 순수 JSON 객체 하나만 출력하라."
    )


def _build_convert_prompt_api(
    convert_md: str, tmp_path: Path, *, group: str, file_type: str
) -> Tuple[str, List[dict]]:
    """`group`·`file_type`은 판별 계층(§4.18 ①②③) 결과 — `_api_content_blocks_for_file`이
    확장자 재분기 없이 그대로 쓴다(pdf/image 전용 호출, 검토 적발 수정)."""
    blocks = _api_content_blocks_for_file(tmp_path, group=group, file_type=file_type)
    prompt_text = (
        f"{convert_md}\n\n---\n\n"
        "## 이번 변환 대상\n"
        f"원본 파일명: {tmp_path.name}\n"
        "이 메시지에 원본 파일 내용을 함께 첨부했다(도구 호출 없이 첨부 내용만으로 판단하라). "
        "위 지시(§0~§8)에 따라 반입 JSON으로 변환하라. "
        "최종 출력은 설명 문장·코드펜스 없이 순수 JSON 객체 하나만 출력하라."
    )
    return prompt_text, blocks


def _build_convert_prompt_codex(convert_md: str, tmp_path: Path, *, group: Optional[str] = None) -> str:
    """codex-cli 전용 — G2 실증(2026-07-28)에 따라 원본을 pypdf로 추출한 텍스트를 프롬프트에
    직접 삽입한다(직접 PDF 읽기는 샌드박스 제약으로 재현 불안정 — 설계 §4.17 ④). 추출은
    `codex_adapter.build_text_for_prompt`가 담당(중복 구현 금지).

    `group`은 판별 계층(§4.18 ①②③) 결과 — 지정되면 확장자 재분기 없이 pdf/image 여부를
    가른다(검토 적발 수정). 미지정이면 `build_text_for_prompt`가 확장자로 판별한다."""
    extracted = codex_adapter.build_text_for_prompt(tmp_path, group=group)
    return (
        f"{convert_md}\n\n---\n\n"
        "## 이번 변환 대상 — 추출된 원본 텍스트\n"
        f"원본 파일명: {tmp_path.name}\n"
        "아래는 원본에서 추출한 텍스트다(PDF는 페이지 구분자 '--- page N ---' 포함 — 추출 "
        "과정에서 레이아웃이 깨졌을 수 있으니 문맥으로 보정해 읽어라). 파일을 직접 열지 말고 "
        "이 텍스트만으로 판단하라.\n\n"
        f"{extracted}\n\n"
        "위 지시(§0~§8)에 따라 반입 JSON으로 변환하라. "
        "최종 출력은 설명 문장·코드펜스 없이 순수 JSON 객체 하나만 출력하라."
    )


def _run_codex_streaming(prompt: str, *, timeout_seconds: int, job_id: str) -> str:
    return codex_adapter.run_exec(
        prompt,
        cwd=BASE_DIR,
        timeout_seconds=timeout_seconds,
        on_activity=lambda: _touch_activity(job_id),
    )


# ---------------------------------------------------------------------------
# S16(F42) — A군(codex·api 전체 + CLI cp949)·B군(3엔진 공통) 프롬프트: 판별·추출된
# 텍스트를 파일 경로가 아니라 프롬프트 본문에 직접 삽입한다(§4.18 ①③④ — Claude Code
# Read는 docx/xlsx를 못 읽고, cp949는 Read가 utf-8 전제라 그대로 넘기면 깨진다).
# ---------------------------------------------------------------------------
def _build_embedded_text_prompt(convert_md: str, filename: str, text: str) -> str:
    return (
        f"{convert_md}\n\n---\n\n"
        "## 이번 변환 대상 — 추출된 원본 텍스트\n"
        f"원본 파일명: {filename}\n"
        "아래는 원본에서 그대로 추출·디코드한 텍스트다. 파일을 직접 열지 말고 "
        "이 텍스트만으로 판단하라.\n\n"
        f"{text}\n\n"
        "위 지시(§0~§8)에 따라 반입 JSON으로 변환하라. "
        "최종 출력은 설명 문장·코드펜스 없이 순수 JSON 객체 하나만 출력하라."
    )


def _build_embedded_text_prompt_api(convert_md: str, filename: str, text: str) -> Tuple[str, List[dict]]:
    prompt_text = (
        f"{convert_md}\n\n---\n\n"
        "## 이번 변환 대상\n"
        f"원본 파일명: {filename}\n"
        "이 메시지에 원본에서 그대로 추출·디코드한 텍스트를 함께 첨부했다(도구 호출 없이 "
        "첨부 내용만으로 판단하라). 위 지시(§0~§8)에 따라 반입 JSON으로 변환하라. "
        "최종 출력은 설명 문장·코드펜스 없이 순수 JSON 객체 하나만 출력하라."
    )
    blocks = [{"type": "text", "text": f"\n\n## 원본 파일 내용 ({filename})\n\n{text}\n"}]
    return prompt_text, blocks


def _ensure_cli_recoded_tmp(job_id: str, job: dict, source_filename: str, text: str) -> Path:
    """cp949 판별 파일을 CLI 엔진에 넘길 utf-8 재인코딩 tmp — **CLI가 실제로 선택된
    시점에만** 지연 생성한다(S16 검토 9: codex·api는 `detected.text`를 직접 쓰므로
    불필요한 파일을 만들지 않는다). 폴백으로 CLI를 여러 번 재시도해도 잡당 1회만 만들고
    캐시된 경로를 재사용한다. sources/ 원본은 원 바이트 그대로 불변(재인코딩은 파생물뿐,
    §4.18 ③)."""
    with _JOBS_LOCK:
        cached = job.get("_cli_recoded_path")
    if cached:
        return Path(cached)
    recoded_path = _write_tmp_file(job_id, f"utf8_{source_filename}", text.encode("utf-8"))
    with _JOBS_LOCK:
        job["_extra_tmp_paths"] = list(job.get("_extra_tmp_paths") or []) + [str(recoded_path)]
        job["_cli_recoded_path"] = str(recoded_path)
    return recoded_path


def _do_convert(job_id: str, job: dict) -> dict:
    if job.get("_url"):
        _set_phase(job_id, "downloading", job["_url"])
        filename, data, _content_type = _download_source_url(
            job["_url"], on_activity=lambda: _touch_activity(job_id)
        )
        tmp_path = _write_tmp_file(job_id, filename, data)
        with _JOBS_LOCK:
            job["_tmp_path"] = str(tmp_path)
            job["_source_filename"] = filename
            job["_source_bytes"] = data
            job["_input_size"] = len(data)

    _set_phase(job_id, "preparing")
    convert_md = CONVERT_PROMPT_PATH.read_text(encoding="utf-8")
    tmp_path = Path(job["_tmp_path"]) if job.get("_tmp_path") else None
    if tmp_path is None:
        raise ValidationAppError("변환할 원본 파일이 없습니다")

    source_bytes = job.get("_source_bytes")
    if source_bytes is None:
        source_bytes = tmp_path.read_bytes()
    source_filename = job.get("_source_filename") or tmp_path.name

    # S16(F42): 반입 파일 판별(§4.18 ①②③) — 미지원·판별 불가·상한 초과는 여기서 예외로
    # 종료된다(조용한 스킵 금지). 통과분만 아래에서 프롬프트로 조립된다.
    detected = _detect_import_format(source_filename, source_bytes)
    with _JOBS_LOCK:
        if detected.notes:
            job["_notes"] = list(job.get("_notes") or []) + detected.notes
        # S16 검토 8: LLM 사용량 사전 안내(ETA 표본)를 텍스트 기준으로 정확화 — A·B군은
        # 실제 LLM에 들어가는 추출·디코드 텍스트 길이, pdf·image는 기존대로 원본 바이트.
        job["_input_size"] = _detection_input_size(detected, job.get("_input_size") or 0)

    # S13(F40-③): 사용자가 지정한 분류 경로가 있으면 사이트 반입과 **같은 지시 생성기**로
    # "suggest_categories는 정확히 이 경로 하나로 고정" 지시를 붙인다(설계 §4.11).
    directives = _manual_category_directives(job.get("_category_path"))
    suffix = f"\n\n{directives}" if directives else ""

    attempted_fallback = False
    text_result: Optional[str] = None
    while True:
        engine = job["_engine"]
        _set_phase(job_id, "llm_running")
        try:
            if engine == llm_engine_service.ENGINE_CLAUDE_CLI:
                # B군(docx/xlsx)은 Read 도구로 못 읽으므로 3엔진 공통으로 추출 텍스트를
                # 프롬프트에 직접 삽입한다(§4.18 ④) — A군은 기존대로 파일 경로 전달.
                if detected.group in ("docx", "xlsx"):
                    prompt = _build_embedded_text_prompt(convert_md, source_filename, detected.text) + suffix
                else:
                    # cp949 재인코딩 tmp는 CLI가 **실제로 선택됐을 때만** 만든다(codex·api는
                    # detected.text를 직접 쓰므로 불필요 — S16 검토 9, 지연 생성 + 캐시).
                    cli_path = tmp_path
                    if detected.group == "text" and detected.encoding == "cp949":
                        cli_path = _ensure_cli_recoded_tmp(job_id, job, source_filename, detected.text)
                    prompt = _build_convert_prompt_cli(convert_md, cli_path) + suffix
                text_result = _run_claude_cli_streaming(prompt, timeout_seconds=job["_timeout"], job_id=job_id)
            elif engine == llm_engine_service.ENGINE_CODEX_CLI:
                # codex는 A·B군 모두 판별된 텍스트를 그대로 삽입한다(pdf만 기존 pypdf 경로).
                if detected.group in ("text", "docx", "xlsx"):
                    prompt = _build_embedded_text_prompt(convert_md, source_filename, detected.text) + suffix
                else:
                    prompt = _build_convert_prompt_codex(convert_md, tmp_path, group=detected.group) + suffix
                text_result = _run_codex_streaming(prompt, timeout_seconds=job["_timeout"], job_id=job_id)
            else:
                if detected.group in ("text", "docx", "xlsx"):
                    prompt_text, blocks = _build_embedded_text_prompt_api(convert_md, source_filename, detected.text)
                else:
                    prompt_text, blocks = _build_convert_prompt_api(
                        convert_md, tmp_path, group=detected.group, file_type=detected.file_type
                    )
                text_result = _run_api_streaming(
                    prompt_text + suffix,
                    file_blocks=blocks,
                    timeout_seconds=job["_timeout"],
                    job_id=job_id,
                    model=job.get("_api_model") or llm_engine_service.DEFAULT_API_MODEL,
                )
            llm_engine_service.record_engine_result(engine, success=True)
            break
        except (ClaudeCliError, llm_engine_service.ApiEngineError, codex_adapter.CodexCliError) as exc:
            if _handle_engine_failure(job_id, job, engine, exc, attempted_fallback):
                attempted_fallback = True
                continue
            raise

    _set_phase(job_id, "parsing")
    payload = _parse_json_payload(text_result)
    json_bytes = json.dumps(payload, ensure_ascii=False).encode("utf-8")

    _set_phase(job_id, "preview_building")
    # S16: 이 잡의 판별·추출 결과가 곧 원문 대조 소재다(§4.17 ⑥ 재사용) — A군(cp949 포함)·
    # B군(docx/xlsx)은 `create_preview`가 다시 추출하지 않도록 잡당 계산한 텍스트를 그대로
    # 넘긴다(pdf·image·utf-8 텍스트는 기존대로 create_preview가 자체 추출).
    source_text_for_match = detected.text if detected.group in ("text", "docx", "xlsx") else None
    db = SessionLocal()
    try:
        preview: PreviewResponse = import_service.create_preview(
            db,
            json_bytes=json_bytes,
            source_filename=job.get("_source_filename"),
            source_bytes=job.get("_source_bytes"),
            # S13(F40-①): LLM 비용을 치른 산출 JSON을 import/auto/에 보존해
            # TTL 만료·서버 재시작 뒤에도 복구할 수 있게 한다(설계 §4.3).
            preserve=True,
            # S15(F41): 변환 파이프라인 산출물 — 신뢰 게이트(원문 대조·answer_source)와
            # §8.2 v1.1 강화 검증을 적용한다(설계 §4.17 ⑤·⑥).
            gate=True,
            strict=True,
            source_text=source_text_for_match,
        )
    finally:
        db.close()
    return {"result_preview_id": preview.preview_id}


# ---------------------------------------------------------------------------
# 사이트 반입(F35-2, 설계 §4.13) — 어댑터 수집 → (파일 또는 구조화 문항) → convert 재사용
# ---------------------------------------------------------------------------
SOURCES_DIR = BASE_DIR / "sources"
SOURCES_IMAGES_DIR = SOURCES_DIR / "images"


def _fetch_category_path(cert_name: Optional[str], level_hint: str, exam_key: Optional[str]) -> Optional[str]:
    """어댑터 확정 분류 경로 '{자격증}/{필기|실기}/{회차 폴더}' — 프롬프트에 강제 지시.

    키→폴더명 파생은 `fetch_service.exam_folder_name`과 단일 공유(설계 §4.13 — 불일치 금지).
    `YYYY-N`(회차 번호) → "YYYY년 N회", `YYYY-MM-DD`(S12 날짜형) → "YYYY년 M월 D일"."""
    if not cert_name or not exam_key:
        return None
    folder = fetch_service.exam_folder_name(exam_key)
    if not folder:
        return None
    return f"{cert_name}/{level_hint}/{folder}"


def _category_directive_lines(
    category_path: Optional[str], source_label: Optional[str]
) -> List[str]:
    """분류 경로·source_detail 지시 문자열 **단일 생성기** (설계 §4.11 F40-③ / §4.13).

    사이트 반입(`_fetch_directives`)과 파일·URL 반입(`category_path` 파라미터)이 이 함수를
    공유한다 — 중복 구현 금지. 경로는 정확히 1건으로 고정 지시하며, 경로 문자열은
    json.dumps로 escape해 프롬프트 안의 JSON 표기를 깨뜨리지 않는다."""
    lines: List[str] = []
    if category_path:
        lines.append(
            f"- 모든 문항의 `suggest_categories`는 정확히 "
            f"{json.dumps([category_path], ensure_ascii=False)}로 고정하라(다른 경로 추가 금지)."
        )
    label = (source_label or "").strip()
    lines.append(
        '- 각 문항의 `source_detail`은 "'
        + (label[:40] if label else "해당 회차")
        + ' M번" 형식으로(M=문항 번호) 채우라.'
    )
    return lines


def _fetch_directives(fetched, *, cli: bool) -> str:
    """수집 결과 메타를 반입 JSON 규격에 반영하도록 LLM에 강제 지시(설계 §4.13)."""
    cat_path = _fetch_category_path(
        getattr(fetched, "cert_name", None),
        getattr(fetched, "level_hint", "필기"),
        getattr(fetched, "exam_key", None),
    )
    exam_label = getattr(fetched, "exam_label", None) or ""
    note = getattr(fetched, "note", None) or ""
    lines = [
        "## 사이트 반입 — 추가 지시(엄수)",
        "이 원본은 자격증 기출 한 회차다. 각 문항을 반입 JSON 문서(type: past_question)로 만들라.",
    ]
    lines.extend(_category_directive_lines(cat_path, exam_label))
    if note:
        lines.append(f'- 최상위 `source.note`는 정확히 "{note}"로 채우라.')
    lines.append("- 보기·정답·해설이 원본에 있으면 반드시 포함하고, 없는 정보를 지어내지 마라.")
    lines.append("- 그림/이미지가 본문에 Markdown 링크로 있으면 그대로 보존하라.")
    if isinstance(fetched, FetchedExam) and any(getattr(q, "subject", None) for q in fetched.questions):
        lines.append(
            "- 원본에 \"과목: …\" 줄이 있으면 그 과목명을 해당 문항의 `tags`에 태그로 제안하라"
            "(분류 경로는 위 회차 경로 고정 — 과목별 하위 분류는 만들지 마라)."
        )
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# 분류 경로 미리 지정 (S13 F40-③, 설계 §4.11 `category_path?`)
# ---------------------------------------------------------------------------
CATEGORY_PATH_MAX_DEPTH = 5
CATEGORY_PATH_MAX_SEGMENT = 60


def normalize_category_path(raw: Optional[str]) -> Optional[str]:
    """`category_path` 검증·정규화 — 최대 5단계·단계당 60자·앞뒤 공백 정리·빈 단계 금지.
    미지정(None·공백)은 None을 반환해 기존 동작(LLM 추론)을 그대로 둔다. 위반은 422."""
    if raw is None:
        return None
    text = raw.strip()
    if not text:
        return None
    segments: List[str] = []
    for seg in text.split("/"):
        clean = seg.strip()
        if not clean:
            raise ValidationAppError(
                "분류 경로에 빈 단계가 있습니다(예: 품질경영기사/필기/2022년 2회)",
                detail={"category_path": raw},
            )
        if len(clean) > CATEGORY_PATH_MAX_SEGMENT:
            raise ValidationAppError(
                f"분류 경로의 각 단계는 {CATEGORY_PATH_MAX_SEGMENT}자 이하여야 합니다",
                detail={"category_path": raw, "segment": clean[:80]},
            )
        segments.append(clean)
    if len(segments) > CATEGORY_PATH_MAX_DEPTH:
        raise ValidationAppError(
            f"분류 경로는 최대 {CATEGORY_PATH_MAX_DEPTH}단계까지 지정할 수 있습니다",
            detail={"category_path": raw, "depth": len(segments)},
        )
    return "/".join(segments)


def _manual_category_directives(category_path: Optional[str]) -> Optional[str]:
    """파일·URL 반입에서 사용자가 지정한 분류 경로를 프롬프트에 고정 지시로 붙인다.

    **자동 반입이 아니다**(R7) — preview의 분류 제안을 고정할 뿐, 확정은 사용자 승인이며
    없는 경로는 기존 commit의 누락 노드 생성 계약(`exists:false` → 승인 시 생성) 그대로다."""
    if not category_path:
        return None
    label = category_path.split("/")[-1]
    lines = ["## 분류 경로 — 추가 지시(엄수)"]
    lines.extend(_category_directive_lines(category_path, label))
    return "\n".join(lines)


def _save_fetch_images(job_id: str, questions, client) -> None:
    """FetchedExam 그림 문제 이미지: 어댑터 스로틀로 다운로드 → sources/images/ 저장 →
    각 문항.images를 로컬 Markdown 경로로 치환(원본 불변 규칙 — 새 파일만 생성)."""
    SOURCES_IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    for q in questions:
        local_links: List[str] = []
        for url in list(q.images or []):
            try:
                data, ctype, _name = client.get_bytes(url)
            except Exception:  # noqa: BLE001 - 이미지 하나 실패가 회차 전체를 막지 않는다
                continue
            ext = {
                "image/png": "png",
                "image/jpeg": "jpg",
                "image/gif": "gif",
                "image/webp": "webp",
            }.get((ctype or "").lower(), "png")
            digest = hashlib.sha256(data).hexdigest()[:16]
            fname = f"{digest}.{ext}"
            path = SOURCES_IMAGES_DIR / fname
            if not path.exists():
                path.write_bytes(data)
            local_links.append(f"/images/{fname}")  # 절대 경로 — main.py GET /images/{filename}가 서빙
            _touch_activity(job_id)
        q.images = local_links


def _fetched_exam_to_text(fetched: FetchedExam) -> str:
    """구조화 문항 배열을 LLM 프롬프트용 구조화 텍스트로 직렬화."""
    parts = [f"# {fetched.cert_name} {fetched.exam_label} ({fetched.exam_key})", ""]
    for q in fetched.questions:
        parts.append(f"## {q.no}번")
        if q.subject:  # S12 — 과목 구분(태그 제안 소재)
            parts.append(f"과목: {q.subject}")
        parts.append(q.stem)
        for i, choice in enumerate(q.choices, start=1):
            parts.append(f"{i}) {choice}")
        for link in q.images or []:
            parts.append(f"![그림]({link})")
        if q.answer:
            parts.append(f"정답: {q.answer}")
        if q.explanation:
            parts.append(f"해설: {q.explanation}")
        parts.append("")
    return "\n".join(parts)


def _do_fetch(job_id: str, job: dict) -> dict:
    from services.fetchers import registry as fetch_registry

    _set_phase(job_id, "fetching", job.get("_fetch_source_url"))
    adapter = fetch_registry.get_adapter(job["_adapter_id"])
    if adapter is None:
        raise ParseFailedError("등록되지 않은 어댑터입니다", detail={"adapter": job["_adapter_id"]})
    client = fetch_registry.new_client(on_activity=lambda: _touch_activity(job_id))
    fetched = adapter.fetch_exam(
        job["_cert_ref"], job["_exam_ref"], client, on_activity=lambda: _touch_activity(job_id)
    )
    exam_key_override = job.get("_exam_key_override")
    if exam_key_override:
        # fetch/exams가 반환한 키로 덮어써 목록 표기·분류 경로·imported 판정을 일치시킨다
        # (설계 §4.13 — S13 단일 어댑터에서는 목록 키와 수집 키가 같아 사실상 항등 전달이지만,
        # 계약·프론트 호출 형태를 유지하기 위해 파라미터를 남긴다).
        fetched.exam_key = exam_key_override

    convert_md = CONVERT_PROMPT_PATH.read_text(encoding="utf-8")

    if isinstance(fetched, FetchedFile):
        _set_phase(job_id, "preparing")
        tmp_path = _write_tmp_file(job_id, fetched.filename, fetched.data)
        # S16(F42 §4.18 ②-4 v1.19): file_mode 대표 파일도 convert와 같은 단일 판별 게이트를
        # 통과한다 — qnet은 현재 항상 PDF만 넘기므로(어댑터 자체 `_magic_ok` 선행 검사)
        # 실동작 변화는 없지만, 판별 계층이 전 경로 공통이 되도록 구조를 완성한다. 여기서
        # 발생하는 예외는 job_kind='fetch'로 분류돼 §4.11 alternatives 기존 기본값을 그대로
        # 쓴다(§4.18 ⑥ v1.19의 `alternatives=[]` 특례는 convert 잡 한정 — 건드리지 않는다).
        detected = _detect_import_format(fetched.filename, fetched.data)
        with _JOBS_LOCK:
            # S14: 대표 파일 외 원본 확보 소표기(예: 도면 묶음 ZIP) — 성공 응답의 notes.
            job["_notes"] = list(getattr(fetched, "extra_notes", []) or []) + list(detected.notes)
            job["_tmp_path"] = str(tmp_path)
            job["_source_filename"] = fetched.filename
            job["_source_bytes"] = fetched.data
            # S16 검토 8: 추출 텍스트가 있으면(text/docx/xlsx) 그 길이를, 없으면(pdf/image —
            # qnet 실사용 경로) 원본 바이트 길이를 ETA 표본 기준으로 쓴다.
            job["_input_size"] = _detection_input_size(detected, len(fetched.data))
        directives = _fetch_directives(fetched, cli=job["_engine"] == llm_engine_service.ENGINE_CLAUDE_CLI)
        file_mode = True
        # 판별 계층이 이미 텍스트를 갖고 있으면(text/docx/xlsx) 재추출 없이 그대로 원문
        # 대조 소재로 쓴다(§4.17 ⑥) — pdf/image는 기존대로 create_preview가 자체 추출.
        source_text_for_match = detected.text if detected.group in ("text", "docx", "xlsx") else None
    elif isinstance(fetched, FetchedExam):
        _set_phase(job_id, "fetching", "이미지 다운로드")
        _save_fetch_images(job_id, fetched.questions, client)
        _set_phase(job_id, "preparing")
        structured = _fetched_exam_to_text(fetched)
        directives = _fetch_directives(fetched, cli=False) + "\n\n## 원본(구조화 텍스트)\n\n" + structured
        with _JOBS_LOCK:
            job["_input_size"] = len(structured.encode("utf-8"))
        file_mode = False
        # S15: 이 경로는 원본 파일이 없다 — 어댑터가 만든 구조화 텍스트가 곧 원본이므로
        # 그대로 원문 대조 소재로 넘긴다(설계 §4.17 ⑥).
        source_text_for_match = structured
    else:  # pragma: no cover - 인터페이스 위반
        raise ParseFailedError("어댑터가 알 수 없는 결과를 반환했습니다")

    attempted_fallback = False
    text_result: Optional[str] = None
    while True:
        engine = job["_engine"]
        _set_phase(job_id, "llm_running")
        try:
            if file_mode:
                tmp_path = Path(job["_tmp_path"])
                # S16(F42 §4.18 ②-4): 판별 계층(`detected`) 결과로 pdf/image를 가른다 —
                # 확장자 재분기 없음(단일 게이트). qnet은 현재 항상 pdf만 이 경로에 온다.
                if engine == llm_engine_service.ENGINE_CLAUDE_CLI:
                    prompt = _build_convert_prompt_cli(convert_md, tmp_path) + "\n\n" + directives
                    text_result = _run_claude_cli_streaming(prompt, timeout_seconds=job["_timeout"], job_id=job_id)
                elif engine == llm_engine_service.ENGINE_CODEX_CLI:
                    prompt = (
                        _build_convert_prompt_codex(convert_md, tmp_path, group=detected.group)
                        + "\n\n"
                        + directives
                    )
                    text_result = _run_codex_streaming(prompt, timeout_seconds=job["_timeout"], job_id=job_id)
                else:
                    prompt_text, blocks = _build_convert_prompt_api(
                        convert_md, tmp_path, group=detected.group, file_type=detected.file_type
                    )
                    text_result = _run_api_streaming(
                        prompt_text + "\n\n" + directives,
                        file_blocks=blocks,
                        timeout_seconds=job["_timeout"],
                        job_id=job_id,
                        model=job.get("_api_model") or llm_engine_service.DEFAULT_API_MODEL,
                    )
            else:
                prompt = f"{convert_md}\n\n---\n\n{directives}\n\n최종 출력은 순수 JSON 객체 하나만."
                if engine == llm_engine_service.ENGINE_CLAUDE_CLI:
                    text_result = _run_claude_cli_streaming(prompt, timeout_seconds=job["_timeout"], job_id=job_id)
                elif engine == llm_engine_service.ENGINE_CODEX_CLI:
                    text_result = _run_codex_streaming(prompt, timeout_seconds=job["_timeout"], job_id=job_id)
                else:
                    text_result = _run_api_streaming(
                        prompt,
                        file_blocks=None,
                        timeout_seconds=job["_timeout"],
                        job_id=job_id,
                        model=job.get("_api_model") or llm_engine_service.DEFAULT_API_MODEL,
                    )
            llm_engine_service.record_engine_result(engine, success=True)
            break
        except (ClaudeCliError, llm_engine_service.ApiEngineError, codex_adapter.CodexCliError) as exc:
            if _handle_engine_failure(job_id, job, engine, exc, attempted_fallback):
                attempted_fallback = True
                continue
            raise

    _set_phase(job_id, "parsing")
    payload = _parse_json_payload(text_result)
    json_bytes = json.dumps(payload, ensure_ascii=False).encode("utf-8")

    _set_phase(job_id, "preview_building")
    db = SessionLocal()
    try:
        preview: PreviewResponse = import_service.create_preview(
            db,
            json_bytes=json_bytes,
            source_filename=job.get("_source_filename"),
            source_bytes=job.get("_source_bytes"),
            # S13(F40-①): LLM 비용을 치른 산출 JSON을 import/auto/에 보존해
            # TTL 만료·서버 재시작 뒤에도 복구할 수 있게 한다(설계 §4.3).
            preserve=True,
            # S15(F41): 사이트 반입도 같은 변환 파이프라인 — 신뢰 게이트 공통 적용
            # (설계 §4.17 ⑤·⑥ "전 엔진·전 경로 공통").
            gate=True,
            strict=True,
            source_text=source_text_for_match,
        )
    finally:
        db.close()
    return {"result_preview_id": preview.preview_id}


def start_fetch_job(
    *,
    db: Session,
    adapter_id: str,
    cert_ref: str,
    exam_ref: str,
    source_url: Optional[str] = None,
    engine: str = "auto",
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
    exam_key: Optional[str] = None,
) -> str:
    """사이트 반입 잡(kind='fetch') 시작 — convert 잡 큐 재사용(동시 1개). 진행·결과 조회는
    기존 `GET /api/convert/{job_id}`. phase는 'fetching'부터 시작한다(설계 §4.13)."""
    from services.fetchers import registry as fetch_registry

    _purge_expired_jobs()
    if not CONVERT_PROMPT_PATH.exists():
        raise ValidationAppError(
            "prompts/convert.md 프롬프트 파일을 찾을 수 없습니다", detail={"path": str(CONVERT_PROMPT_PATH)}
        )
    if fetch_registry.get_adapter(adapter_id) is None:
        raise ValidationAppError("등록되지 않은 어댑터입니다", detail={"adapter": adapter_id})
    if not cert_ref or not exam_ref:
        raise ValidationAppError("cert_ref·exam_ref가 필요합니다")

    resolved_engine = llm_engine_service.resolve_engine(db, engine)
    applied_engine = llm_engine_service.apply_remembered_limit(db, resolved_engine)
    pre_fallback = applied_engine != resolved_engine
    resolved_engine = applied_engine
    api_model = settings_service.get_setting(db, "llm.api_model", llm_engine_service.DEFAULT_API_MODEL)

    job_id = f"ftc_{uuid.uuid4().hex[:8]}"
    job = _new_job_base("fetch", resolved_engine=resolved_engine, requested_engine=engine, api_model=api_model)
    if pre_fallback:
        job["_fallback_used"] = True
    job.update(
        {
            "_timeout": timeout_seconds,
            "_adapter_id": adapter_id,
            "_cert_ref": cert_ref,
            "_exam_ref": exam_ref,
            "_fetch_source_url": source_url,
            "_exam_key_override": exam_key,
            "_phase": "fetching",
            "_phase_detail": source_url,
        }
    )
    with _JOBS_LOCK:
        _JOBS[job_id] = job
    _ensure_worker()
    _QUEUE.put(job_id)
    return job_id


def _new_job_base(kind: str, *, resolved_engine: str, requested_engine: str, api_model: str) -> dict:
    now = dt.datetime.now()
    return {
        "kind": kind,
        "status": "running",
        "created_at": now,
        "document_id": None,
        "result": None,
        "error": None,
        "_timeout": DEFAULT_TIMEOUT_SECONDS,
        "_tmp_path": None,
        "_url": None,
        "_source_filename": None,
        "_source_bytes": None,
        "_engine": resolved_engine,
        "_engine_requested": requested_engine,
        "_fallback_used": False,
        "_api_model": api_model,
        "_input_size": 0,
        "_started_at": now,
        "_last_activity_at": now,
        "_phase": "preparing",
        "_phase_detail": None,
        "_usage": {"input_tokens": 0, "output_tokens": 0, "cost_usd": None},
        "_error_info": None,
        "_category_path": None,  # S13(F40-③) — 파일·URL 반입의 분류 경로 고정 지시
        "_notes": [],  # S14 — 성공 결과 소표기(사이트 반입에서 함께 저장한 원본 등)
        "_extra_tmp_paths": [],  # S16(F42) — cp949 CLI 재인코딩 tmp 등 부가 파생물(정리 대상)
        "_cli_recoded_path": None,  # S16(F42) — cp949 CLI 재인코딩 tmp 캐시(잡당 1회 생성)
    }


def start_convert_job(
    *,
    db: Session,
    upload_filename: str,
    upload_bytes: bytes,
    engine: str = "auto",
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
    category_path: Optional[str] = None,
) -> str:
    _purge_expired_jobs()
    category_path = normalize_category_path(category_path)
    if not CONVERT_PROMPT_PATH.exists():
        raise ValidationAppError(
            "prompts/convert.md 프롬프트 파일을 찾을 수 없습니다",
            detail={"path": str(CONVERT_PROMPT_PATH)},
        )
    resolved_engine = llm_engine_service.resolve_engine(db, engine)
    applied_engine = llm_engine_service.apply_remembered_limit(db, resolved_engine)
    pre_fallback = applied_engine != resolved_engine
    resolved_engine = applied_engine
    api_model = settings_service.get_setting(db, "llm.api_model", llm_engine_service.DEFAULT_API_MODEL)

    CONVERT_TMP_DIR.mkdir(exist_ok=True)
    job_id = f"cvt_{uuid.uuid4().hex[:8]}"
    tmp_path = CONVERT_TMP_DIR / f"{job_id}_{_safe_name(upload_filename)}"
    tmp_path.write_bytes(upload_bytes)

    job = _new_job_base("convert", resolved_engine=resolved_engine, requested_engine=engine, api_model=api_model)
    if pre_fallback:
        job["_fallback_used"] = True  # 사전 자동 전환 — 런타임 재전환(원 엔진 복귀) 낭비 방지
    job.update(
        {
            "_timeout": timeout_seconds,
            "_source_filename": upload_filename,
            "_source_bytes": upload_bytes,
            "_tmp_path": str(tmp_path),
            "_input_size": len(upload_bytes),
            "_category_path": category_path,
        }
    )
    with _JOBS_LOCK:
        _JOBS[job_id] = job
    _ensure_worker()
    _QUEUE.put(job_id)
    return job_id


def start_convert_job_from_url(
    *,
    db: Session,
    url: str,
    engine: str = "auto",
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
    category_path: Optional[str] = None,
) -> str:
    """URL 반입(F35 1단계) — 다운로드도 워커에서 수행(요청 스레드 블로킹 금지),
    phase='downloading'부터 잡으로 처리한다."""
    _purge_expired_jobs()
    category_path = normalize_category_path(category_path)
    if not CONVERT_PROMPT_PATH.exists():
        raise ValidationAppError(
            "prompts/convert.md 프롬프트 파일을 찾을 수 없습니다",
            detail={"path": str(CONVERT_PROMPT_PATH)},
        )
    if not url or not url.strip():
        raise ValidationAppError("url이 비어 있습니다")
    resolved_engine = llm_engine_service.resolve_engine(db, engine)
    applied_engine = llm_engine_service.apply_remembered_limit(db, resolved_engine)
    pre_fallback = applied_engine != resolved_engine
    resolved_engine = applied_engine
    api_model = settings_service.get_setting(db, "llm.api_model", llm_engine_service.DEFAULT_API_MODEL)

    job_id = f"cvt_{uuid.uuid4().hex[:8]}"
    job = _new_job_base("convert", resolved_engine=resolved_engine, requested_engine=engine, api_model=api_model)
    if pre_fallback:
        job["_fallback_used"] = True
    job.update(
        {
            "_timeout": timeout_seconds,
            "_url": url.strip(),
            "_phase": "downloading",
            "_phase_detail": url.strip(),
            "_category_path": category_path,
        }
    )
    with _JOBS_LOCK:
        _JOBS[job_id] = job
    _ensure_worker()
    _QUEUE.put(job_id)
    return job_id


def get_convert_job(job_id: str) -> dict:
    _purge_expired_jobs()
    with _JOBS_LOCK:
        job = _JOBS.get(job_id)
        # 사이트 반입(kind='fetch')도 같은 규격으로 이 엔드포인트에서 조회한다(설계 §4.13).
        if job is None or job["kind"] not in ("convert", "fetch"):
            raise NotFoundError(
                "변환 작업을 찾을 수 없습니다(만료되었을 수 있습니다)", detail={"job_id": job_id}
            )
        result = job.get("result") or {}
        return {
            "job_id": job_id,
            "status": job["status"],
            "result_preview_id": result.get("result_preview_id"),
            # S14: 부가 안내(사이트 반입에서 대표 외 원본도 저장한 경우). 기본은 빈 배열.
            "notes": list(job.get("_notes") or []),
            "error": job.get("error"),
            "error_info": job.get("_error_info"),
            "progress": _progress_snapshot(job),
        }


# ---------------------------------------------------------------------------
# 재생성(F30) — 문제 오류 신고 → 해당 문서만 재생성 초안 → 비교 → 승인 교체
# ---------------------------------------------------------------------------
def _build_regenerate_prompt(
    document: models.Document,
    tags: List[str],
    choices: Optional[List[str]],
    reason: str,
    source_note: Optional[str],
    *,
    engine: str,
) -> str:
    lines = [
        "너는 Study Hub의 문서 재생성기다. 아래 기존 문서에 오류 신고가 접수되었다.",
        "신고 사유를 반영해 문서를 다시 작성하라. 없는 정보를 지어내지 말고,",
        "신고와 무관한 부분은 최대한 원래 내용을 보존하라(전면 재작성 금지).",
        "",
        "## 기존 문서",
        f"- id: {document.id}, doc_no: {document.doc_no}, type: {document.type}",
        f"- title: {document.title}",
        f"- content:\n{document.content or '(없음)'}",
        f"- choices: {json.dumps(choices, ensure_ascii=False) if choices else '(없음)'}",
        f"- answer: {document.answer or '(없음)'}",
        f"- explanation: {document.explanation or '(없음)'}",
        f"- difficulty: {document.difficulty if document.difficulty is not None else '(없음)'}",
        f"- tags: {', '.join(tags) if tags else '(없음)'}",
        "",
        "## 신고 사유",
        reason,
    ]
    if source_note:
        lines += ["", "## 원본 출처", source_note]
        if engine == llm_engine_service.ENGINE_CLAUDE_CLI:
            lines.append("원본 파일이 프로젝트 안에 있으면 Read 도구로 직접 읽어 대조하라(R7 — 원본 대조).")
    lines += [
        "",
        "## 출력 형식(엄수)",
        "코드펜스·설명 문장 없이, 아래 필드를 가진 JSON 객체 하나만 출력하라:",
        '{"title": "...", "content": "...", "choices": ["...", ...] | null, '
        '"answer": "..." | null, "explanation": "..." | null, "difficulty": 1~5 | null, '
        '"tags": ["...", ...]}',
        "개념(concept) 문서처럼 정답이 없는 타입이면 choices/answer는 null로 둔다.",
        "type은 바꾸지 않는다 — 이 문서는 계속 같은 type이다.",
    ]
    return "\n".join(lines)


def _normalize_regenerate_draft(payload: dict) -> dict:
    if not isinstance(payload, dict):
        raise ValidationAppError("재생성 결과가 JSON 객체가 아닙니다")

    def _opt_str(key: str) -> Optional[str]:
        value = payload.get(key)
        return value if isinstance(value, str) else None

    choices = payload.get("choices")
    if choices is not None and not (
        isinstance(choices, list) and all(isinstance(c, str) for c in choices)
    ):
        raise ValidationAppError("재생성 결과의 'choices'는 문자열 배열이어야 합니다")

    difficulty = payload.get("difficulty")
    if difficulty is not None and (
        not isinstance(difficulty, int) or isinstance(difficulty, bool) or not (1 <= difficulty <= 5)
    ):
        difficulty = None  # 애매하면 비워둔다(§2 규칙과 동일 원칙)

    tags = payload.get("tags") or []
    if not isinstance(tags, list) or not all(isinstance(t, str) for t in tags):
        tags = []
    norm_tags: List[str] = []
    seen = set()
    for t in tags:
        clean = t.strip()
        if clean and clean not in seen:
            seen.add(clean)
            norm_tags.append(clean)

    return {
        "title": _opt_str("title"),
        "content": _opt_str("content"),
        "choices": choices,
        "answer": _opt_str("answer"),
        "explanation": _opt_str("explanation"),
        "difficulty": difficulty,
        "tags": norm_tags,
    }


def _do_regenerate(job_id: str, job: dict) -> dict:
    _set_phase(job_id, "preparing")
    attempted_fallback = False
    text_result: Optional[str] = None
    while True:
        engine = job["_engine"]
        _set_phase(job_id, "llm_running")
        try:
            if engine == llm_engine_service.ENGINE_CLAUDE_CLI:
                text_result = _run_claude_cli_streaming(
                    job["_prompt"], timeout_seconds=job["_timeout"], job_id=job_id
                )
            elif engine == llm_engine_service.ENGINE_CODEX_CLI:
                text_result = _run_codex_streaming(
                    job["_prompt"], timeout_seconds=job["_timeout"], job_id=job_id
                )
            else:
                text_result = _run_api_streaming(
                    job["_prompt"],
                    file_blocks=None,
                    timeout_seconds=job["_timeout"],
                    job_id=job_id,
                    model=job.get("_api_model") or llm_engine_service.DEFAULT_API_MODEL,
                )
            llm_engine_service.record_engine_result(engine, success=True)
            break
        except (ClaudeCliError, llm_engine_service.ApiEngineError, codex_adapter.CodexCliError) as exc:
            if _handle_engine_failure(job_id, job, engine, exc, attempted_fallback):
                attempted_fallback = True
                continue
            raise

    _set_phase(job_id, "parsing")
    payload = _parse_json_payload(text_result)
    draft = _normalize_regenerate_draft(payload)
    return {"draft": draft}


def start_regenerate_job(
    db: Session,
    document_id: int,
    reason: str,
    *,
    engine: str = "auto",
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
) -> str:
    _purge_expired_jobs()
    document = document_service.get_document_or_404(db, document_id)
    tags = document_service._tags_for_document(db, document_id)
    choices = json.loads(document.choices) if document.choices else None

    source_note: Optional[str] = None
    if document.source_id is not None:
        source = db.get(models.Source, document.source_id)
        if source is not None:
            note_part = f" ({source.note})" if source.note else ""
            source_note = f"원본 파일: sources/{source.filename}{note_part}"
    if document.source_detail:
        source_note = f"{source_note + chr(10) if source_note else ''}원본 위치: {document.source_detail}"

    resolved_engine = llm_engine_service.resolve_engine(db, engine)
    applied_engine = llm_engine_service.apply_remembered_limit(db, resolved_engine)
    pre_fallback = applied_engine != resolved_engine
    resolved_engine = applied_engine
    api_model = settings_service.get_setting(db, "llm.api_model", llm_engine_service.DEFAULT_API_MODEL)

    prompt = _build_regenerate_prompt(document, tags, choices, reason, source_note, engine=resolved_engine)

    job_id = f"rgn_{uuid.uuid4().hex[:8]}"
    job = _new_job_base("regenerate", resolved_engine=resolved_engine, requested_engine=engine, api_model=api_model)
    if pre_fallback:
        job["_fallback_used"] = True
    job.update(
        {
            "document_id": document_id,
            "_prompt": prompt,
            "_timeout": timeout_seconds,
            "_input_size": len(prompt.encode("utf-8")),
        }
    )
    with _JOBS_LOCK:
        _JOBS[job_id] = job
    _ensure_worker()
    _QUEUE.put(job_id)
    return job_id


def get_regenerate_job(document_id: int, job_id: str) -> dict:
    _purge_expired_jobs()
    with _JOBS_LOCK:
        job = _JOBS.get(job_id)
    if job is None or job["kind"] != "regenerate" or job["document_id"] != document_id:
        raise NotFoundError(
            "재생성 작업을 찾을 수 없습니다(만료되었을 수 있습니다)", detail={"job_id": job_id}
        )
    result = job.get("result") or {}
    return {
        "job_id": job_id,
        "status": job["status"],
        "draft": result.get("draft"),
        "error": job.get("error"),
        "error_info": job.get("_error_info"),
        "progress": _progress_snapshot(job),
    }


def apply_regenerate_job(db: Session, document_id: int, job_id: str) -> models.Document:
    """초안 승인 — 기존 문서를 PATCH 방식으로 교체. 같은 id·doc_no 유지(불변 규칙 —
    attempts·오답노트·SRS 이력 보존). 자동 덮어쓰기 없음(R7) — 이 함수 호출이 유일한 승인 경로."""
    with _JOBS_LOCK:
        job = _JOBS.get(job_id)
    if job is None or job["kind"] != "regenerate" or job["document_id"] != document_id:
        raise NotFoundError(
            "재생성 작업을 찾을 수 없습니다(만료되었을 수 있습니다)", detail={"job_id": job_id}
        )
    if job["status"] == "running":
        raise ConflictError("재생성 작업이 아직 진행 중입니다", detail={"status": job["status"]})
    if job["status"] == "error":
        raise ConflictError(
            "재생성 작업이 실패했습니다. 새로 신고해 다시 시도하세요",
            detail={"error": job.get("error")},
        )
    draft = (job.get("result") or {}).get("draft")
    if not draft:
        raise ConflictError("재생성 초안이 없습니다")

    document = document_service.get_document_or_404(db, document_id)
    if draft.get("title"):
        document.title = draft["title"]
    document.content = draft.get("content")
    document.choices = (
        json.dumps(draft["choices"], ensure_ascii=False) if draft.get("choices") else None
    )
    document.answer = draft.get("answer")
    document.explanation = draft.get("explanation")
    document.difficulty = draft.get("difficulty")

    document_service._apply_tag_replacement(db, document, draft.get("tags") or [])
    tag_rule_service.scan_document(db, document.id)

    db.commit()
    db.refresh(document)

    with _JOBS_LOCK:
        _JOBS.pop(job_id, None)  # 적용 완료된 잡은 캐시에서 제거(재적용 방지)

    return document
