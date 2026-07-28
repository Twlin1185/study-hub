import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { ApiKeyResponse, InstallEngineResponse, LlmEngineId, LlmStatusResponse } from './types'

// 설계 §4.11 (S8) — 엔진 진단·API 키 관리.
export const llmKeys = {
  status: ['llm', 'status'] as const,
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

// S15(설계 §4.17④) — installable:true 엔진(현재 codex-cli)만 유효, 그 외는 백엔드가 422.
// 동기 처리(PoC 실측 4.4초) — 버튼 스피너로 충분, 별도 잡 큐 폴링 없음.
export function useInstallEngine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (engineId: LlmEngineId) => api.post<InstallEngineResponse>(`/llm/engines/${engineId}/install`),
    onSuccess: () => qc.invalidateQueries({ queryKey: llmKeys.status }),
  })
}
