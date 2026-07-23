import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { CategoryNode } from './types'

export const categoryKeys = {
  tree: ['categories', 'tree'] as const,
}

export function useCategoryTree() {
  return useQuery({
    queryKey: categoryKeys.tree,
    queryFn: () => api.get<CategoryNode[]>('/categories/tree'),
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
