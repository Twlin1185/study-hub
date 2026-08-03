import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import { srsKeys } from './srs'
import { categoryKeys } from './categories'
import type {
  AppliedExamGenerateResponse,
  AppliedExamHistoryResponse,
  AppliedExamPrepareRequest,
  AppliedExamPrepareResponse,
  AppliedExamStatusResponse,
  ExamSubmitRequest,
  ExamSubmitResponse,
  LlmEngine,
} from './types'

const POLL_INTERVAL_MS = 2000

// 설계 §4.21(S19, F45) — 응용 모의고사. 응시 구성은 exam/session 재사용(신규 세션 API 없음,
// api/exam.ts의 useCreateExamSession을 그대로 쓴다). 여기서는 신규 5개 엔드포인트 중
// prepare·generate·상태·submit·history 4개(응시 구성 제외)를 다룬다. 캐시 키 = 리소스 경로(설계 §7).

export const appliedExamKeys = {
  status: (genId: string) => ['applied-exam', genId] as const,
  history: (limit: number) => ['applied-exam', 'history', limit] as const,
}

// POST /api/applied-exam/prepare — 범위 수집·견적만(LLM 0·비용 0). gen 상태는 인메모리 TTL 1시간
// (서버 재시작 시 소실 = 재실행, 무비용). 범위 과대(200,000자 초과)·근거 0건은 422.
export function usePrepareAppliedExam() {
  return useMutation({
    mutationFn: (body: AppliedExamPrepareRequest) =>
      api.post<AppliedExamPrepareResponse>('/applied-exam/prepare', body),
  })
}

// POST /api/applied-exam/{gen_id}/generate — 생성 잡 시작(convert 잡 큐 재사용, kind 'applied_exam',
// 동시 1개). 진행·완료 조회는 job_id가 아니라 gen_id로 한다(아래 useAppliedExamStatus).
// model(S22, 설계 §4.24 ④, F48) — 1회성 오버라이드(engine 명시 필요·소목록 밖=422, 미지정=설정값).
export function useStartAppliedExamGenerate() {
  return useMutation({
    mutationFn: ({ genId, engine, model }: { genId: string; engine?: LlmEngine; model?: string }) =>
      api.post<AppliedExamGenerateResponse>(`/applied-exam/${genId}/generate`, { engine, model }),
  })
}

// GET /api/applied-exam/{gen_id} 폴링 — running인 동안 2초 간격(convert 잡 폴링 전례, retry:false는
// 인메모리 TTL 1시간 관례 — 사라진 gen은 재요청해도 돌아오지 않는다).
export function useAppliedExamStatus(genId: string | null) {
  return useQuery({
    queryKey: appliedExamKeys.status(genId ?? ''),
    queryFn: () => api.get<AppliedExamStatusResponse>(`/applied-exam/${genId}`),
    enabled: genId != null,
    refetchInterval: (query) => (query.state.data?.status === 'running' ? POLL_INTERVAL_MS : false),
    retry: false,
  })
}

// POST /api/applied-exam/submit — 채점 코어는 exam/submit과 공유(§4.14 그대로), mode='applied_exam'
// 기록 + results[].basis 추가가 차이. 성공 시 무효화 범위는 useSubmitExam과 동일 + applied 이력.
export function useSubmitAppliedExam() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: ExamSubmitRequest) => api.post<ExamSubmitResponse>('/applied-exam/submit', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['review-notes'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: srsKeys.today })
      qc.invalidateQueries({ queryKey: srsKeys.summary })
      qc.invalidateQueries({ queryKey: categoryKeys.tree })
      qc.invalidateQueries({ queryKey: ['study', 'continue'] })
      qc.invalidateQueries({ queryKey: ['applied-exam', 'history'] })
    },
  })
}

// GET /api/applied-exam/history?limit= — mode='applied_exam' 그룹 파생(exam/history 파생 로직
// 재사용, 저장 없음). 실전 이력(exam/history)과 상호 불간섭(§4.21 결정 ② 목적).
export function useAppliedExamHistory(limit = 20) {
  return useQuery({
    queryKey: appliedExamKeys.history(limit),
    queryFn: () => api.get<AppliedExamHistoryResponse>(`/applied-exam/history?limit=${limit}`),
  })
}
