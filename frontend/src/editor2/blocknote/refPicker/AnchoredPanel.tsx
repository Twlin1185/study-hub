// 참조 피커·칩 팝오버가 공유하는 **앵커 붙임 패널** (stage-34 규약 A ① "인라인 팝오버 1개").
//
// 왜 BlockNote/Mantine의 팝오버를 쓰지 않는가: 서식 툴바는 floating-ui `useDismiss`로 바깥 클릭에
// 스스로 닫힌다(`GenericPopover` 실측). 피커는 툴바보다 **오래 살아야 하고**(검색어 입력·키보드
// 이동), 툴바가 닫혀도 그대로 떠 있어야 한다. 그래서 수명·닫힘 조건을 우리가 직접 쥔다.
//
// 색은 전부 `tokens.css` 토큰 유틸(Tailwind) — 여기에 색 리터럴이 없다(불변 규칙 5).
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'

const MARGIN = 8
const GAP = 6

interface AnchoredPanelProps {
  /** 붙일 기준 사각형(선택 영역·칩의 화면 좌표). 없으면 화면 중앙 위쪽에 띄운다. */
  rect: DOMRect | null
  width: number
  onClose: () => void
  label: string
  children: ReactNode
}

export default function AnchoredPanel({ rect, width, onClose, label, children }: AnchoredPanelProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null)

  // 바깥 클릭 · Esc — capture 단계에서 잡아 편집기 단축키보다 먼저 처리한다.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const node = ref.current
      if (node && event.target instanceof Node && !node.contains(event.target)) onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [onClose])

  // 실제 높이를 재고 나서 위치를 확정한다(아래가 좁으면 기준 위로 뒤집는다).
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const vw = window.innerWidth
    const vh = window.innerHeight
    // 모바일(<768px) — 화면보다 넓어지지 않게 먼저 폭을 줄인다(§5.16 모바일 우선).
    const actual = Math.min(width, vw - MARGIN * 2)
    const height = node.offsetHeight
    const anchorLeft = rect ? rect.left : (vw - actual) / 2
    const left = Math.max(MARGIN, Math.min(anchorLeft, vw - actual - MARGIN))
    const below = rect ? rect.bottom + GAP : MARGIN + 40
    const above = rect ? rect.top - GAP - height : MARGIN
    const top =
      below + height + MARGIN <= vh || above < MARGIN
        ? Math.min(below, Math.max(MARGIN, vh - height - MARGIN))
        : above
    // 같은 값이면 **같은 객체를 돌려준다** — `children`이 매 렌더 새 참조라 이 훅이 매번 돌기 때문에,
    // 새 객체를 만들면 setState → 리렌더 → 다시 이 훅으로 무한 루프가 된다.
    setPos((prev) =>
      prev && prev.left === left && prev.top === top && prev.width === actual
        ? prev
        : { left, top, width: actual },
    )
  }, [rect, width, children])

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      // `editor2-ref-panel` = notes.css가 쌓임 순서를 잡는 고리(BlockNote 부유 UI보다 위).
      className="editor2-ref-panel fixed flex max-h-[70vh] flex-col overflow-hidden rounded-lg border border-border bg-surface-raised shadow-lg"
      style={{
        width: pos?.width ?? width,
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        // 위치 확정 전에는 그리지 않는다(첫 프레임에 엉뚱한 자리에서 번쩍이는 것 방지).
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      {children}
    </div>,
    document.body,
  )
}
