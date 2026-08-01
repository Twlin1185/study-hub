// 임베드 카드 + 자리표시자 4종 (설계 §4.19 ③④).
//
// 색상은 전부 토큰(bg/surface/surface-raised/border/accent/muted) — 다크 모드 자동.
// 인쇄(F22): 카드는 펼친 채로 출력되고 print-avoid-break로 페이지 중간 분할을 피한다.
// 본문 렌더는 MarkdownView를 다시 부르지만 import 순환을 피하려고 renderContent 콜백을 받는다.
import type { ReactNode } from 'react'
import { EmbedRenderContext, useEmbedEntry, useEmbedRenderCtx } from './embedContext'
import type { EmbedRenderCtx } from './embedContext'
import { useOpenRefDocument } from './useOpenRefDocument'
import type { EmbedResolveItem } from '../../api/embeds'
import {
  MAX_EMBED_DEPTH,
  cyclePlaceholder,
  deletedPlaceholder,
  depthPlaceholder,
  missingPlaceholder,
} from './refSyntax'

interface EmbedCardProps {
  docNo: string
  alias?: string
  // 대상 문서 본문을 같은 렌더러로 재귀 렌더한다(깊이·방문 집합은 Provider로 전달).
  renderContent: (content: string, docNo: string) => ReactNode
}

const BOX = 'print-avoid-break my-3 rounded-lg border border-border'

function PlaceholderBox({
  text,
  onOpen,
}: {
  text: string
  onOpen?: () => void
}) {
  return (
    <div className={`${BOX} border-dashed bg-bg px-3 py-2`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 flex-1 text-xs text-muted">{text}</p>
        {onOpen && (
          <button
            type="button"
            onClick={onOpen}
            className="shrink-0 rounded border border-border px-2 py-1 text-xs text-primary hover:bg-surface print:hidden"
          >
            원문 열기
          </button>
        )}
      </div>
    </div>
  )
}

export default function EmbedCard({ docNo, alias, renderContent }: EmbedCardProps) {
  const ctx = useEmbedRenderCtx()
  const openDocument = useOpenRefDocument()

  const depth = ctx?.depth ?? 0
  const ancestors = ctx?.ancestors ?? []
  // 순환 = 조상 체인(루트 doc_no 포함)에 이미 있는 문서. 자기 자신 임베드도 여기서 걸린다.
  const isCycle = ancestors.includes(docNo)
  // 이 카드가 펼칠 본문의 깊이 = 현재 깊이 + 1. MAX_EMBED_DEPTH 초과면 펼치지 않는다.
  const tooDeep = depth + 1 > MAX_EMBED_DEPTH

  // 순환은 대상 정보가 필요 없으므로 해석 요청 자체를 보내지 않는다(무한 fetch 0).
  const entry = useEmbedEntry(ctx?.resolver ?? null, docNo, !isCycle)
  const item: EmbedResolveItem | undefined = entry?.item
  const open = () => openDocument(docNo, item)

  if (isCycle) {
    return <PlaceholderBox text={cyclePlaceholder(docNo)} onOpen={open} />
  }

  if (entry?.status === 'error') {
    return (
      <div className={`${BOX} border-dashed bg-bg px-3 py-2`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 flex-1 text-xs text-wrong">
            {docNo} — {entry.error}
          </p>
          <button
            type="button"
            onClick={() => ctx?.resolver.retry(docNo)}
            className="shrink-0 rounded border border-border px-2 py-1 text-xs text-primary hover:bg-surface print:hidden"
          >
            다시 시도
          </button>
        </div>
      </div>
    )
  }

  if (!entry || entry.status === 'loading' || !item) {
    return (
      <div className={`${BOX} bg-bg px-3 py-2 text-xs text-muted`}>임베드 불러오는 중… ({docNo})</div>
    )
  }

  if (!item.found) {
    return <PlaceholderBox text={missingPlaceholder(docNo)} />
  }

  if (item.is_active === false) {
    return <PlaceholderBox text={deletedPlaceholder(docNo, item.title)} />
  }

  if (tooDeep) {
    return <PlaceholderBox text={depthPlaceholder(docNo, item.title)} onOpen={open} />
  }

  const displayTitle = alias || item.title || docNo
  const childCtx: EmbedRenderCtx = {
    resolver: ctx!.resolver,
    depth: depth + 1,
    ancestors: [...ancestors, docNo],
  }

  return (
    <div className={`${BOX} bg-surface-raised`}>
      {/* 출처 배지 — DOC-번호 · 제목(별칭 우선) + 원문 열기 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="shrink-0 rounded bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent">
            임베드
          </span>
          <span className="shrink-0 text-[11px] text-muted">{docNo}</span>
          <span className="truncate text-xs text-primary" title={item.title ?? docNo}>
            {displayTitle}
          </span>
        </span>
        <button
          type="button"
          onClick={open}
          className="shrink-0 rounded border border-border px-2 py-0.5 text-[11px] text-primary hover:bg-bg print:hidden"
        >
          원문 열기
        </button>
      </div>
      <div className="px-3 py-1">
        <EmbedRenderContext.Provider value={childCtx}>
          {item.content ? (
            renderContent(item.content, docNo)
          ) : (
            <p className="py-1 text-xs text-muted">본문이 비어 있습니다.</p>
          )}
        </EmbedRenderContext.Provider>
      </div>
    </div>
  )
}
