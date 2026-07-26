import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import { srsKeys } from './srs'
import { categoryKeys } from './categories'
import type {
  ExamHistoryResponse,
  ExamSessionRequest,
  ExamSessionResponse,
  ExamSubmitRequest,
  ExamSubmitResponse,
} from './types'

// 캐시 키 = 리소스 경로 (설계 §7)
export const examKeys = {
  history: (limit: number) => ['exam', 'history', limit] as const,
}

// POST /api/exam/session — 모의고사 구성(무상태, 서버 세션 저장 없음). 응답에 정답·해설 없음
// (서버 채점 원칙, 설계 §4.14 — quiz/session과 동일한 QuizQuestionOut 재사용).
export function useCreateExamSession() {
  return useMutation({
    mutationFn: (body: ExamSessionRequest) => api.post<ExamSessionResponse>('/exam/session', body),
  })
}

// POST /api/exam/submit — 일괄 제출 채점(배치 전체가 한 트랜잭션, 불변 규칙 2). 제출 후 응답이라
// 정답·해설 공개(§4.14). 성공 시 attempts·오답노트·SM-2·study_progress가 갱신되므로 관련 쿼리를
// invalidate한다(useSubmitAttempt 전례와 동일 범위 + exam/history).
export function useSubmitExam() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: ExamSubmitRequest) => api.post<ExamSubmitResponse>('/exam/submit', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['review-notes'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: srsKeys.today })
      qc.invalidateQueries({ queryKey: srsKeys.summary })
      qc.invalidateQueries({ queryKey: categoryKeys.tree })
      qc.invalidateQueries({ queryKey: ['study', 'continue'] })
      qc.invalidateQueries({ queryKey: ['exam', 'history'] })
    },
  })
}

// GET /api/exam/history?limit= — 응시 이력(파생값, 페이지네이션 없음 — limit 절단, srs/today 전례).
export function useExamHistory(limit = 20) {
  return useQuery({
    queryKey: examKeys.history(limit),
    queryFn: () => api.get<ExamHistoryResponse>(`/exam/history?limit=${limit}`),
  })
}
