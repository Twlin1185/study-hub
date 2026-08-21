// 웹 임베드 메타 조회 — `POST /api/web-embed/preview` 클라이언트(api §4.30, stage-37 F-4).
//
// 서버 응답은 **스네이크 케이스**(`site_name`·`fetched_at`)이고 앱 캐시(`WebEmbedMeta`)는
// **카멜 케이스**(`siteName`·`fetchedAt`)다 — 이 파일이 그 경계를 잇는 유일한 지점이다(다른 곳에서
// snake_case 응답 필드를 직접 다루지 않는다).
//
// DB 쓰기 0·파일 쓰기 0(§4.30 ①) — 이 호출은 순수 조회이고, 캐시는 호출자가 블록 prop에 담는다.
import { api, ApiError } from '../../../api/client'

export interface WebEmbedPreview {
  url: string
  title: string | null
  description: string | null
  siteName: string | null
  image: string | null
  favicon: string | null
  fetchedAt: string | null
}

interface WebEmbedPreviewDto {
  url: string
  title: string | null
  description: string | null
  site_name: string | null
  image: string | null
  favicon: string | null
  fetched_at: string
}

/**
 * 1회 조회(§4.30). 실패(422 `invalid_url`/`blocked_address`/`fetch_failed`·네트워크 오류 등)는
 * 여기서 던져지는 그대로 호출자에게 전달한다 — **삽입을 막지 않는 것은 호출자(`insert.ts`)의
 * 책임**이지 이 함수의 책임이 아니다(이 함수는 "조회 1회"만 정직하게 담당한다).
 */
export async function fetchWebEmbedPreview(url: string): Promise<WebEmbedPreview> {
  const res = await api.post<WebEmbedPreviewDto>('/web-embed/preview', { url })
  return {
    url: res.url,
    title: res.title ?? null,
    description: res.description ?? null,
    siteName: res.site_name ?? null,
    image: res.image ?? null,
    favicon: res.favicon ?? null,
    fetchedAt: res.fetched_at ?? null,
  }
}

/** 실패 사유의 한국어 문구(§3 규약 — 서버 message를 그대로 우선하고, 못 읽으면 일반 문구로 대체). */
export function webEmbedFetchErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  return '메타 정보를 가져오지 못했습니다(오프라인이거나 응답이 없습니다).'
}
