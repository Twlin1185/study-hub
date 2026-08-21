// 목차(TOC) 블록 — 편집 표면 스펙(M35 / stage-37 F-3 · 규약 A).
//
// **저장 데이터 0**(propSchema 비어 있음) — 목차 내용은 저장하지 않고 렌더 시점에 같은 표면(=이
// `editor` 인스턴스)의 heading 블록에서 파생한다(`collectHeadings.ts`). 그래서 "자동 갱신"은 별도
// 동기화 로직이 필요 없다: 트랜잭션마다 다시 읽는 구독 훅(`useTocHeadings`)이 갱신을 대신한다.
//
// 클릭 스크롤은 BlockNote가 각 블록 컨테이너 DOM에 심어 두는 `data-id` 속성(코어 실측 — 사이드
// 메뉴·드래그 핸들도 같은 속성으로 대상 블록을 찾는다)을 이용한다. 새 규칙을 만드는 게 아니라
// 이미 있는 식별자를 읽기만 한다.
import { createReactBlockSpec } from '@blocknote/react'
import type { MouseEvent } from 'react'
import { useTocHeadings } from '../toc/collectHeadings'

export const createTocBlockSpec = createReactBlockSpec(
  {
    type: 'toc',
    propSchema: {},
    content: 'none',
  },
  {
    render: function TocBlockRender({ editor }) {
      const headings = useTocHeadings(editor)

      const goTo = (event: MouseEvent<HTMLButtonElement>, id: string) => {
        event.preventDefault()
        event.stopPropagation()
        const target = editor.domElement?.querySelector<HTMLElement>(`[data-id="${id}"]`)
        target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }

      return (
        <div className="my-1 w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm">
          <p className="mb-1 flex items-center gap-1.5 font-medium text-primary">
            <span aria-hidden className="text-muted">
              ▤
            </span>
            목차
          </p>
          {headings.length === 0 ? (
            <p className="text-xs text-muted">이 표면에 제목(heading)이 없습니다.</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {headings.map((heading) => (
                <li key={heading.id} style={{ paddingLeft: `${(heading.level - 1) * 0.9}rem` }}>
                  <button
                    type="button"
                    onClick={(event) => goTo(event, heading.id)}
                    className="w-full truncate rounded px-1 py-0.5 text-left text-accent hover:bg-bg hover:underline"
                  >
                    {heading.text || '(제목 없음)'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )
    },
  },
)
