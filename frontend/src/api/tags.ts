import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import { documentKeys } from './documents'
import type { MergeTagsRequest, MergeTagsResponse, Tag } from './types'

export function useTags() {
  return useQuery({
    queryKey: ['tags'],
    queryFn: () => api.get<Tag[]>('/tags'),
  })
}

// 설계 §4.9, §5.11 — 오타 태그 병합 도구(F21 인접). from 태그의 문서 연결을 to 태그로 합친다.
export function useMergeTags() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: MergeTagsRequest) => api.post<MergeTagsResponse>('/tags/merge', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tags'] })
      qc.invalidateQueries({ queryKey: documentKeys.all })
    },
  })
}
