"""백업/복원 라우터 (F27, 설계 §4.10)."""
from __future__ import annotations

from typing import List

from fastapi import APIRouter, status

from schemas.backup import BackupOut, RestoreRequest, RestoreResult
from services import backup_service

router = APIRouter(prefix="/api/backups", tags=["backups"])


@router.post("", response_model=BackupOut, status_code=status.HTTP_201_CREATED)
def create_backup() -> BackupOut:
    return BackupOut(**backup_service.create_backup())


@router.get("", response_model=List[BackupOut])
def list_backups() -> List[BackupOut]:
    return [BackupOut(**row) for row in backup_service.list_backups()]


@router.post("/{backup_id}/restore", response_model=RestoreResult)
def restore_backup(backup_id: str, payload: RestoreRequest) -> RestoreResult:
    result = backup_service.restore_backup(backup_id, payload.confirm)
    return RestoreResult(**result)
