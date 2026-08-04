import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import { llmJobsKey } from './llm'
import type {
  LlmEngine,
  SplitAnalyzeResponse,
  SplitEnqueueResponse,
  SplitStartResponse,
  SplitStatusResponse,
} from './types'

// 설계 §4.25(S23, F49) — 대용량 원본 LLM 분할 반입. 4개 신규 엔드포인트:
//   POST /import/split(동기·LLM 0) → POST .../analyze(kind 'split_analyze' 잡) →
//   GET .../{split_id}(상태·분할안) → POST .../enqueue(선택 조각을 기존 convert 잡 N개로 등록).
// 캐시 키 = 리소스 경로(설계 §7). 조각 변환 잡은 기존 convert 큐(api/convert.ts·useConvertQueue)가
// 그대로 폴링하므로 이 파일에는 enqueue 응답의 job_id를 그 대기열에 편입하는 로직이 없다
// (호출부인 SplitImportWizard·useConvertQueue.addJobs가 담당).

const POLL_INTERVAL_MS = 2000

export type SplitStartInput = { kind: 'file'; file: File } | { kind: 'url'; url: string }

// too_large 판별·추출·SSRF·MIME은 서버가 §4.18 게이트를 재사용(§4.25 ⓐ) — 프론트는 convert
// 시작과 동일하게 multipart(file) 또는 JSON({url})만 가려 보낸다.
export function useStartSplit() {
  return useMutation({
    mutationFn: (input: SplitStartInput) => {
      if (input.kind === 'file') {
        const form = new FormData()
        form.append('file', input.file)
        return api.postForm<SplitStartResponse>('/import/split', form)
      }
      return api.post<SplitStartResponse>('/import/split', { url: input.url })
    },
  })
}

// LLM 정밀 분석 잡 시작 — 확인 스텝(견적 동의) 뒤에만 호출한다(F35). 시작 성공 시 잡 목록
// (llmJobsKey)을 무효화해 사이드바 배지·작업 센터·복원 훅이 곧바로 새 잡을 본다(§4.24 관례).
export function useSplitAnalyze() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ splitId, engine, model }: { splitId: string; engine?: LlmEngine; model?: string }) =>
      api.post<SplitAnalyzeResponse>(`/import/split/${splitId}/analyze`, { engine, model }),
    onSuccess: () => qc.invalidateQueries({ queryKey: llmJobsKey }),
  })
}

export const splitStatusKey = (splitId: string) => ['import', 'split', splitId] as const

// retry:false — 분할 레코드는 인메모리 TTL 1시간 + 디스크 복구(§4.25 ㉲) 관례. 'analyzing'
// (정밀 분석 진행 중)에만 짧은 간격으로 재조회한다(convert 잡 폴링 전례, api/convert.ts).
// stage-reviewer 재수정(2026-08-04, [중요-1]) — 'running'이 아니라 'analyzing'이 백엔드
// 확정값이라 이 조건이 맞지 않으면 폴링이 아예 켜지지 않는다(실측 파손 1번).
export function useSplitStatus(splitId: string | null, enabled = true) {
  return useQuery({
    queryKey: splitStatusKey(splitId ?? ''),
    queryFn: () => api.get<SplitStatusResponse>(`/import/split/${splitId}`),
    enabled: splitId != null && enabled,
    refetchInterval: (query) => (query.state.data?.status === 'analyzing' ? POLL_INTERVAL_MS : false),
    retry: false,
  })
}

// 선택 조각 투입 — 응답 jobs[]는 기존 convert 잡 큐에 편입될 job_id·label만 담는다(신규 진행
// UI 없음 — ImportQueue 화면 합류, §4.25 체크리스트).
export function useSplitEnqueue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      splitId,
      selections,
      categoryPaths,
    }: {
      splitId: string
      selections: string[][]
      categoryPaths?: Record<string, string>
    }) =>
      api.post<SplitEnqueueResponse>(`/import/split/${splitId}/enqueue`, {
        selections,
        category_paths: categoryPaths,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: llmJobsKey }),
  })
}
