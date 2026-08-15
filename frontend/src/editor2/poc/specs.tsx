// stage-31(M31) 판정용 스파이크 — 방언 커스텀 스펙 3종. 게이트 판정 후 폐기 가능해야 한다.
// 검증 목표: F52 방언(형광펜·스포일러)과 F43 참조 칩이 BlockNote 커스텀 스펙 API로 성립하는가.
import { createReactInlineContentSpec, createReactStyleSpec } from '@blocknote/react'
import { useState } from 'react'

// F52 형광펜(`==…==`) — 값(색 이름)을 갖는 스타일 스펙. 색은 poc.css에서 --mark-* 토큰으로 결선.
export const highlightSpec = createReactStyleSpec(
  { type: 'highlight', propSchema: 'string' },
  {
    render: ({ value, contentRef }) => (
      <mark className={`poc-mark poc-mark-${value ?? 'yellow'}`} ref={contentRef} />
    ),
  },
)

// F52 스포일러(`||…||`) — boolean 스타일 스펙 + 클릭 공개(리더 뷰 동작의 에디터 내 재현 확인용)
function SpoilerRender({ contentRef }: { contentRef: (el: HTMLElement | null) => void }) {
  const [revealed, setRevealed] = useState(false)
  return (
    <span
      className={revealed ? 'poc-spoiler poc-spoiler-open' : 'poc-spoiler'}
      onClick={() => setRevealed(true)}
      ref={contentRef}
    />
  )
}
export const spoilerSpec = createReactStyleSpec(
  { type: 'spoiler', propSchema: 'boolean' },
  { render: SpoilerRender },
)

// F43 참조 칩 — 원자 인라인 콘텐츠(content: 'none'): 내부 편집 불가, 한 단위로 삭제·이동
export const refChipSpec = createReactInlineContentSpec(
  {
    type: 'refChip',
    propSchema: {
      refType: { default: 'doc' },
      targetId: { default: '' },
      label: { default: '' },
    },
    content: 'none',
  },
  {
    render: ({ inlineContent }) => (
      <span className="poc-refchip" data-reftype={inlineContent.props.refType}>
        🔗 {inlineContent.props.label || inlineContent.props.targetId}
      </span>
    ),
  },
)
