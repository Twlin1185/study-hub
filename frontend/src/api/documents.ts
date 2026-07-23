import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, type Paginated } from './client'
import { categoryKeys } from './categories'
import type { DocumentDetail, DocumentListFilters, DocumentListItem, DocumentType } from './types'

export const documentKeys = {
  all: ['documents'] as const,
  list: (filters: DocumentListFilters) => ['documents', 'list', filters] as const,
  detail: (id: number) => ['documents', 'detail', id] as const,
}

function buildQuery(filters: DocumentListFilters): string {
  const params = new URLSearchParams()
  if (filters.category_id != null) params.set('category_id', String(filters.category_id))
  if (filters.deep) params.set('deep', '1')
  if (filters.type) params.set('type', filters.type)
  if (filters.tag) params.set('tag', filters.tag)
  if (filters.orphan) params.set('orphan', '1')
  params.set('page', String(filters.page ?? 1))
  params.set('size', String(filters.size ?? 50))
  return params.toString()
}

export function useDocuments(filters: DocumentListFilters) {
  return useQuery({
    queryKey: documentKeys.list(filters),
    queryFn: () => api.get<Paginated<DocumentListItem>>(`/documents?${buildQuery(filters)}`),
  })
}

export function useDocument(id: number | null) {
  return useQuery({
    queryKey: documentKeys.detail(id ?? -1),
    queryFn: () => api.get<DocumentDetail>(`/documents/${id}`),
    enabled: id != null,
  })
}

export interface CreateDocumentInput {
  type: DocumentType
  title: string
  content?: string | null
  choices?: string[] | null
  answer?: string | null
  explanation?: string | null
  difficulty?: number | null
  category_id?: number | null
}

export interface CreateDocumentResult {
  document: DocumentDetail
  linkError?: string
}

// 설계 §4.2: POST /documents는 category_id를 받지 않는다 (백엔드 DocumentCreate 스키마에 없음).
// 분류 자동 연결은 생성 성공 후 POST /documents/{id}/links를 체이닝해서 구현한다.
export function useCreateDocument() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ category_id, ...body }: CreateDocumentInput): Promise<CreateDocumentResult> => {
      const document = await api.post<DocumentDetail>('/documents', body)
      if (category_id != null) {
        try {
          await api.post<void>(`/documents/${document.id}/links`, { category_id })
        } catch (e) {
          return {
            document,
            linkError: e instanceof ApiError ? e.message : '분류 연결에 실패했습니다.',
          }
        }
      }
      return { document }
    },
    onSuccess: (result) => {
      // 문서는 생성되었으므로 목록은 항상 갱신. 트리(doc_count)는 연결이 실제로 성공했을 때만 갱신.
      qc.invalidateQueries({ queryKey: documentKeys.all })
      if (!result.linkError) {
        qc.invalidateQueries({ queryKey: categoryKeys.tree })
      }
    },
  })
}

export interface UpdateDocumentInput {
  id: number
  title?: string
  content?: string | null
  choices?: string[] | null
  answer?: string | null
  explanation?: string | null
  difficulty?: number | null
}

export function useUpdateDocument() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateDocumentInput) =>
      api.patch<DocumentDetail>(`/documents/${id}`, body),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: documentKeys.detail(variables.id) })
      qc.invalidateQueries({ queryKey: documentKeys.all })
    },
  })
}

export function useDeleteDocument() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/documents/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: documentKeys.all })
      qc.invalidateQueries({ queryKey: categoryKeys.tree })
    },
  })
}

export function useSetDocumentTags() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, tags }: { id: number; tags: string[] }) =>
      api.put<DocumentDetail>(`/documents/${id}/tags`, { tags }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: documentKeys.detail(variables.id) })
      qc.invalidateQueries({ queryKey: documentKeys.all })
      qc.invalidateQueries({ queryKey: ['tags'] })
    },
  })
}

export interface LinkDocumentInput {
  id: number
  category_id: number
  local_note?: string
  sort_order?: number
}

export function useLinkDocument() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: LinkDocumentInput) =>
      api.post<void>(`/documents/${id}/links`, body),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: documentKeys.detail(variables.id) })
      qc.invalidateQueries({ queryKey: documentKeys.all })
      qc.invalidateQueries({ queryKey: categoryKeys.tree })
    },
  })
}

export function useUnlinkDocument() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, categoryId }: { id: number; categoryId: number }) =>
      api.delete<void>(`/documents/${id}/links/${categoryId}`),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: documentKeys.detail(variables.id) })
      qc.invalidateQueries({ queryKey: documentKeys.all })
      qc.invalidateQueries({ queryKey: categoryKeys.tree })
    },
  })
}
