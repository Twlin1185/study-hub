"""통합 휴지통 — 고아 이미지 2단계 정리 (S52, 설계 §4.32, 지시서 규약 A·B·C).

문서·노트 소프트 삭제 복원은 `services/document_service.py`(`restore_document`)와
`routers/notes.py`(`_list_notes`의 `inactive_only`)가 담당한다 — 이 모듈은 고아 이미지
스캔·이동·되돌리기만 다룬다.

**파일 삭제 코드 0** — `shutil.move`로 `sources/images/` ↔ `sources/images/.trash/`
사이만 옮긴다(`os.remove`·`unlink`·`rmtree` 없음). `SOURCES_IMAGES_DIR`·`AUTO_DIR`는
`convert_service`·`preview_store` 모듈 속성을 **호출 시점에** 읽는다(테스트가
`monkeypatch.setattr(convert_service, "SOURCES_IMAGES_DIR", tmp_path)`로 격리할 수
있도록 — `from ... import SOURCES_IMAGES_DIR`로 이름만 복사하면 monkeypatch가
먹지 않는다. `upload_service.py`가 겪은 함정과 동일).

서빙 정규식(`main.py` `GET /images/{filename:path}`)과 **공용 1곳** — `main.py`는
`IMAGE_FILENAME_RE`를 여기서 import해서 쓴다(중복 정의 금지).
"""
from __future__ import annotations

import datetime as dt
import re
import shutil
from pathlib import Path
from typing import Iterable, List

from sqlalchemy import select
from sqlalchemy.orm import Session

import models
from exceptions import ValidationAppError
from services import convert_service, preview_store

# 서빙 정규식과 공용 상수 — main.py `_IMAGE_FILENAME_RE`가 이 이름을 import한다.
IMAGE_FILENAME_RE = re.compile(r"^[0-9a-f]{16}\.(gif|png|jpg|jpeg|webp)$")

# 본문(마크다운·블록 JSON `"url"`·`{w=}` 접미 전부 동일 패턴) 안의 `/images/{f}` 참조
# 추출 — 블록 JSON을 해석하지 않는다(문자열 스캔만, 규약 A).
_REFERENCE_RE = re.compile(r"/images/([0-9a-f]{16}\.(?:gif|png|jpg|jpeg|webp))")

TRASH_DIRNAME = ".trash"

_INVALID_FILENAME_MESSAGE_PREFIX = "허용되지 않는 파일명이 있습니다"
_INVALID_FILENAME_MESSAGE_SUFFIX = ": 스캔 결과에서 고른 파일만 옮길 수 있습니다"
_STILL_REFERENCED_MESSAGE_SUFFIX = ": 스캔을 다시 실행하세요"


def _images_dir() -> Path:
    return convert_service.SOURCES_IMAGES_DIR


def _trash_dir() -> Path:
    return _images_dir() / TRASH_DIRNAME


def _extract_referenced(text: str | None, out: set) -> None:
    if not text:
        return
    out.update(_REFERENCE_RE.findall(text))


def collect_referenced_filenames(db: Session) -> set:
    """고아 판정의 참조 집합 — 규약 A ⓐⓑⓒ 합집합(`is_active` 무관 전 행)."""
    referenced: set = set()

    doc_rows = db.execute(
        select(
            models.Document.content,
            models.Document.choices,
            models.Document.explanation,
            models.Document.content_blocks,
            models.Document.explanation_blocks,
        )
    ).all()
    for row in doc_rows:
        for value in row:
            _extract_referenced(value, referenced)

    note_rows = db.execute(
        select(models.Note.content, models.Note.content_blocks)
    ).all()
    for row in note_rows:
        for value in row:
            _extract_referenced(value, referenced)

    auto_dir = preview_store.AUTO_DIR
    if auto_dir.exists():
        for path in auto_dir.glob("*.json"):
            try:
                text = path.read_text(encoding="utf-8")
            except OSError:
                continue
            _extract_referenced(text, referenced)

    return referenced


def _entry_info(path: Path) -> dict:
    stat = path.stat()
    return {
        "filename": path.name,
        "bytes": stat.st_size,
        "modified_at": dt.datetime.fromtimestamp(stat.st_mtime).isoformat(),
    }


def scan_images(db: Session, min_age_days: int = 7) -> dict:
    """읽기 전용 스캔 보고서(규약 ②③) — 결과를 저장하지 않는다."""
    images_dir = _images_dir()
    trash_dir = _trash_dir()
    referenced = collect_referenced_filenames(db)

    now = dt.datetime.now().timestamp()
    cutoff = now - (min_age_days * 86400)

    orphans: List[dict] = []
    other_files = 0
    referenced_count = 0
    recent_skipped = 0

    if images_dir.exists():
        for entry in images_dir.iterdir():
            if entry.is_dir():
                continue  # `.trash/` 등 하위 폴더 미탐색(규약 A)
            if not IMAGE_FILENAME_RE.fullmatch(entry.name):
                other_files += 1
                continue
            if entry.name in referenced:
                referenced_count += 1
                continue
            try:
                mtime = entry.stat().st_mtime
            except OSError:
                continue
            if mtime > cutoff:
                recent_skipped += 1
                continue
            orphans.append(_entry_info(entry))

    orphans.sort(key=lambda e: e["filename"])

    trashed: List[dict] = []
    if trash_dir.exists():
        for entry in trash_dir.iterdir():
            if entry.is_dir():
                continue
            trashed.append(_entry_info(entry))
    trashed.sort(key=lambda e: e["filename"])

    total_files = referenced_count + len(orphans) + recent_skipped

    return {
        "orphans": orphans,
        "trashed": trashed,
        "total_files": total_files,
        "referenced": referenced_count,
        "recent_skipped": recent_skipped,
        "other_files": other_files,
        "trash_dir": str(trash_dir.resolve()),
        "min_age_days": min_age_days,
    }


def _invalid_filename_error(names: List[str]) -> ValidationAppError:
    joined = ", ".join(names)
    return ValidationAppError(
        f"{_INVALID_FILENAME_MESSAGE_PREFIX}({joined}){_INVALID_FILENAME_MESSAGE_SUFFIX}",
        detail={"reason": "invalid_filename", "filenames": names},
    )


def _validate_filenames(filenames: Iterable[str]) -> List[str]:
    names = list(dict.fromkeys(filenames))  # 중복 제거(순서 유지) — 스키마와 이중 방어
    invalid = [n for n in names if not IMAGE_FILENAME_RE.fullmatch(n)]
    if invalid:
        raise _invalid_filename_error(invalid)
    return names


def _guarded_pairs(names: List[str], src_dir: Path, dst_dir: Path) -> List[tuple]:
    """경로 가드 ⓑ — `src`·`dst` 모두 `resolve()` 후 `SOURCES_IMAGES_DIR` 하위인지
    재검사(정규식 통과 이름은 구조적으로 탈출 불가하지만 이중 방어). all-or-nothing —
    호출 전체에서 파일 시스템 부작용이 생기기 전에 검사를 끝낸다."""
    images_root = _images_dir().resolve()
    pairs: List[tuple] = []
    for name in names:
        src = (src_dir / name).resolve()
        dst = (dst_dir / name).resolve()
        if not src.is_relative_to(images_root) or not dst.is_relative_to(images_root):
            raise _invalid_filename_error([name])
        pairs.append((src, dst))
    return pairs


def move_to_trash(db: Session, filenames: Iterable[str]) -> dict:
    """`images/{f}` → `images/.trash/{f}` (규약 C — 참조 재검사 → 가드 → 이동)."""
    names = _validate_filenames(filenames)

    referenced = collect_referenced_filenames(db)
    still_referenced = sorted(n for n in names if n in referenced)
    if still_referenced:
        joined = ", ".join(still_referenced)
        raise ValidationAppError(
            f"아직 사용 중인 이미지가 있어 옮기지 않았습니다({joined}){_STILL_REFERENCED_MESSAGE_SUFFIX}",
            detail={"reason": "still_referenced", "filenames": still_referenced},
        )

    images_dir = _images_dir()
    trash_dir = _trash_dir()
    pairs = _guarded_pairs(names, images_dir, trash_dir)

    trash_dir.mkdir(parents=True, exist_ok=True)

    moved = 0
    skipped = 0
    for src, dst in pairs:
        if not src.is_file() or dst.exists():
            skipped += 1
            continue
        shutil.move(str(src), str(dst))
        moved += 1

    return {"moved": moved, "skipped": skipped}


def restore_from_trash(filenames: Iterable[str]) -> dict:
    """`images/.trash/{f}` → `images/{f}` (규약 C — 되돌리기, 참조 재검사 없음)."""
    names = _validate_filenames(filenames)

    images_dir = _images_dir()
    trash_dir = _trash_dir()
    pairs = _guarded_pairs(names, trash_dir, images_dir)

    restored = 0
    skipped = 0
    for src, dst in pairs:
        if not src.is_file() or dst.exists():
            skipped += 1
            continue
        shutil.move(str(src), str(dst))
        restored += 1

    return {"restored": restored, "skipped": skipped}
