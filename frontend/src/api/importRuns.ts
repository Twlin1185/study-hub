// 반입 건(import runs) API — 설계 §4.34(S56, F63). 서버가 정본(영속)이라 localStorage 대기열을 대체한다.
// 캐시 키 = ['import','runs',…]. 낙관적 업데이트 0(dismiss·adopt는 mutation 후 invalidate).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { Paginated } from './client'
import type {
  ImportRun,
  ImportRunAdoptResponse,
  ImportRunDetail,
  ImportRunDismissResponse,
  ImportRunStatus,
} from './types'

export const IN_PROGRESS_RUN_STATUSES: ImportRunStatus[] = ['queued', 'converting', 'splitting', 'committing']

export function isRunInProgress(status: ImportRunStatus): boolean {
  return IN_PROGRESS_RUN_STATUSES.includes(status)
}

export const importRunKeys = {
  all: ['import', 'runs'] as const,
  list: (page: number, size: number) => ['import', 'runs', 'list', page, size] as const,
  detail: (id: number) => ['import', 'runs', 'detail', id] as const,
}

export function listRuns(page: number, size: number): Promise<Paginated<ImportRun>> {
  return api.get<Paginated<ImportRun>>(`/import/runs?page=${page}&size=${size}`)
}

export function getRun(id: number): Promise<ImportRunDetail> {
  return api.get<ImportRunDetail>(`/import/runs/${id}`)
}

export function dismissRun(id: number): Promise<ImportRunDismissResponse> {
  return api.post<ImportRunDismissResponse>(`/import/runs/${id}/dismiss`)
}

// 레거시 localStorage 큐 1회 이관 — body {entries:[StoredQueueEntry...]}(프론트 타입 그대로).
export function adoptLegacy(body: { entries: unknown[] }): Promise<ImportRunAdoptResponse> {
  return api.post<ImportRunAdoptResponse>('/import/runs/adopt', body)
}

// 상세(타임라인) — [자세히] 펼침과 ?run= 단건 보강이 공유. 진행 중이면 호출부가 refetchMs로 갱신.
export function useRunDetail(id: number | null, opts?: { enabled?: boolean; refetchMs?: number | false }) {
  return useQuery({
    queryKey: importRunKeys.detail(id ?? -1),
    queryFn: () => getRun(id as number),
    enabled: id != null && (opts?.enabled ?? true),
    refetchInterval: opts?.refetchMs ?? false,
    retry: false,
  })
}

export function useDismissRun() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => dismissRun(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: importRunKeys.all }),
  })
}

export function useAdoptLegacy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: adoptLegacy,
    onSuccess: () => qc.invalidateQueries({ queryKey: importRunKeys.all }),
  })
}
