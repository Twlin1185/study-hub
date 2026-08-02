import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Paginated } from './client'
import type {
  ImproveApplyResponse,
  ImproveCaseItem,
  ImproveGenJobResponse,
  ImproveGenPrepareRequest,
  ImproveGenPrepareResponse,
  ImproveProposalDetail,
  ImproveProposalListItem,
  ImproveProposalStatus,
  ImproveRegressionJobResponse,
  ImproveRegressionPrepareRequest,
  ImproveRegressionPrepareResponse,
  ConvertJobStartResponse,
  LlmEngine,
} from './types'

// 설계 §4.22(F46, S20) — 반입 자기 개선 루프. 이 기능은 DB에 아무것도 쓰지 않는다(improve/·
// prompts/ 파일 기반, 결정 ①~⑦). 캐시 키 = 리소스 경로(설계 §7). gen_id·reg_id가 상태 폴링 키
// (answer-key의 key_id와 동일 관례 — job_id는 시작 응답에만 존재, api/answerKey.ts 전례).
const POLL_INTERVAL_MS = 2000

// ---- 실패 사례 (§4.22 ①) ----

export const improveCaseKeys = {
  all: ['improve', 'cases'] as const,
  list: (page: number, size: number, kind?: string) => ['improve', 'cases', { page, size, kind }] as const,
  detail: (caseId: string) => ['improve', 'cases', caseId] as const,
}

export function useImproveCases(page: number, size: number, kind?: string) {
  return useQuery({
    queryKey: improveCaseKeys.list(page, size, kind),
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), size: String(size) })
      if (kind) params.set('kind', kind)
      return api.get<Paginated<ImproveCaseItem>>(`/improve/cases?${params.toString()}`)
    },
  })
}

export function useImproveCase(caseId: string | null) {
  return useQuery({
    queryKey: improveCaseKeys.detail(caseId ?? ''),
    queryFn: () => api.get<ImproveCaseItem>(`/improve/cases/${caseId}`),
    enabled: caseId != null,
  })
}

export function useDeleteImproveCase() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (caseId: string) => api.delete<void>(`/improve/cases/${caseId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: improveCaseKeys.all }),
  })
}

// ---- 개선 제안 생성 (§4.22 ②) — prepare(LLM 0, 견적) → generate(LLM 호출, 확인 스텝 뒤) ----

export function useImproveGenPrepare() {
  return useMutation({
    mutationFn: (body: ImproveGenPrepareRequest) =>
      api.post<ImproveGenPrepareResponse>('/improve/gen/prepare', body),
  })
}

export function useStartImproveGen() {
  return useMutation({
    mutationFn: ({ genId, engine }: { genId: string; engine?: LlmEngine }) =>
      api.post<ConvertJobStartResponse>(`/improve/gen/${genId}/generate`, { engine }),
  })
}

// retry:false — gen 상태는 인메모리 TTL 1시간(§4.22 ②-1) 관례. 사라진 gen은 재요청해도 돌아오지
// 않는다(prepare는 LLM 0이라 재실행이 무비용 — convert 잡 폴링·answer-key 전례와 동일 판별).
export function useImproveGenJob(genId: string | null) {
  return useQuery({
    queryKey: ['improve', 'gen', genId ?? ''],
    queryFn: () => api.get<ImproveGenJobResponse>(`/improve/gen/${genId}`),
    enabled: genId != null,
    refetchInterval: (query) => (query.state.data?.status === 'running' ? POLL_INTERVAL_MS : false),
    retry: false,
  })
}

// ---- 제안함 (§4.22 ③) — 유일한 파일 쓰기는 apply ----

export const improveProposalKeys = {
  list: (status: string) => ['improve', 'proposals', status] as const,
  detail: (proposalId: string) => ['improve', 'proposals', 'detail', proposalId] as const,
}

export function useImproveProposals(status: ImproveProposalStatus | 'all' = 'pending') {
  return useQuery({
    queryKey: improveProposalKeys.list(status),
    queryFn: () => api.get<ImproveProposalListItem[]>(`/improve/proposals?status=${status}`),
  })
}

export function useImproveProposal(proposalId: string | null) {
  return useQuery({
    queryKey: improveProposalKeys.detail(proposalId ?? ''),
    queryFn: () => api.get<ImproveProposalDetail>(`/improve/proposals/${proposalId}`),
    enabled: proposalId != null,
  })
}

// 결정 완료(applied/rejected/acknowledged)는 pending·applied 두 목록 모두에 영향을 줄 수 있어
// (제안함 nav 배지·회귀 패널 소스 목록) improve/proposals 전체를 무효화한다.
function invalidateProposals(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['improve', 'proposals'] })
}

export function useApplyImproveProposal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (proposalId: string) => api.post<ImproveApplyResponse>(`/improve/proposals/${proposalId}/apply`),
    onSuccess: () => invalidateProposals(qc),
  })
}

export function useRejectImproveProposal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (proposalId: string) => api.post<void>(`/improve/proposals/${proposalId}/reject`),
    onSuccess: () => invalidateProposals(qc),
  })
}

// ---- 회귀 재검증 (§4.22 ④) — prepare(LLM 0, 견적) → run(LLM 호출, 확인 스텝 뒤). 검증
// 전용(preview 미등록·DB 무기록) — 결과는 사례 레코드 regressions[]에 남는다. ----

export function useImproveRegressionPrepare() {
  return useMutation({
    mutationFn: (body: ImproveRegressionPrepareRequest) =>
      api.post<ImproveRegressionPrepareResponse>('/improve/regression/prepare', body),
  })
}

export function useStartImproveRegression() {
  return useMutation({
    mutationFn: ({ regId, engine }: { regId: string; engine?: LlmEngine }) =>
      api.post<ConvertJobStartResponse>(`/improve/regression/${regId}/run`, { engine }),
  })
}

export function useImproveRegressionJob(regId: string | null) {
  const qc = useQueryClient()
  return useQuery({
    queryKey: ['improve', 'regression', regId ?? ''],
    queryFn: async () => {
      const data = await api.get<ImproveRegressionJobResponse>(`/improve/regression/${regId}`)
      // 완료 시 사례 레코드(regressions[] append)가 갱신되므로 사례 목록·상세 캐시를 갱신한다.
      if (data.status === 'done') qc.invalidateQueries({ queryKey: improveCaseKeys.all })
      return data
    },
    enabled: regId != null,
    refetchInterval: (query) => (query.state.data?.status === 'running' ? POLL_INTERVAL_MS : false),
    retry: false,
  })
}
