import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Paginated } from './client'
import type { ReviewNote, ReviewNoteFilters, ReviewNotePatch } from './types'

export const reviewNoteKeys = {
  list: (filters: ReviewNoteFilters) => ['review-notes', filters] as const,
}

function buildQuery(filters: ReviewNoteFilters): string {
  const params = new URLSearchParams()
  if (filters.resolved != null) params.set('resolved', filters.resolved ? '1' : '0')
  if (filters.wrong_reason) params.set('wrong_reason', filters.wrong_reason)
  if (filters.category_id != null) params.set('category_id', String(filters.category_id))
  params.set('page', String(filters.page ?? 1))
  params.set('size', String(filters.size ?? 50))
  return params.toString()
}

export function useReviewNotes(filters: ReviewNoteFilters) {
  return useQuery({
    queryKey: reviewNoteKeys.list(filters),
    queryFn: () => api.get<Paginated<ReviewNote>>(`/review-notes?${buildQuery(filters)}`),
  })
}

export function useUpdateReviewNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number } & ReviewNotePatch) =>
      api.patch<ReviewNote>(`/review-notes/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['review-notes'] }),
  })
}
