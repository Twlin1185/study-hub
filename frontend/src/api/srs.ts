import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import { documentKeys } from './documents'
import type { SrsAnswerRequest, SrsAnswerResponse, SrsSummaryResponse, SrsTodayResponse } from './types'

// 캐시 키 = 리소스 경로 (설계 §7)
export const srsKeys = {
  today: ['srs', 'today'] as const,
  summary: ['srs', 'summary'] as const,
}

// GET /api/srs/today — 오늘의 복습 큐 (상한 settings:srs.daily_limit, 우선순위 서버 계산, §4.7)
export function useSrsToday() {
  return useQuery({
    queryKey: srsKeys.today,
    queryFn: () => api.get<SrsTodayResponse>('/srs/today'),
  })
}

// GET /api/srs/summary — 복습 완료 화면 "내일 N개 예정" · 홈 daily_start 위젯 (§4.12, S9)
export function useSrsSummary(enabled = true) {
  return useQuery({
    queryKey: srsKeys.summary,
    queryFn: () => api.get<SrsSummaryResponse>('/srs/summary'),
    enabled,
  })
}

// POST /api/srs/answer — 플래시카드 판정(풀이 기록 없는 SM-2 갱신, §4.7). q: 안다=4·모른다=1.
export function useSrsAnswer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: SrsAnswerRequest) => api.post<SrsAnswerResponse>('/srs/answer', body),
    onSuccess: (_data, variables) => {
      // 판정으로 due_date가 바뀌었으니 오늘 큐·대시보드 카운트·문서 상세 SRS 표시를 최신화한다.
      qc.invalidateQueries({ queryKey: srsKeys.today })
      qc.invalidateQueries({ queryKey: srsKeys.summary })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: documentKeys.detail(variables.document_id) })
    },
  })
}
