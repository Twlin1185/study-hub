// 노트 API 훅 — 설계 §4.28 [S33]. 기존 `api/client.ts`를 **그대로 재사용**한다
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

/**
 * 서버 시각 문자열 → Date.
 *
 * `notes` 응답의 `created_at`/`updated_at`은 **타임존 표기 없는 UTC naive ISO**다
 * (§4.28 ② 예시 `"2026-08-16T21:03:11"`). 브라우저는 그런 문자열을 **로컬 시각**으로 해석하므로
 * KST(+9) 환경에서 9시간 과거로 읽힌다(2026-08-16 통합 스모크 실측 — "9시간 전"으로 표시됨).
 * 오프셋(`Z`·`+09:00`·`+0900`)이 이미 붙어 있으면 그대로 둔다(서버 포맷이 바뀌어도 안전).
 */
export function parseServerDate(iso: string | null | undefined): Date {
  const text = (iso ?? '').trim()
  if (!text) return new Date(Number.NaN)
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)
  return new Date(hasZone ? text : `${text}Z`)
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
    // 낙관적 업데이트·낙관적 잠금 없다(stage-33 확정 규약 C · `editor-v2.plan.md` §7.2 단일 사용자
    // 전제 — 마지막 저장이 이긴다. §4.28 ⑥ "동시 편집" 행과 동일).
    //
    // 저장에 성공하면 **서버가 돌려준 노트로 단건 캐시를 직접 갱신**한다(`setQueryData`).
    // 이것은 **재요청이 아니다** — "편집 중인 표면은 다시 끌어오지 않는다"는 종전 계약을 그대로
    // 지키면서(네트워크 왕복 0), 캐시가 낡은 채 남지 않게만 한다.
    // 갱신하지 않으면(2026-08-19 사용자 실사용 결함): 노트를 쓰고 목록으로 나갔다가 **같은 노트로
    // 다시 들어올 때** `useNote`가 편집 전 캐시(전역 staleTime 30초)를 그대로 돌려주고, 편집 표면은
    // 첫 데이터로 1회만 시드되므로 뒤늦게 도착한 refetch도 반영되지 않아 **작성한 내용이 사라진 것처럼
    // 보인다**(새로고침하면 보임 = 캐시만의 문제). staleTime 안(재요청 없음)·밖(오래된 값으로 먼저
    // 시드) 두 경우가 모두 이 한 줄로 닫힌다.
    onSuccess: (data, variables) => {
      qc.setQueryData(noteKeys.detail(variables.id), data)
      qc.invalidateQueries({ queryKey: noteKeys.lists() })
    },
  })
}

export function useDeleteNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<Note>(`/notes/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: noteKeys.all }),
  })
}
