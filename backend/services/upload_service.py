"""이미지 첨부 업로드 처리 (F54, 설계 §4.27 — S29).

신규는 이 서비스와 `routers/uploads.py` 하나뿐이다. 저장 디렉터리·매직 바이트 판별·
해시 파일명 규칙·서빙 라우트는 전부 기존 자산 재사용(`convert_service`, `main.py`) —
중복 구현 금지(§4.27 재확인 근거).
"""
from __future__ import annotations

import hashlib
import uuid

from fastapi import Request
from starlette.formparsers import MultiPartException, MultiPartParser

from exceptions import ValidationAppError
from services.convert_service import SOURCES_IMAGES_DIR, _detect_image_magic

# §4.27 ⑤ — 파일당 10MB(10 × 1024 × 1024 바이트) 상한. 재인코딩 없음(Pillow 등 신규 의존 0).
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
# Content-Length 1차 차단용 여유폭 — multipart 봉투(boundary·헤더) 오버헤드를 흡수한다.
# 정본은 항상 실제 파일 파트 누적 바이트(§4.27 ⑤, 헤더는 신뢰하지 않음).
_ENVELOPE_OVERHEAD_SLACK = 4096

_TOO_LARGE_MESSAGE = "이미지가 너무 큽니다(10MB 이하만 올릴 수 있습니다)"
_NO_FILE_MESSAGE = "올릴 이미지 파일이 없습니다"
_UNSUPPORTED_TYPE_MESSAGE = "이미지 파일이 아닙니다. PNG·JPG·GIF·WebP만 올릴 수 있습니다"
_BAD_FORMAT_MESSAGE = "지원하지 않는 요청 형식입니다(multipart/form-data만 허용)"


def _too_large_error() -> ValidationAppError:
    return ValidationAppError(_TOO_LARGE_MESSAGE, detail={"reason": "too_large"})


class _FilePartTooLarge(MultiPartException):
    """파일 파트 누적 바이트가 상한을 넘는 순간 이후 청크를 더 읽지 않기 위한 내부 신호.

    `MultiPartException`을 상속해 상위 `MultiPartParser.parse()`의 기존 정리 경로
    (열린 스풀 파일 close)를 그대로 타면서도, 우리 쪽에서 별도로 구분해 잡는다."""


class _SizeLimitedMultiPartParser(MultiPartParser):
    """starlette 기본 `max_part_size`는 필드(non-file)에만 적용되고 파일 파트는 무제한
    이므로(§4.27 ⑤ — 파일당 상한 요건과 어긋남), `on_part_data`를 오버라이드해 파일
    파트 바이트 자체에 상한을 건다. 청크가 파서에 먹여지는 매 호출마다 검사하므로
    본문을 전체 버퍼링한 뒤 재는 방식이 아니라 스트리밍 중 조기 차단이다."""

    def __init__(self, *args, file_size_limit: int, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self._file_bytes_seen = 0
        self._file_size_limit = file_size_limit

    def on_part_data(self, data: bytes, start: int, end: int) -> None:
        if self._current_part.file is not None:
            self._file_bytes_seen += end - start
            if self._file_bytes_seen > self._file_size_limit:
                raise _FilePartTooLarge("file part exceeds upload size limit")
        super().on_part_data(data, start, end)


def _check_content_length_header(request: Request) -> None:
    """`Content-Length`가 있으면 읽기 전 1차 차단에 쓰되 신뢰하지 않는다(§4.27 ⑤ —
    헤더 위조·chunked 전송 대비, 실제 누적 바이트가 정본). multipart 봉투 오버헤드
    만큼 여유를 두어 파일이 정확히 상한 바이트일 때 오탐하지 않는다."""
    header = request.headers.get("content-length")
    if header is None:
        return
    try:
        declared = int(header)
    except ValueError:
        return
    if declared > MAX_UPLOAD_BYTES + _ENVELOPE_OVERHEAD_SLACK:
        raise _too_large_error()


async def _read_single_file_field(request: Request) -> bytes:
    """multipart 본문을 청크로 스트리밍 파싱하며 `file` 필드 바이트만 뽑아낸다."""
    parser = _SizeLimitedMultiPartParser(
        request.headers, request.stream(), file_size_limit=MAX_UPLOAD_BYTES
    )
    try:
        form = await parser.parse()
    except _FilePartTooLarge as exc:
        raise _too_large_error() from exc
    except MultiPartException as exc:
        raise ValidationAppError(_BAD_FORMAT_MESSAGE, detail={"content_type": None}) from exc

    file_field = form.get("file")
    if file_field is None or not hasattr(file_field, "read"):
        raise ValidationAppError(_NO_FILE_MESSAGE, detail={"reason": "no_file"})

    data = await file_field.read()
    await file_field.close()
    return data


def _store_image(data: bytes, ext: str) -> str:
    """`sources/images/{sha256[:16]}.{ext}`에 저장(이미 있으면 쓰기 생략) 후 절대 URL 반환.

    부분 기록 파일이 남지 않도록 임시 파일 → rename(같은 디렉터리, `Path.replace`는
    원자적 교체)로 저장한다(§4.27 ④)."""
    digest = hashlib.sha256(data).hexdigest()[:16]
    filename = f"{digest}.{ext}"
    SOURCES_IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    target = SOURCES_IMAGES_DIR / filename
    if not target.exists():
        tmp_path = SOURCES_IMAGES_DIR / f".{filename}.{uuid.uuid4().hex}.tmp"
        try:
            tmp_path.write_bytes(data)
            tmp_path.replace(target)
        finally:
            if tmp_path.exists():
                tmp_path.unlink(missing_ok=True)
    return f"/images/{filename}"


async def handle_upload(request: Request, content_type: str) -> str:
    """`POST /api/uploads` 본체 처리 — 상한 조기 차단 → multipart 파싱 → 매직 바이트
    판별 → 저장(중복 제거) → URL 반환. 판별 실패 시 확장자·content-type으로 폴백하지
    않는다(§4.27 ③ 리스크 대응)."""
    if not content_type.startswith("multipart/form-data"):
        raise ValidationAppError(_BAD_FORMAT_MESSAGE, detail={"content_type": content_type or None})

    _check_content_length_header(request)

    data = await _read_single_file_field(request)
    if not data:
        raise ValidationAppError(_NO_FILE_MESSAGE, detail={"reason": "no_file"})
    if len(data) > MAX_UPLOAD_BYTES:
        raise _too_large_error()

    ext = _detect_image_magic(data)
    if ext is None:
        raise ValidationAppError(_UNSUPPORTED_TYPE_MESSAGE, detail={"reason": "unsupported_type"})

    return _store_image(data, ext)
