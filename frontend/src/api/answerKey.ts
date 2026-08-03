import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import { categoryKeys } from './categories'
import { documentKeys } from './documents'
import type {
  AnswerKeyApplyResult,
  AnswerKeyStatusResponse,
  AnswerKeyUploadResponse,
  ConvertJobStartResponse,
  LlmEngine,
} from './types'

const POLL_INTERVAL_MS = 2000

// 설계 §4.20 ①(F44, S18) — 답지·해설지 반입. 업로드(판별·추출만, LLM 0) → process(가공 잡
// 시작) → 상태·미리보기 폴링(key_id 기준, job_id는 process 응답에만 존재) → apply(유일한
// 병합 쓰기). 캐시 키는 리소스 경로(설계 §7).

export function useUploadAnswerKey() {
  return useMutation({
    mutationFn: ({ file, categoryId }: { file: File; categoryId: number }) => {
      const form = new FormData()
      form.append('file', file)
      form.append('category_id', String(categoryId))
      return api.postForm<AnswerKeyUploadResponse>('/import/answer-key', form)
    },
  })
}

// LLM 가공 잡 시작 — job_id는 서버 잡 큐 내부 식별자일 뿐, 상태 폴링은 key_id로 한다
// (GET /api/import/answer-key/{key_id}, 아래 useAnswerKeyStatus).
// model(S22, 설계 §4.24 ④, F48) — 1회성 오버라이드(engine 명시 필요·소목록 밖=422, 미지정=설정값).
export function useStartAnswerKeyProcess() {
  return useMutation({
    mutationFn: ({ keyId, engine, model }: { keyId: string; engine?: LlmEngine; model?: string }) =>
      api.post<ConvertJobStartResponse>(`/import/answer-key/${keyId}/process`, { engine, model }),
  })
}

export const answerKeyStatusKey = (keyId: string) => ['import', 'answer-key', keyId] as const

// retry:false — key 상태는 인메모리 TTL 1시간(§4.20 ①-5) 관례. 사라진 key는 재요청해도
// 돌아오지 않는다(convert 잡 폴링 전례, api/convert.ts isJobLost와 동일 판별 재사용 가능).
export function useAnswerKeyStatus(keyId: string | null) {
  return useQuery({
    queryKey: answerKeyStatusKey(keyId ?? ''),
    queryFn: () => api.get<AnswerKeyStatusResponse>(`/import/answer-key/${keyId}`),
    enabled: keyId != null,
    refetchInterval: (query) => (query.state.data?.status === 'running' ? POLL_INTERVAL_MS : false),
    retry: false,
  })
}

export function useApplyAnswerKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ keyId, documentIds }: { keyId: string; documentIds: number[] }) =>
      api.post<AnswerKeyApplyResult>(`/import/answer-key/${keyId}/apply`, { document_ids: documentIds }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: documentKeys.all })
      qc.invalidateQueries({ queryKey: categoryKeys.tree })
    },
  })
}
