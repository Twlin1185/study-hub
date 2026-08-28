import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type {
  ApiKeyResponse,
  InstallEngineResponse,
  LlmEngineId,
  LlmJobCancelResponse,
  LlmJobDismissResponse,
  LlmJobsResponse,
  LlmQueuePauseResponse,
  LlmStatusResponse,
  LoginEngineResponse,
} from './types'

// 설계 §4.11 (S8) — 엔진 진단·API 키 관리.
export const llmKeys = {
  status: ['llm', 'status'] as const,
}

// 설계 §4.24(S22, F48) — 전역 잡 목록. TanStack Query 키 1개(§5.14 "폴링 전역 1곳")를 사이드바
// 배지·JobCenterPanel·복원 훅이 공유한다(중복 폴링 금지). 진행 중(running·queued) 잡이 있을
// 때만 짧은 간격, 없으면 완만(인메모리 조회라 서버 비용 0 — 간격은 구현 재량).
export const llmJobsKey = ['llm', 'jobs'] as const

const JOBS_ACTIVE_POLL_MS = 3000
const JOBS_IDLE_POLL_MS = 15000

export function useLlmJobs() {
  return useQuery({
    queryKey: llmJobsKey,
    queryFn: () => api.get<LlmJobsResponse>('/llm/jobs'),
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? []
      const active = items.some((it) => it.status === 'running' || it.status === 'queued')
      return active ? JOBS_ACTIVE_POLL_MS : JOBS_IDLE_POLL_MS
    },
  })
}

// 진행 중(running+queued) 건수 — 사이드바·모바일 드로어 배지 공용 파생값.
export function activeJobCount(data: LlmJobsResponse | undefined): number {
  if (!data) return 0
  return data.items.filter((it) => it.status === 'running' || it.status === 'queued').length
}

// POST /api/llm/jobs/{id}/cancel — queued=즉시 제거(비용 0)/running=중단(부분 과금, 확인
// 다이얼로그는 JobCenterPanel·ImportQueue 공용). 409(이미 종료)·404(미존재·만료)는 서버 message를
// 그대로 렌더하는 것이 호출부 책임 — 여기서는 성공 시 목록만 무효화한다.
export function useCancelLlmJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (jobId: string) => api.post<LlmJobCancelResponse>(`/llm/jobs/${jobId}/cancel`),
    onSettled: () => qc.invalidateQueries({ queryKey: llmJobsKey }),
  })
}

// stage-42(B2-1, §4.24) — DELETE /api/llm/jobs/{id}. 종료 잡 카드의 [목록에서 지우기](일반화 —
// JobCenterPanel)와, [분할 반입] 시작 직후 원 실패 잡 자동 정리(Import.tsx onSplitStarted) 둘 다
// 이 훅을 쓴다. running/queued=409·미존재=404는 호출부가 message를 그대로 렌더/무시하는 것이
// 책임(§3 에러 규약) — 여기서는 성공 시 목록만 무효화한다.
export function useDismissLlmJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (jobId: string) => api.delete<LlmJobDismissResponse>(`/llm/jobs/${jobId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: llmJobsKey }),
  })
}

export function usePauseLlmQueue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<LlmQueuePauseResponse>('/llm/queue/pause'),
    onSuccess: () => qc.invalidateQueries({ queryKey: llmJobsKey }),
  })
}

export function useResumeLlmQueue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<LlmQueuePauseResponse>('/llm/queue/resume'),
    onSuccess: () => qc.invalidateQueries({ queryKey: llmJobsKey }),
  })
}

export function useLlmStatus() {
  return useQuery({
    queryKey: llmKeys.status,
    queryFn: () => api.get<LlmStatusResponse>('/llm/status'),
  })
}

// [다시 확인] 전용 — 서버의 60초 CLI 진단 캐시를 `?refresh=1`로 강제 우회한다. 일반 최초 로드나
// (있다면) 폴링은 이 경로를 타지 않는다 — 초경량 호출이라도 매번 강제 진단하면 안 되기 때문.
// 성공 시 결과를 useLlmStatus와 같은 쿼리 캐시에 반영해 화면이 즉시 갱신되게 한다.
export function useRefreshLlmStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.get<LlmStatusResponse>('/llm/status?refresh=1'),
    onSuccess: (data) => qc.setQueryData(llmKeys.status, data),
  })
}

// 즉석 연결 테스트 성공 시에만 서버가 저장한다 — 응답은 key_suffix만(원문 키 미포함).
export function useSetApiKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (key: string) => api.post<ApiKeyResponse>('/llm/api-key', { key }),
    onSuccess: () => qc.invalidateQueries({ queryKey: llmKeys.status }),
  })
}

export function useDeleteApiKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.delete<void>('/llm/api-key'),
    onSuccess: () => qc.invalidateQueries({ queryKey: llmKeys.status }),
  })
}

// S15(설계 §4.17④) — installable 엔진(codex-cli·claude-cli)만 유효, 그 외는 백엔드가 422.
// 동기 처리(PoC 실측 4.4초) — 버튼 스피너로 충분, 별도 잡 큐 폴링 없음.
export function useInstallEngine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (engineId: LlmEngineId) => api.post<InstallEngineResponse>(`/llm/engines/${engineId}/install`),
    onSuccess: () => qc.invalidateQueries({ queryKey: llmKeys.status }),
  })
}

// 후속 B6 — installable 엔진(codex-cli·claude-cli)만 유효. 서버가 새 콘솔 창으로 `claude auth
// login`/`codex login`을 띄운다(CLI가 자체적으로 브라우저를 연다). 캐시 갱신은 호출부가
// refreshStatus로 직접 처리(즉시 시작 상태만 알려주는 응답이라 여기서 invalidate해도 의미 없음).
export function useStartCliLogin() {
  return useMutation({
    mutationFn: (engineId: LlmEngineId) => api.post<LoginEngineResponse>(`/llm/engines/${engineId}/login`),
  })
}
