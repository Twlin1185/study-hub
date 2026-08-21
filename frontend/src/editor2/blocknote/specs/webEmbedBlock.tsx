// 웹 임베드 블록 — 편집 표면 스펙(M35 / stage-37 F-4 · 규약 B · api §4.30).
//
// prop 3개(`url`·`title`·`meta`)는 어댑터(`BnWebEmbed`)와 **완전히 같은 모양**이다 — `meta`는
// §4.30 응답 캐시를 통짜 JSON 문자열로 싣는다(`callout.attrs` 전례). 여기서 하는 `parseMeta`는
// **표시 전용**(render 안에서만 쓴다) — 저장·로드 왕복은 여전히 어댑터(`fromBlockNote.ts`의
// `decodeWebEmbedMeta`)가 담당하고 이 파일은 그 결정을 건드리지 않는다.
//
// 카드 렌더: 저장 메타 기반(제목 = title → 도메인 폴백). 썸네일·파비콘은 **원격 URL 그대로**
// 로드하고, 실패하면(onError) 도메인 이니셜로 강등한다(조용한 실패 없음). [메타 새로고침]은
// **명시 조작 1곳뿐**(§4.30 계약 — 마운트·펼침 시 자동 재조회 없음).
//
// iframe은 **이 편집 표면 컴포넌트 안에서만** 그린다(리더는 이 파일을 아예 import하지 않는다 —
// `components/markdown/`는 별도 렌더 경로). 화이트리스트는 `webEmbed/youtube.ts` 1곳,
// sandbox·referrerpolicy·loading은 규약 B 그대로.
import { createReactBlockSpec } from '@blocknote/react'
import { useEffect, useState } from 'react'
import type { MouseEvent } from 'react'
import { fetchWebEmbedPreview, webEmbedFetchErrorMessage } from '../webEmbed/api'
import { resolveYoutubeEmbedUrl } from '../webEmbed/youtube'

interface WebEmbedMetaLike {
  description?: string | null
  siteName?: string | null
  image?: string | null
  favicon?: string | null
  fetchedAt?: string | null
}

function parseMeta(raw: string | undefined): WebEmbedMetaLike | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as WebEmbedMetaLike
  } catch {
    return null
  }
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function domainInitial(domain: string): string {
  const ch = domain.trim().charAt(0)
  return ch ? ch.toUpperCase() : '?'
}

export const createWebEmbedBlockSpec = createReactBlockSpec(
  {
    type: 'webEmbed',
    propSchema: {
      url: { default: '' as string },
      title: { default: '' as string },
      meta: { default: '' as string },
    },
    content: 'none',
  },
  {
    render: function WebEmbedBlockRender({ block, editor }) {
      const { url, title } = block.props
      const meta = parseMeta(block.props.meta)
      const domain = domainOf(url)
      const displayTitle = title || domain || '(URL 없음)'
      const embedUrl = resolveYoutubeEmbedUrl(url)

      // 메타가 바뀌면(새로고침·재로드) 이전 실패 상태를 들고 있지 않는다.
      const [imgOk, setImgOk] = useState(true)
      const [faviconOk, setFaviconOk] = useState(true)
      useEffect(() => {
        setImgOk(true)
        setFaviconOk(true)
      }, [meta?.image, meta?.favicon])

      const [showEmbed, setShowEmbed] = useState(false)
      const [refreshing, setRefreshing] = useState(false)
      const [refreshError, setRefreshError] = useState<string | null>(null)

      const refresh = async (event: MouseEvent<HTMLButtonElement>) => {
        event.preventDefault()
        event.stopPropagation()
        if (!url || refreshing) return
        setRefreshing(true)
        setRefreshError(null)
        try {
          const preview = await fetchWebEmbedPreview(url)
          editor.updateBlock(block, {
            type: 'webEmbed',
            props: {
              url,
              // 부분 성공(title=null)이 기존 제목을 빈 값으로 후퇴시키지 않는다.
              title: preview.title ?? title,
              // 기존 주머니를 스프레드해 §4.30 응답 5필드 밖의 공존 필드(예약 `provenance` 등)를
              // 보존한다 — 새로고침은 대체가 아니라 병합.
              meta: JSON.stringify({
                ...(parseMeta(block.props.meta) ?? {}),
                description: preview.description,
                siteName: preview.siteName,
                image: preview.image,
                favicon: preview.favicon,
                fetchedAt: preview.fetchedAt,
              }),
            },
          })
        } catch (error) {
          setRefreshError(webEmbedFetchErrorMessage(error))
        } finally {
          setRefreshing(false)
        }
      }

      const toggleEmbed = (event: MouseEvent<HTMLButtonElement>) => {
        event.preventDefault()
        event.stopPropagation()
        setShowEmbed((value) => !value)
      }

      return (
        <div className="my-1 w-full overflow-hidden rounded-lg border border-border bg-surface-raised text-sm">
          <div className="flex items-center gap-2 border-b border-border bg-bg px-2.5 py-1.5 text-xs text-muted">
            {meta?.favicon && faviconOk ? (
              <img
                src={meta.favicon}
                alt=""
                onError={() => setFaviconOk(false)}
                className="h-3.5 w-3.5 shrink-0 rounded-sm"
              />
            ) : (
              <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm bg-accent-soft text-[9px] font-semibold text-accent">
                {domainInitial(domain)}
              </span>
            )}
            <span className="truncate">{domain || 'URL 없음'}</span>
            <span className="ml-auto flex shrink-0 items-center gap-1">
              {embedUrl && (
                <button
                  type="button"
                  onClick={toggleEmbed}
                  className="rounded border border-border px-1.5 py-0.5 text-[11px] text-primary hover:bg-surface-raised"
                >
                  {showEmbed ? '카드로 보기' : '영상 재생'}
                </button>
              )}
              <button
                type="button"
                onClick={(event) => void refresh(event)}
                disabled={refreshing || !url}
                title="메타 새로고침"
                className="rounded border border-border px-1.5 py-0.5 text-[11px] text-primary hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50"
              >
                {refreshing ? '새로고침 중…' : '메타 새로고침'}
              </button>
            </span>
          </div>

          {refreshError && (
            <p className="border-b border-border px-2.5 py-1 text-[11px] text-wrong">
              새로고침 실패 — {refreshError}
            </p>
          )}

          {showEmbed && embedUrl ? (
            <div className="aspect-video w-full bg-bg">
              <iframe
                src={embedUrl}
                title={displayTitle}
                // 규약 B — 재생에 필요한 최소 sandbox + no-referrer + lazy + 전체화면 허용.
                sandbox="allow-scripts allow-same-origin"
                referrerPolicy="no-referrer"
                loading="lazy"
                allowFullScreen
                className="h-full w-full"
              />
            </div>
          ) : (
            <a
              href={url || undefined}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => {
                if (!url) event.preventDefault()
              }}
              className="flex gap-3 p-3 hover:bg-bg"
            >
              {meta?.image && imgOk ? (
                <img
                  src={meta.image}
                  alt=""
                  onError={() => setImgOk(false)}
                  className="h-16 w-16 shrink-0 rounded object-cover"
                />
              ) : (
                <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded bg-accent-soft text-lg font-semibold text-accent">
                  {domainInitial(domain)}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-primary">{displayTitle}</p>
                {meta?.description && (
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted">{meta.description}</p>
                )}
                <p className="mt-1 truncate text-[11px] text-muted">{url || '연결할 URL이 없습니다'}</p>
              </div>
            </a>
          )}
        </div>
      )
    },
  },
)
