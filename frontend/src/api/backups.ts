import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { BackupListResponse, CreateBackupResult } from './types'

// 설계 §4.10, F27 — 백업 스냅샷 생성·목록·복원.
export const backupKeys = {
  all: ['backups'] as const,
}

export function useBackups() {
  return useQuery({
    queryKey: backupKeys.all,
    queryFn: () => api.get<BackupListResponse>('/backups'),
  })
}

export function useCreateBackup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<CreateBackupResult>('/backups'),
    onSuccess: () => qc.invalidateQueries({ queryKey: backupKeys.all }),
  })
}

// restore는 확인 문구("RESTORE" 고정) 타이핑을 프론트에서 강제한 뒤에만 호출한다(BackupManager).
// body는 {confirm: "RESTORE"}(설계 §4.10 v1.5 확정). 복원 전 서버가 자동 스냅샷 1개를 생성한다.
export function useRestoreBackup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.post<void>(`/backups/${id}/restore`, { confirm: 'RESTORE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: backupKeys.all }),
  })
}
