// 신규 커스텀 블록 2종의 리더(열람 표면) 렌더 — 목차(`::toc`) · 웹 임베드(`::web{url= title=}`)
// (stage-37 규약 A·B, F-5). 편집 표면(BlockNote 노드 뷰)은 별개 구현(다른 묶음 소관) — 이 파일은
// react-markdown 기반 공용 리더(`MarkdownView.tsx`)에서만 쓰인다. 색상은 토큰 클래스만
// (색상 하드코딩 금지 — 불변 규칙 5). 초기 청크에 실리므로 로직을 가볍게 유지한다(R37).
import { useEffect, useRef, useState } from 'react'
import { slugifyHeading } from './refSyntax'

// ---- 목차(::toc) — 규약 A ----
//
// 저장 데이터가 없는 원자 블록이라 리더도 렌더 시점에 **같은 렌더 트리(자기 표면)**의 헤딩을
// 훑어 파생한다. 앵커 id는 F43 `HeadingAnchorChip`과 똑같이 매 호출 새 `GithubSlugger` 인스턴스로
// 계산한다(= 항상 "그 텍스트의 첫 번째 등장" 헤딩을 가리킨다 — 중복 헤딩은 그 관례 그대로 첫 일치
// 이동). `rehype-slug`가 실제 DOM에 부여한 id(같은 라이브러리·순차 슬러거)와 일치하므로 같은
// 슬러그 도메인을 재사용하는 것이 된다(새 규칙 발명 없음).
interface TocEntry {
  id: string
  text: string
  level: number
}

function collectHeadings(root: Element): TocEntry[] {
  const headings = Array.from(root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6'))
  return headings.map((h) => {
    const text = h.textContent ?? ''
    return { id: slugifyHeading(text), text, level: Number(h.tagName.slice(1)) }
  })
}

export function TocBlockReader() {
  const anchorRef = useRef<HTMLElement>(null)
  const [entries, setEntries] = useState<TocEntry[]>([])

  useEffect(() => {
    // 리더 콘텐츠는 이 컴포넌트 수명 동안 정적이다(문서 본문이 바뀌면 ReactMarkdown이 트리를
    // 통째로 다시 그려 이 컴포넌트도 새로 마운트된다) — 마운트 1회만 훑으면 된다. 빈 deps 없이
    // 매 렌더 돌리면 `collectHeadings`가 매번 새 배열을 반환해 `setEntries`가 무한 재렌더를
    // 유발한다(실측 방지).
    const root = anchorRef.current?.closest('[data-markdown-root]')
    setEntries(root ? collectHeadings(root) : [])
  }, [])

  function goTo(id: string) {
    const root = anchorRef.current?.closest('[data-markdown-root]')
    if (!root) return
    const target = Array.from(root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')).find(
      (h) => h.id === id,
    )
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <nav
      ref={anchorRef}
      aria-label="목차"
      className="print-avoid-break my-3 rounded-lg border border-border bg-surface px-3 py-2"
    >
      <p className="text-sm font-medium text-primary">목차</p>
      {entries.length === 0 ? (
        <p className="mt-1 text-sm text-muted">이 문서에 제목이 없습니다</p>
      ) : (
        <ul className="mt-1 space-y-0.5">
          {entries.map((entry, idx) => (
            // 헤딩 텍스트가 유일 키가 아닐 수 있어(중복 헤딩) 인덱스를 함께 쓴다.
            <li key={`${entry.id}-${idx}`} style={{ paddingLeft: `${(entry.level - 1) * 0.75}rem` }}>
              <button
                type="button"
                onClick={() => goTo(entry.id)}
                className="block max-w-full truncate text-left text-sm text-accent hover:underline print:text-primary"
              >
                {entry.text || '(제목 없음)'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </nav>
  )
}

// ---- 웹 임베드(::web{url= title=}) — 규약 B ----
//
// 리더·인쇄는 **항상 카드**(iframe 절대 금지 — §4.30 ③·편집 표면 전용). directive에는 url·title만
// 있어 §4.30 meta 캐시(설명·썸네일·파비콘)는 리더에 실리지 않는다(명문화된 강등 손실) — 그래서
// 파비콘 자리는 항상 도메인 이니셜로 채운다(원격 이미지 로드 없음 = 실패할 것이 없다 = 조용한
// 실패 없음).
function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function WebEmbedCardReader({ url, title }: { url: string; title?: string }) {
  const domain = domainOf(url)
  const label = title || domain || url
  const initial = (domain || url || '?').trim().charAt(0).toUpperCase() || '?'

  return (
    <a
      href={url || undefined}
      target="_blank"
      rel="noopener noreferrer"
      className="print-avoid-break my-3 flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-primary no-underline hover:bg-bg"
    >
      <span
        aria-hidden="true"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-bg text-sm font-semibold text-muted"
      >
        {initial}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-primary">{label}</span>
        {domain ? <span className="block truncate text-xs text-muted">{domain}</span> : null}
      </span>
    </a>
  )
}
