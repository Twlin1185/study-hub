import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { CategoryNode } from './types'

export const categoryKeys = {
  tree: ['categories', 'tree'] as const,
  // pipeline 변형도 tree 접두를 공유 — 기존 invalidateQueries({queryKey:['categories','tree']})가 함께 무효화.
  treePipeline: ['categories', 'tree', 'pipeline'] as const,
}

export function useCategoryTree() {
  return useQuery({
    queryKey: categoryKeys.tree,
    queryFn: () => api.get<CategoryNode[]>('/categories/tree'),
  })
}

// GET /api/categories/tree?pipeline=1 — 노드별 stage_progress(3단 진도) 포함 (§4.12, S9/F37).
// 파라미터 없는 기존 트리와 응답이 다르므로(집계 필드 추가) 별도 캐시 키로 둔다.
export function useCategoryTreePipeline() {
  return useQuery({
    queryKey: categoryKeys.treePipeline,
    queryFn: () => api.get<CategoryNode[]>('/categories/tree?pipeline=1'),
  })
}

export interface CreateCategoryInput {
  parent_id: number | null
  name: string
  level_hint?: string | null
  exam_date?: string | null
}

export function useCreateCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateCategoryInput) => api.post<CategoryNode>('/categories', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: categoryKeys.tree }),
  })
}

export interface UpdateCategoryInput {
  id: number
  name?: string
  level_hint?: string | null
  exam_date?: string | null
}

export function useUpdateCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateCategoryInput) =>
      api.patch<CategoryNode>(`/categories/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: categoryKeys.tree }),
  })
}

export interface MoveCategoryInput {
  id: number
  parent_id: number | null
  sort_order?: number
}

export function useMoveCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: MoveCategoryInput) =>
      api.post<CategoryNode>(`/categories/${id}/move`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: categoryKeys.tree }),
  })
}

export function useDeleteCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/categories/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: categoryKeys.tree }),
  })
}
