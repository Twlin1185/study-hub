// 노트(베타) API 훅 — 설계 §4.28 [S33]. 기존 `api/client.ts`를 **그대로 재사용**한다
// (신규 파일만 만들고 기존 `api/`는 1바이트도 고치지 않는다 — D9 격리 계약).
//
// 저장 계약(§4.28 ③ · stage-33 규약 A): 소스 오브 트루스 = 블록 JSON(`content_blocks`).
// Markdown(`content`)은 **클라이언트 변환기의 파생 프로젝션**이며 **항상 같은 요청에 함께** 보낸다
// (한쪽만 보내면 서버가 422 `projection_required`). 서버는 Markdown을 만들지도 해석하지도 않는다.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, type Paginated } from '../../api/client'
import type { BlockDocument } from '../schema/blocks'

export interface Note {
  id: number
  title: string
  content_blocks: BlockDocument
  content: string
  blocks_version: number
  is_active: boolean
  created_at: string
  updated_at: string
}

/** 목록 항목 — 본문 대신 `excerpt`(서버가 만든 `content` 앞 200자 슬라이스, §4.28 ②). */
export interface NoteListItem {
  id: number
  title: string
  excerpt: string
  blocks_version: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface NoteListFilters {
  q?: string
  page?: number
  size?: number
}

/** 본문 저장 쌍 — 블록과 프로젝션은 언제나 함께 간다(규약 A). */
export interface NoteBody {
  content_blocks: BlockDocument
  content: string
}

export type NoteCreate = { title: string } & NoteBody
export type NotePatch = { title?: string } & Partial<NoteBody>

// 캐시 키 = 리소스 경로 관례(기존 훅 계승). 목록/단건을 분리해 자동 저장이 단건을 재요청하지 않게 한다.
export const noteKeys = {
  all: ['notes'] as const,
  lists: () => ['notes', 'list'] as const,
  list: (filters: NoteListFilters) => ['notes', 'list', filters] as const,
  detail: (id: number) => ['notes', 'detail', id] as const,
}

// 4xx는 재요청해도 결과가 바뀌지 않으므로 즉시 포기한다(기존 훅 관례).
function skip4xxRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false
  return failureCount < 1
}

function buildQuery(filters: NoteListFilters): string {
  const params = new URLSearchParams()
  const q = filters.q?.trim()
  if (q) params.set('q', q)
  params.set('page', String(filters.page ?? 1))
  params.set('size', String(filters.size ?? 50))
  return params.toString()
}

export function useNotes(filters: NoteListFilters) {
  return useQuery({
    queryKey: noteKeys.list(filters),
    queryFn: () => api.get<Paginated<NoteListItem>>(`/notes?${buildQuery(filters)}`),
    retry: skip4xxRetry,
  })
}

export function useNote(id: number | null) {
  return useQuery({
    queryKey: noteKeys.detail(id ?? 0),
    queryFn: () => api.get<Note>(`/notes/${id}`),
    enabled: id != null,
    retry: skip4xxRetry,
    // 편집 중 창을 다시 포커스했다고 서버 본문을 다시 끌어와 편집 표면과 어긋나게 하지 않는다.
    refetchOnWindowFocus: false,
  })
}

export function useCreateNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: NoteCreate) => api.post<Note>('/notes', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: noteKeys.lists() }),
  })
}

export function useUpdateNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number } & NotePatch) => api.patch<Note>(`/notes/${id}`, body),
    // 낙관적 업데이트는 하지 않는다(불변 규칙 4) — 서버 응답을 받은 뒤 목록만 무효화한다.
    // 단건은 편집 중인 표면이므로 재요청하지 않는다(자동 저장이 1.5초마다 돌 수 있다).
    onSuccess: () => qc.invalidateQueries({ queryKey: noteKeys.lists() }),
  })
}

export function useDeleteNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<Note>(`/notes/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: noteKeys.all }),
  })
}
