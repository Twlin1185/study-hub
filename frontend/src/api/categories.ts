import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from './client'
import type { CategoryDeleteResult, CategoryNode } from './types'

// 삭제 실패 폴백 문구 — 규약 G "폴백 1곳" 단일 출처. 서버 에러(ApiError)는 그대로 message를 쓰고,
// 그 외(네트워크 오류 등)만 이 문구로 정규화한다 — 페이지 3곳은 e.message만 그대로 전달하면 된다.
const DELETE_CATEGORY_FALLBACK_MESSAGE = '삭제에 실패했습니다.'

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

// on_documents/recursive 미지정 = 종전 409 동작(쿼리 키 자체를 생략 — 기본 동작 보존, FB-24 ②).
export interface DeleteCategoryInput {
  id: number
  on_documents?: 'unlink' | 'reparent'
  recursive?: boolean
}

export function useDeleteCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, on_documents, recursive }: DeleteCategoryInput) => {
      const params = new URLSearchParams()
      if (on_documents) params.set('on_documents', on_documents)
      if (recursive) params.set('recursive', '1')
      const qs = params.toString()
      try {
        return await api.delete<CategoryDeleteResult | void>(`/categories/${id}${qs ? `?${qs}` : ''}`)
      } catch (e) {
        // ApiError는 서버 message를 그대로 보존 · 그 외만 폴백 문구로 정규화(단일 출처).
        if (e instanceof ApiError) throw e
        throw new Error(DELETE_CATEGORY_FALLBACK_MESSAGE)
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: categoryKeys.tree }),
  })
}
