import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import { documentKeys } from './documents'
import { categoryKeys } from './categories'
import type { ApplySuggestionsRequest, ApplySuggestionsResult, SuggestionListResponse } from './types'

// 설계 §4.9 — 대기 중(pending) 연결 제안 목록·승인/거절.
export const suggestionKeys = {
  all: ['suggestions'] as const,
}

export function useSuggestions() {
  return useQuery({
    queryKey: suggestionKeys.all,
    queryFn: () => api.get<SuggestionListResponse>('/suggestions'),
  })
}

export function useApplySuggestions() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: ApplySuggestionsRequest) => api.post<ApplySuggestionsResult>('/suggestions/apply', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: suggestionKeys.all })
      qc.invalidateQueries({ queryKey: documentKeys.all })
      qc.invalidateQueries({ queryKey: categoryKeys.tree })
    },
  })
}
