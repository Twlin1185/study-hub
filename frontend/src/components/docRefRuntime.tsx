import { createContext, useContext, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { slugifyHeading } from '../utils/docRefs'
import type { DocumentType, FontScale, ResolveEmbedItem } from '../api/types'
// 순환 import: MarkdownView.tsx도 이 파일(components 맵)을 가져온다. 실제 사용은 렌더
// 함수 안(EmbedCard 호출 시점)으로 지연되므로 모듈 그래프 순환은 안전하다 — MarkdownView는
// `export default function MarkdownView(...)` 함수 선언(호이스팅)으로 내보낸다.
import MarkdownView from './MarkdownView'

// 문서 상호참조·트랜스클루전 렌더 런타임 (설계 §4.19, S17) — MarkdownView가 재귀적으로 자신을
// 감싸는 컨텍스트를 제공하고, 아래 컴포넌트들(EmbedNode·LinkNode·AnchorNode·FoldBlock·
// HideBlock 등)은 전부 모듈 레벨(안정된 참조)로 유지한다. react-markdown의 `components` 맵
// 자체는 매 렌더 새 객체를 만들어도 무방하지만, 그 값(컴포넌트 함수)이 매 렌더 바뀌면 React가
// 타입이 바뀐 것으로 보고 재마운트해 FoldBlock/HideBlock의 펼침·공개 로컬 상태가 날아간다 —
// 그래서 "현재 깊이·방문 집합·해석 응답" 같은 가변 정보는 컴포넌트 identity가 아니라 Context로
// 흘려보낸다.

export interface DocRefChainEntry {
  docNo: string
  id: number
}

export interface DocRefContextValue {
  resolveMap: Map<string, ResolveEmbedItem>
  missingSet: Set<string>
  loading: boolean
  chain: DocRefChainEntry[]
  depth: number
  printMode: boolean
  scale: FontScale
}

export const DocRefContext = createContext<DocRefContextValue>({
  resolveMap: new Map(),
  missingSet: new Set(),
  loading: false,
  chain: [],
  depth: 0,
  printMode: false,
  scale: 'default',
})

const TYPE_LABEL: Record<DocumentType, string> = {
  concept: '개념',
  question: '문제',
  past_question: '기출문제',
  flashcard: '플래시카드',
}

function useGoToDoc() {
  const navigate = useNavigate()
  return (id: number) => navigate(`/docs/${id}`)
}

// ---- 자리표시자 3종 (설계 §4.19 ④ 확정 문구) ----

function PlaceholderCard({
  tone,
  children,
}: {
  tone: 'cycle' | 'deleted' | 'missing'
  children: ReactNode
}) {
  const toneClass =
    tone === 'missing'
      ? 'border-border bg-bg text-muted'
      : 'border-warning bg-bg text-muted'
  return (
    <span
      className={`doc-ref-placeholder my-1 inline-flex max-w-full flex-wrap items-center gap-2 rounded border px-2.5 py-1.5 text-xs ${toneClass}`}
    >
      {children}
    </span>
  )
}

function CyclePlaceholder({ docNo, targetId }: { docNo: string; targetId?: number }) {
  const goTo = useGoToDoc()
  return (
    <PlaceholderCard tone="cycle">
      <span>
        순환 참조 — {docNo}은(는) 현재 참조 사슬에 이미 포함되어 여기서는 펼치지 않습니다.
      </span>
      {/* targetId는 docId를 모르는 조상(-1 sentinel)일 수 있다 — 그런 경우 깨진 링크
          대신 버튼 자체를 숨긴다. */}
      {targetId != null && targetId >= 0 && (
        <button
          type="button"
          onClick={() => goTo(targetId)}
          className="shrink-0 rounded border border-border px-2 py-1 text-[11px] text-primary hover:bg-surface"
        >
          원문 열기
        </button>
      )}
    </PlaceholderCard>
  )
}

function DeletedPlaceholder({ docNo, title }: { docNo: string; title?: string }) {
  return (
    <PlaceholderCard tone="deleted">
      삭제된 문서 — {docNo}『{title ?? '제목 없음'}』은(는) 삭제되어 내용을 표시하지 않습니다.
      복원하면 다시 표시됩니다.
    </PlaceholderCard>
  )
}

function MissingPlaceholder({ docNo }: { docNo: string }) {
  return <PlaceholderCard tone="missing">존재하지 않는 참조 — {docNo} 문서를 찾을 수 없습니다.</PlaceholderCard>
}

function LoadingPlaceholder({ docNo }: { docNo: string }) {
  return (
    <PlaceholderCard tone="missing">
      <span className="animate-pulse">{docNo} 불러오는 중…</span>
    </PlaceholderCard>
  )
}

// ---- 임베드 카드 (설계 §4.19 ⑥) ----

function EmbedCard({ item }: { item: ResolveEmbedItem }) {
  const goTo = useGoToDoc()
  const ctx = useContext(DocRefContext)
  return (
    <div className="doc-embed-card print-avoid-break my-3 rounded-lg border border-border bg-bg p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="shrink-0 rounded bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent">
            {item.doc_no}
          </span>
          <span className="min-w-0 truncate text-xs font-medium text-primary">{item.title}</span>
          <span className="shrink-0 text-[11px] text-muted">{TYPE_LABEL[item.type] ?? item.type}</span>
        </div>
        <button
          type="button"
          onClick={() => goTo(item.id)}
          className="shrink-0 rounded border border-border px-2 py-1 text-[11px] text-primary hover:bg-surface print:hidden"
        >
          원문 열기
        </button>
      </div>
      {/* 재귀 렌더 — 깊이 상한(2)·방문 집합은 MarkdownView 자신이 다음 Provider로 내려준다. */}
      <MarkdownView
        content={item.content}
        docNo={item.doc_no}
        docId={item.id}
        visited={ctx.chain}
        depth={ctx.depth + 1}
        printMode={ctx.printMode}
        scale={ctx.scale}
      />
    </div>
  )
}

// ---- 임베드 노드 (![[DOC-xxxx]]) ----

export function EmbedNode({ docNo }: { docNo: string }) {
  const ctx = useContext(DocRefContext)
  const ancestor = ctx.chain.find((c) => c.docNo === docNo)
  if (ancestor) {
    return <CyclePlaceholder docNo={docNo} targetId={ancestor.id} />
  }
  if (ctx.depth >= 2) {
    // 깊이 상한 초과 — 카드 대신 문서 링크 칩으로 강등(설계 §4.19 ④).
    return <LinkNode docNo={docNo} />
  }
  if (ctx.missingSet.has(docNo)) {
    return <MissingPlaceholder docNo={docNo} />
  }
  const item = ctx.resolveMap.get(docNo)
  if (!item) {
    return ctx.loading ? <LoadingPlaceholder docNo={docNo} /> : <MissingPlaceholder docNo={docNo} />
  }
  if (!item.is_active) {
    return <DeletedPlaceholder docNo={docNo} title={item.title} />
  }
  return <EmbedCard item={item} />
}

// ---- 문서 링크 칩 ([[DOC-xxxx]] / [[DOC-xxxx|표시명]]) ----

export function LinkNode({ docNo, alias }: { docNo: string; alias?: string }) {
  const ctx = useContext(DocRefContext)
  const goTo = useGoToDoc()
  const item = ctx.resolveMap.get(docNo)
  const label = alias || item?.title || docNo
  if (item) {
    return (
      <button
        type="button"
        onClick={() => goTo(item.id)}
        className="doc-link-chip mx-0.5 inline-flex items-center gap-1 rounded border border-accent bg-accent-soft px-1.5 py-0.5 align-baseline text-xs font-medium text-accent hover:opacity-90 print:border-border print:bg-transparent print:text-primary"
        title={`${docNo} · ${item.title}`}
      >
        {label}
      </button>
    )
  }
  const isMissing = ctx.missingSet.has(docNo)
  return (
    <span
      className="doc-link-chip mx-0.5 inline-flex items-center gap-1 rounded border border-border bg-bg px-1.5 py-0.5 align-baseline text-xs text-muted"
      title={isMissing ? '존재하지 않는 참조' : '불러오는 중…'}
    >
      {label}
    </span>
  )
}

// ---- 헤딩 앵커 ([[#절 제목]]) ----

export function AnchorNode({ text }: { text: string }) {
  const slug = slugifyHeading(text)
  function handleClick() {
    const el = document.getElementById(slug)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  return (
    <button
      type="button"
      onClick={handleClick}
      className="doc-anchor-chip mx-0.5 inline-flex items-center gap-1 rounded border border-border bg-bg px-1.5 py-0.5 align-baseline text-xs text-primary hover:bg-surface print:hidden"
      title={`"${text}" 절로 이동`}
    >
      ↳ {text}
    </button>
  )
}

// ---- 접기(fold) — 기본 접힘, 클릭 펼침(설계 §4.19 ②) ----

export function FoldBlock({ label, children }: { label?: string; children?: ReactNode }) {
  const ctx = useContext(DocRefContext)
  const [open, setOpen] = useState(false)
  const expanded = ctx.printMode || open
  return (
    <div className="doc-fold my-2 overflow-hidden rounded border border-border bg-bg">
      {/* 인쇄에서는 토글 버튼(화면 전용 인터랙션)을 없애되, 라벨 자체는 정리본 구조를 위해
          제목 형태로 남긴다(설계 §4.19 ⑥ — fold 펼침·화면 상호작용만 제거). */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-primary hover:bg-surface print:hidden"
      >
        <span className="shrink-0 text-muted">{expanded ? '▾' : '▸'}</span>
        <span>{label || '접힌 내용'}</span>
      </button>
      <p className="hidden px-3 pt-2 text-sm font-medium text-primary print:block">{label || '접힌 내용'}</p>
      {expanded && <div className="border-t border-border px-3 py-2 text-sm text-primary print:border-t-0">{children}</div>}
    </div>
  )
}

// ---- 가리기(hide) — 기본 가림, 탭/클릭 공개·재탭 재가림(설계 §4.19 ②) ----

// 라벨 버튼이 유일한 토글 컨트롤이다 — 공개된 뒤에는 본문 영역에 클릭 핸들러를 두지 않아
// 내부의 문서 링크 칩·임베드 카드 [원문 열기] 같은 중첩 인터랙션이 이벤트 버블링으로
// 재가림을 트리거하지 않는다. 가려진 동안에는 본문 자체를 탭해도 공개되게(넓은 탭 영역,
// 모바일 친화) 클릭 핸들러를 그때만 붙인다.
export function HideBlock({ label, children }: { label?: string; children?: ReactNode }) {
  const ctx = useContext(DocRefContext)
  const [revealed, setRevealed] = useState(false)
  const shown = ctx.printMode || revealed
  return (
    <div className="doc-hide my-2 rounded border border-border bg-bg px-3 py-2">
      <button
        type="button"
        onClick={() => setRevealed((v) => !v)}
        aria-pressed={shown}
        className="mb-1 block w-full text-left text-xs font-medium text-muted hover:text-primary print:hidden"
      >
        {shown ? `${label ? label + ' — ' : ''}공개됨 · 탭하면 다시 가려집니다` : `${label || '가려진 내용'} — 탭하여 공개`}
      </button>
      {/* 인쇄에서는 탭 안내 대신 라벨만 남긴다(설계 §4.19 ⑥ — hide 공개). */}
      {label && <p className="mb-1 hidden text-xs font-medium text-muted print:block">{label}</p>}
      <div
        onClick={shown ? undefined : () => setRevealed(true)}
        className={`text-sm text-primary ${shown ? '' : 'cursor-pointer select-none blur-sm'}`}
      >
        {children}
      </div>
    </div>
  )
}

// ---- 미등록 지시자(:::기타) — 스타일 없이 내용만 렌더 ----

export function GenericDirectiveDiv({ children }: { children?: ReactNode }) {
  return <div>{children}</div>
}

export const MARKDOWN_REF_COMPONENTS = {
  docembed: ({ docNo }: { docNo: string }) => <EmbedNode docNo={docNo} />,
  doclink: ({ docNo, alias }: { docNo: string; alias?: string }) => <LinkNode docNo={docNo} alias={alias} />,
  docanchor: ({ text }: { text: string }) => <AnchorNode text={text} />,
  'fold-block': FoldBlock,
  'hide-block': HideBlock,
  'directive-generic': GenericDirectiveDiv,
} as const
