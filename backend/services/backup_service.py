"""백업/복원 (F27, 계획서 R5) — study.db `VACUUM INTO` + sources/ zip 스냅샷.

로컬 개인용 단일 프로세스 앱 전제(R6) — 별도 락 코디네이션 없이 파일 복사로 처리한다.
"""
from __future__ import annotations

import datetime as dt
import shutil
import sqlite3
import zipfile
from pathlib import Path
from typing import Dict, List

from sqlalchemy import text

from database import BASE_DIR, DB_PATH, engine
from exceptions import ConflictError, NotFoundError, ValidationAppError

BACKUPS_DIR = BASE_DIR / "backups"
SOURCES_DIR = BASE_DIR / "sources"
RESTORE_CONFIRM_PHRASE = "RESTORE"  # 프론트가 사용자에게 정확히 이 문자열을 입력시킨다


def _timestamp_stem(now: dt.datetime) -> str:
    return now.strftime("%Y%m%d_%H%M%S")


def _db_backup_path(backup_id: str) -> Path:
    return BACKUPS_DIR / f"{backup_id}.db"


def _sources_zip_path(backup_id: str) -> Path:
    return BACKUPS_DIR / f"{backup_id}_sources.zip"


def create_backup(*, label: str = "manual") -> Dict:
    BACKUPS_DIR.mkdir(exist_ok=True)
    now = dt.datetime.now()
    backup_id = f"{_timestamp_stem(now)}_{label}"
    db_backup = _db_backup_path(backup_id)

    # VACUUM INTO — 별도 sqlite3 연결로 실행해 운영 커넥션 풀과 무관한 일관 스냅샷을 만든다.
    conn = sqlite3.connect(str(DB_PATH))
    try:
        conn.execute(f"VACUUM INTO '{db_backup.as_posix()}'")
    finally:
        conn.close()

    sources_zip = _sources_zip_path(backup_id)
    with zipfile.ZipFile(sources_zip, "w", zipfile.ZIP_DEFLATED) as zf:
        if SOURCES_DIR.exists():
            for path in SOURCES_DIR.rglob("*"):
                if path.is_file():
                    zf.write(path, arcname=str(path.relative_to(SOURCES_DIR)))

    size = db_backup.stat().st_size + sources_zip.stat().st_size
    return {
        "id": backup_id,
        "filename": db_backup.name,
        "created_at": now,
        "size_bytes": size,
    }


def list_backups() -> List[Dict]:
    if not BACKUPS_DIR.exists():
        return []
    items: List[Dict] = []
    for db_backup in BACKUPS_DIR.glob("*.db"):
        backup_id = db_backup.stem
        sources_zip = _sources_zip_path(backup_id)
        size = db_backup.stat().st_size + (
            sources_zip.stat().st_size if sources_zip.exists() else 0
        )
        items.append(
            {
                "id": backup_id,
                "filename": db_backup.name,
                "created_at": dt.datetime.fromtimestamp(db_backup.stat().st_mtime),
                "size_bytes": size,
            }
        )
    items.sort(key=lambda item: item["created_at"], reverse=True)
    return items


def latest_backup_at() -> dt.datetime | None:
    backups = list_backups()
    return backups[0]["created_at"] if backups else None


def restore_backup(backup_id: str, confirm: str) -> Dict:
    if confirm != RESTORE_CONFIRM_PHRASE:
        raise ValidationAppError(
            f"확인 문구가 올바르지 않습니다. '{RESTORE_CONFIRM_PHRASE}'를 정확히 입력하세요",
            detail={"expected": RESTORE_CONFIRM_PHRASE},
        )
    db_backup = _db_backup_path(backup_id)
    if not db_backup.exists():
        raise NotFoundError("백업을 찾을 수 없습니다", detail={"backup_id": backup_id})

    # 복원 전 자동 스냅샷 1개 생성 — 복원이 잘못됐을 때 되돌릴 수 있게(지시서 요구사항).
    pre_restore = create_backup(label="pre_restore")

    # 남아있는 WAL을 study.db 본문에 반영해 비운다. Windows는 앱(uvicorn)이 열어 둔
    # -wal/-shm 파일을 unlink할 수 없으므로(공유 위반) 삭제 대신 체크포인트로 처리한다.
    try:
        wal_conn = sqlite3.connect(str(DB_PATH))
        wal_conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        wal_conn.close()
    except sqlite3.Error:
        pass

    try:
        shutil.copyfile(db_backup, DB_PATH)
    except OSError as exc:
        raise ConflictError(
            "study.db 파일이 사용 중이라 복원하지 못했습니다. 서버를 재시작한 뒤 다시 시도하세요",
            detail={"reason": str(exc)},
        ) from exc

    sources_zip = _sources_zip_path(backup_id)
    if sources_zip.exists():
        if SOURCES_DIR.exists():
            shutil.rmtree(SOURCES_DIR)
        SOURCES_DIR.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(sources_zip, "r") as zf:
            zf.extractall(SOURCES_DIR)

    # 복원 후처리(M6 이월 ②, 설계 §4.12): SQLAlchemy 커넥션 풀 폐기 — 이후 요청은
    # 복원본 파일로 새 커넥션을 맺는다(stale 커넥션이 옛 DB 상태를 붙들고 있는 것 방지).
    # Windows에서 앱이 study.db를 계속 열어 둔 채로도(WAL 체크포인트 이후) 안전하게
    # dispose 가능 — 실제 파일 핸들은 각 커넥션이 쥐고 있고, 이미 위에서 파일 교체는
    # 끝난 뒤이므로 dispose는 다음 요청부터 새 파일을 읽게 만드는 역할만 한다.
    engine.dispose()
    with engine.connect() as verify_conn:
        verify_conn.execute(text("SELECT COUNT(*) FROM categories"))

    return {"restored_from": backup_id, "pre_restore_backup": pre_restore["id"]}
