// 통합 휴지통 API 훅 — 설계 §5.17·§4.32(S52, D8-구현 · F61).
// 문서·노트 목록은 기존 Paginated<DocumentListItem>/<NoteListItem>을 그대로 재사용(신규 타입 0).
// 이미지 스캔은 DB 전 행 텍스트를 읽는 비용이 있어 **자동 호출 0**(enabled:false + 수동 refetch).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, type Paginated } from './client'
import type { DocumentListItem, TrashImagesReport, TrashMoveResult, TrashRestoreResult } from './types'
import type { NoteListItem } from '../editor2/api/notes'

export interface TrashPageFilters {
  page?: number
  size?: number
}

function buildPageQuery(filters: TrashPageFilters): string {
  const params = new URLSearchParams()
  params.set('page', String(filters.page ?? 1))
  params.set('size', String(filters.size ?? 50))
  return params.toString()
}

export const trashKeys = {
  documents: (filters: TrashPageFilters) => ['trash', 'documents', filters] as const,
  notes: (filters: TrashPageFilters) => ['trash', 'notes', filters] as const,
  images: ['trash', 'images'] as const,
}

// 폴백 문구 — 규약 G "mutationFn 1곳" 단일 출처(S50·S51 관례). ApiError는 서버 message 그대로.
const TRASH_IMAGES_MOVE_FALLBACK = '이미지를 휴지통으로 옮기지 못했습니다.'
const TRASH_IMAGES_RESTORE_FALLBACK = '이미지를 되돌리지 못했습니다.'

export function useTrashDocuments(filters: TrashPageFilters) {
  return useQuery({
    queryKey: trashKeys.documents(filters),
    queryFn: () => api.get<Paginated<DocumentListItem>>(`/trash/documents?${buildPageQuery(filters)}`),
  })
}

export function useTrashNotes(filters: TrashPageFilters) {
  return useQuery({
    queryKey: trashKeys.notes(filters),
    queryFn: () => api.get<Paginated<NoteListItem>>(`/trash/notes?${buildPageQuery(filters)}`),
  })
}

// 페이지 진입 시 자동 호출 0 — [고아 이미지 스캔] 버튼이 refetch()를 수동으로 호출한다(§5.17).
export function useTrashImages() {
  return useQuery({
    queryKey: trashKeys.images,
    queryFn: () => api.get<TrashImagesReport>('/trash/images'),
    enabled: false,
  })
}

export function useMoveImagesToTrash() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (filenames: string[]) => {
      try {
        return await api.post<TrashMoveResult>('/trash/images/move', { filenames })
      } catch (e) {
        if (e instanceof ApiError) throw e
        throw new Error(TRASH_IMAGES_MOVE_FALLBACK)
      }
    },
    onSuccess: () => {
      // 스캔 결과는 저장하지 않으므로(§5.17) 캐시 무효화가 아니라 호출부가 재스캔(refetch)한다.
      qc.removeQueries({ queryKey: trashKeys.images })
    },
  })
}

export function useRestoreImagesFromTrash() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (filenames: string[]) => {
      try {
        return await api.post<TrashRestoreResult>('/trash/images/restore', { filenames })
      } catch (e) {
        if (e instanceof ApiError) throw e
        throw new Error(TRASH_IMAGES_RESTORE_FALLBACK)
      }
    },
    onSuccess: () => {
      qc.removeQueries({ queryKey: trashKeys.images })
    },
  })
}
