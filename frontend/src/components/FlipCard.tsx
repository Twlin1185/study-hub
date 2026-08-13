import { useRef, useState } from 'react'
import type { PointerEvent, ReactNode } from 'react'

interface FlipCardProps {
  flipped: boolean
  front: ReactNode
  back: ReactNode
  onFlip: () => void
  onSwipeLeft: () => void // 모른다 (q=1)
  onSwipeRight: () => void // 안다 (q=4)
  disabled?: boolean
  // S28(F53 ⑤, 검토 3차 잔여-2) — 문서 배경 오버라이드(선택, 예: `bg-docbg-yellow
  // print:bg-transparent`). 미지정 시 기존 bg-surface/bg-surface-raised 그대로 — Review.tsx 등
  // 다른 사용처는 이 prop을 넘기지 않으므로 렌더가 1px도 바뀌지 않는다.
  frontBgClassName?: string
  backBgClassName?: string
}

// 스와이프 판정 임계값(px)과 탭(=뒤집기) 판정 임계값(px).
const SWIPE_THRESHOLD = 90
const TAP_THRESHOLD = 10

// 3D 뒤집기 + 포인터 스와이프 카드 (설계 §5.7). 외부 라이브러리 없이 pointer events만 사용.
// 색은 토큰만 참조 — 좌(모른다)=wrong, 우(안다)=correct.
export default function FlipCard({
  flipped,
  front,
  back,
  onFlip,
  onSwipeLeft,
  onSwipeRight,
  disabled,
  frontBgClassName,
  backBgClassName,
}: FlipCardProps) {
  const [dragX, setDragX] = useState(0)
  const [dragging, setDragging] = useState(false)
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const movedRef = useRef(false)

  function handlePointerDown(e: PointerEvent<HTMLDivElement>) {
    if (disabled) return
    startRef.current = { x: e.clientX, y: e.clientY }
    movedRef.current = false
    setDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function handlePointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!startRef.current || disabled) return
    const dx = e.clientX - startRef.current.x
    const dy = e.clientY - startRef.current.y
    if (Math.abs(dx) > TAP_THRESHOLD || Math.abs(dy) > TAP_THRESHOLD) movedRef.current = true
    setDragX(dx)
  }

  function endGesture(e: PointerEvent<HTMLDivElement>) {
    if (!startRef.current) return
    const dx = e.clientX - startRef.current.x
    startRef.current = null
    setDragging(false)

    if (dx <= -SWIPE_THRESHOLD) {
      setDragX(0)
      onSwipeLeft()
      return
    }
    if (dx >= SWIPE_THRESHOLD) {
      setDragX(0)
      onSwipeRight()
      return
    }
    // 큰 이동이 없었으면 탭 = 뒤집기
    if (!movedRef.current) onFlip()
    setDragX(0)
  }

  const hintOpacity = Math.min(1, Math.abs(dragX) / SWIPE_THRESHOLD)

  return (
    <div
      className="relative select-none touch-none [perspective:1200px]"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
      role="button"
      tabIndex={-1}
      aria-label={flipped ? '카드 뒷면' : '카드 앞면'}
    >
      {/* 판정 힌트 오버레이 (드래그 방향) */}
      <div
        className="pointer-events-none absolute left-3 top-3 z-10 rounded-md border-2 border-wrong px-2 py-1 text-sm font-bold uppercase text-wrong"
        style={{ opacity: dragX < 0 ? hintOpacity : 0 }}
      >
        모른다
      </div>
      <div
        className="pointer-events-none absolute right-3 top-3 z-10 rounded-md border-2 border-correct px-2 py-1 text-sm font-bold uppercase text-correct"
        style={{ opacity: dragX > 0 ? hintOpacity : 0 }}
      >
        안다
      </div>

      <div
        className={dragging ? '' : 'transition-transform duration-200'}
        style={{ transform: `translateX(${dragX}px) rotate(${dragX * 0.02}deg)` }}
      >
        <div
          className="relative min-h-[16rem] transition-transform duration-500 [transform-style:preserve-3d]"
          style={{ transform: flipped ? 'rotateY(180deg)' : 'none' }}
        >
          <div
            className={`flex min-h-[16rem] flex-col rounded-xl border border-border p-5 [backface-visibility:hidden] ${frontBgClassName || 'bg-surface'}`}
          >
            {front}
          </div>
          <div
            className={`absolute inset-0 flex min-h-[16rem] flex-col rounded-xl border border-border p-5 [backface-visibility:hidden] ${backBgClassName || 'bg-surface-raised'}`}
            style={{ transform: 'rotateY(180deg)' }}
          >
            {back}
          </div>
        </div>
      </div>
    </div>
  )
}
