import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { AttemptRequest, AttemptResponse, QuizSessionRequest, QuizSessionResponse } from './types'

// 퀴즈 세션 생성 — 응답에 정답·해설 없음 (서버 채점 원칙, 설계 §8)
export function useCreateQuizSession() {
  return useMutation({
    mutationFn: (body: QuizSessionRequest) => api.post<QuizSessionResponse>('/quiz/session', body),
  })
}

// 채점은 서버가 수행 (attempts 저장 + 오답노트 생성 + SM-2 갱신 = 한 트랜잭션)
export function useSubmitAttempt() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: AttemptRequest) => api.post<AttemptResponse>('/attempts', body),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['review-notes'] })
      qc.invalidateQueries({ queryKey: ['documents', 'detail', variables.document_id] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      // stage-5: attempts 트랜잭션이 서버 내부에서 SM-2를 갱신하므로 오늘의 복습 큐도 무효화한다.
      qc.invalidateQueries({ queryKey: ['srs', 'today'] })
      // category_id를 실은 제출은 서버가 study_progress를 done 처리한다(attempt_service).
      // 학습 모드 문제 카드의 진행바·트리 진도를 최신화하려면 관련 캐시를 무효화한다.
      if (variables.category_id != null) {
        qc.invalidateQueries({ queryKey: ['study', 'track', variables.category_id] })
        qc.invalidateQueries({ queryKey: ['categories', 'tree'] })
        qc.invalidateQueries({ queryKey: ['study', 'continue'] })
      }
    },
  })
}
