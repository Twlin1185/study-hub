import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import { documentKeys } from './documents'
import { llmJobsKey } from './llm'
import type { ConvertJobStartResponse, DocumentDetail, ExplainJobResponse, LlmEngine } from './types'

const POLL_INTERVAL_MS = 2000

// 설계 §4.20 ②(F44, S18) — LLM 풀이 생성. F30 재생성 잡 인프라 재사용(kind 'explain').
// 대상 제한(문제 타입 + 해설 없음)은 서버가 검증한다(있으면 409) — 프론트는 버튼 노출 조건으로만
// 사전 필터링한다.

// model(S22, 설계 §4.24 ④, F48) — 1회성 오버라이드(engine 명시 필요·소목록 밖=422, 미지정=설정값).
// 시작 성공 시 잡 목록(llmJobsKey) 무효화(검토 반영 — api/convert.ts useStartConvert와 동일 근거).
export function useStartExplain() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ documentId, engine, model }: { documentId: number; engine?: LlmEngine; model?: string }) =>
      api.post<ConvertJobStartResponse>(`/documents/${documentId}/explain`, { engine, model }),
    onSuccess: () => qc.invalidateQueries({ queryKey: llmJobsKey }),
  })
}

// GET .../explain/{job_id} 폴링 — RegenerateJobPanel(F30) 전례와 동일하게 job_id는 로컬
// (utils/explainJobs.ts)에서 문서별로 추적한다("문서별 진행 중 잡 조회" 엔드포인트 없음).
export function useExplainJob(documentId: number | null, jobId: string | null) {
  return useQuery({
    queryKey: ['documents', documentId ?? -1, 'explain', jobId ?? ''],
    queryFn: () => api.get<ExplainJobResponse>(`/documents/${documentId}/explain/${jobId}`),
    enabled: documentId != null && jobId != null,
    refetchInterval: (query) => (query.state.data?.status === 'running' ? POLL_INTERVAL_MS : false),
    retry: false,
  })
}

// 승인 병합 — 서버가 마커 라인을 부착해 explanation 저장, answer는 비어 있을 때만 병합.
// 응답은 갱신된 DocumentDetail(§4.20 ② 계약) — 재조회 없이 캐시에 바로 반영한다.
export function useApplyExplain() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ documentId, jobId }: { documentId: number; jobId: string }) =>
      api.post<DocumentDetail>(`/documents/${documentId}/explain/${jobId}/apply`),
    onSuccess: (data, variables) => {
      qc.setQueryData(documentKeys.detail(variables.documentId), data)
      qc.invalidateQueries({ queryKey: documentKeys.all })
    },
  })
}
