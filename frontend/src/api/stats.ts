import { useQuery } from '@tanstack/react-query'
import { api } from './client'
import type { AccuracyTrendEntry, CategoryChildStat, HeatmapEntry, StreakResponse, WeaknessItem } from './types'

// 목표·스트릭 캐시 키(§4.13, S10, F26) — 설정 화면에서 goal.* 저장 시 이 키들을 invalidate한다.
export const streakKeys = {
  all: ['stats', 'streak'] as const,
}

// 설계 §4.8 — 홈 히트맵 12주. from/to는 ISO 날짜(YYYY-MM-DD).
export function useHeatmap(from: string, to: string) {
  return useQuery({
    queryKey: ['stats', 'heatmap', from, to],
    queryFn: () => api.get<HeatmapEntry[]>(`/stats/heatmap?from=${from}&to=${to}`),
  })
}

// 설계 §4.8 — "자꾸 틀리는 개념 Top 10" 약점 위젯.
export function useWeakness(categoryId?: number | null, limit = 10) {
  const params = new URLSearchParams()
  if (categoryId != null) params.set('category_id', String(categoryId))
  params.set('limit', String(limit))
  return useQuery({
    queryKey: ['stats', 'weakness', categoryId ?? null, limit],
    queryFn: () => api.get<WeaknessItem[]>(`/stats/weakness?${params.toString()}`),
  })
}

// 설계 §4.8 — 홈 "최근 정답률 추이 라인". 풀이가 있었던 날만, 날짜 오름차순으로 내려온다.
export function useAccuracyTrend(days = 30) {
  return useQuery({
    queryKey: ['stats', 'accuracy-trend', days],
    queryFn: () => api.get<AccuracyTrendEntry[]>(`/stats/accuracy-trend?days=${days}`),
  })
}

// 설계 §4.13(S10, F26) — 홈 스트릭 위젯·복습 완료 화면. 전부 파생값(활동일 = attempts + 개념
// 완료). goal_met은 설정된 목표 항목 각각 충족(AND) — 판정은 서버가 계산, 클라이언트는 표시만.
export function useStreak() {
  return useQuery({
    queryKey: streakKeys.all,
    queryFn: () => api.get<StreakResponse>('/stats/streak'),
  })
}

// 설계 §4.1 — 커리큘럼 드릴다운(직계 자식별 진도·정답률·시도 수). 과목별 정답률 바 차트에 사용.
export function useCategoryStats(categoryId: number | null) {
  return useQuery({
    queryKey: ['categories', 'stats', categoryId ?? -1],
    queryFn: () => api.get<CategoryChildStat[]>(`/categories/${categoryId}/stats`),
    enabled: categoryId != null,
  })
}
