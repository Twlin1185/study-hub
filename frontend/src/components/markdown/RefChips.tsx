// 이동 버튼 — 문서 칩 `[[DOC-xxxx]]` · 헤딩 앵커 칩 `[[#절 제목]]` (설계 §4.19 ①⑤).
//
// 문서 칩: 제목을 임베드 해석 배치에 같이 실어 조회하고(별도 요청 없음) 클릭 시 문서로 이동.
//   부재·삭제 문서는 비활성 칩 + 자리표시자 문구를 툴팁으로 재사용한다.
// 앵커 칩: rehype-slug가 부여한 헤딩 id와 **같은 github-slugger**로 슬러그화해 비교,
//   현재 문서(가장 가까운 [data-markdown-root]) 범위 안에서만 찾는다 — 임베드된 문서 내부
//   헤딩으로의 앵커는 지원하지 않는다. 매칭 실패 = 무동작 + 비활성 칩.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useEmbedEntry, useEmbedRenderCtx } from './embedContext'
import { useOpenRefDocument } from './useOpenRefDocument'
import { deletedPlaceholder, missingPlaceholder, slugifyHeading } from './refSyntax'

const CHIP_BASE =
  'mx-0.5 inline-flex max-w-full items-center gap-1 rounded border px-1.5 py-0.5 align-baseline text-[0.85em] leading-tight'
const CHIP_ACTIVE = `${CHIP_BASE} border-border bg-bg text-accent hover:bg-accent-soft`
const CHIP_INACTIVE = `${CHIP_BASE} border-dashed border-border bg-bg text-muted cursor-not-allowed`

export function DocLinkChip({ docNo, alias }: { docNo: string; alias?: string }) {
  const ctx = useEmbedRenderCtx()
  const openDocument = useOpenRefDocument()
  const entry = useEmbedEntry(ctx?.resolver ?? null, docNo, true)
  const item = entry?.item

  const missing = entry?.status === 'ready' && item && !item.found
  const deleted = entry?.status === 'ready' && item?.found && item.is_active === false
  // 해석 응답 도착 전에는 문서 id를 몰라 이동할 수 없다 — 잠시 비활성.
  const documentId = item?.id ?? null
  const disabled = Boolean(missing || deleted) || documentId == null

  const label = alias || item?.title || docNo
  const tooltip = missing
    ? missingPlaceholder(docNo)
    : deleted
      ? deletedPlaceholder(docNo, item?.title)
      : documentId == null
        ? `${docNo} 정보를 불러오는 중입니다`
        : `${docNo} 문서 열기`

  return (
    <button
      type="button"
      disabled={disabled}
      title={tooltip}
      onClick={() => documentId != null && openDocument(documentId)}
      className={disabled ? CHIP_INACTIVE : CHIP_ACTIVE}
    >
      <span className="shrink-0 text-[0.9em] text-muted">{docNo}</span>
      <span className="truncate">{label}</span>
    </button>
  )
}

export function HeadingAnchorChip({ heading, alias }: { heading: string; alias?: string }) {
  const ref = useRef<HTMLButtonElement>(null)
  const [available, setAvailable] = useState(true)
  const slug = useMemo(() => slugifyHeading(heading), [heading])

  function findTarget(): HTMLElement | null {
    const root = ref.current?.closest('[data-markdown-root]')
    if (!root) return null
    const headings = Array.from(root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6'))
    return headings.find((h) => h.id === slug) ?? null
  }

  useEffect(() => {
    setAvailable(findTarget() != null)
    // 본문이 바뀌면 다시 확인한다(슬러그 기준).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  const label = alias || heading

  return (
    <button
      ref={ref}
      type="button"
      disabled={!available}
      title={available ? `"${heading}" 절로 이동` : `이 문서에 "${heading}" 절이 없습니다`}
      onClick={() => {
        const target = findTarget()
        if (!target) {
          setAvailable(false)
          return
        }
        target.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }}
      className={available ? CHIP_ACTIVE : CHIP_INACTIVE}
    >
      <span className="shrink-0 text-[0.9em] text-muted">#</span>
      <span className="truncate">{label}</span>
    </button>
  )
}
