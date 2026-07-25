import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import { documentKeys } from './documents'
import type { MergeTagsRequest, MergeTagsResponse, Tag, TagSimilarPair } from './types'

export function useTags() {
  return useQuery({
    queryKey: ['tags'],
    queryFn: () => api.get<Tag[]>('/tags'),
  })
}

// 공용 무효화 — 태그 변경(병합·이름변경·삭제)은 태그 목록·유사쌍·문서 목록·규칙에 영향.
function invalidateTagRelated(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['tags'] })
  qc.invalidateQueries({ queryKey: ['tags', 'similar'] })
  qc.invalidateQueries({ queryKey: documentKeys.all })
}

// 설계 §4.9, §5.11 — 오타 태그 병합 도구(F21 인접). from 태그의 문서 연결을 to 태그로 합친다.
export function useMergeTags() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: MergeTagsRequest) => api.post<MergeTagsResponse>('/tags/merge', body),
    onSuccess: () => invalidateTagRelated(qc),
  })
}

// GET /api/tags/similar — 유사(오타 의심) 태그 쌍 (§4.12, S9/F38).
export function useSimilarTags() {
  return useQuery({
    queryKey: ['tags', 'similar'],
    queryFn: () => api.get<TagSimilarPair[]>('/tags/similar'),
  })
}

// PATCH /api/tags/{id} — 이름 변경. 정규화 중복이면 409(+"병합을 사용하세요") (§4.12, S9/F38).
export function useRenameTag() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => api.patch<Tag>(`/tags/${id}`, { name }),
    onSuccess: () => invalidateTagRelated(qc),
  })
}

// DELETE /api/tags/{id} — 미사용 태그만(doc_count=0·규칙 미참조). 사용 중이면 409 (§4.12, S9/F38).
export function useDeleteTag() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/tags/${id}`),
    onSuccess: () => invalidateTagRelated(qc),
  })
}
