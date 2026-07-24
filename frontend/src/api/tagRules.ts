import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import { documentKeys } from './documents'
import { categoryKeys } from './categories'
import type { TagRule, TagRuleInput, TagRuleScanResult, TagRuleUnlinkResult } from './types'

// 설계 §4.9 — 태그 자동 분류 규칙 CRUD + 일괄 스캔 + 연결 해제(F21).
export const tagRuleKeys = {
  all: ['tag-rules'] as const,
}

export function useTagRules() {
  return useQuery({
    queryKey: tagRuleKeys.all,
    queryFn: () => api.get<TagRule[]>('/tag-rules'),
  })
}

export function useCreateTagRule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: TagRuleInput) => api.post<TagRule>('/tag-rules', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: tagRuleKeys.all }),
  })
}

export function useUpdateTagRule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number } & Partial<TagRuleInput>) =>
      api.patch<TagRule>(`/tag-rules/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: tagRuleKeys.all }),
  })
}

export function useDeleteTagRule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/tag-rules/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: tagRuleKeys.all })
      qc.invalidateQueries({ queryKey: ['suggestions'] })
    },
  })
}

// 규칙 생성·수정 시 일괄 스캔 트리거(§4.9 트리거 3곳 중 하나) — 제안 생성 결과 {created} 반환.
export function useScanTagRule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.post<TagRuleScanResult>(`/tag-rules/${id}/scan`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['suggestions'] }),
  })
}

// "이 규칙이 연결한 문서들" 일괄 해제 — category_documents.linked_rule_id={id} 링크 전부 해제.
export function useUnlinkTagRule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.post<TagRuleUnlinkResult>(`/tag-rules/${id}/unlink`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: documentKeys.all })
      qc.invalidateQueries({ queryKey: categoryKeys.tree })
    },
  })
}
