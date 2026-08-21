// 이미지 크롭 다이얼로그(stage-37 F-6, 규약 C) — **canvas 자체 UI**(자유 사각 선택 1가지뿐. 비율
// 프리셋·회전·필터·리사이즈 없음 · 신규 npm 0). `NoteFormattingToolbar`가 `React.lazy`로만 불러와
// 초기 청크에 들어가지 않는다(R37 — 이 파일이 무거운 부분: canvas 인코딩 로직 전체).
//
// 저장 흐름(정본: 지시서 규약 C): canvas 크롭 → `toBlob`(원본과 **동일 MIME** 유지) →
// `POST /api/uploads`(§4.27, `useUploadImage` 재사용 — 신규 엔드포인트 0) → 성공한 `url`을
// 호출부(`NoteFormattingToolbar`)로 돌려준다. 여기서는 **image 블록을 직접 건드리지 않는다** —
// `editor.updateBlock`은 호출부 책임(undo 1단위를 그 한 번의 호출로 보장하기 위해 이 컴포넌트는
// "새 url을 만드는 일"만 한다). 원본 파일은 그대로 남는다(수정·삭제 호출 0 — 불변 규칙 4).
import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import Modal from '../../../components/Modal'
import { useUploadImage } from '../../../api/uploads'

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

// 드래그로 만든 선택이 이보다 작으면(거의 클릭에 가까우면) "선택 없음"으로 되돌린다 — 실수로
// 1px짜리 크롭이 만들어지는 것을 막는다.
const MIN_SELECTION_PX = 12

export interface ImageCropDialogProps {
  /** 크롭 대상 image 블록의 현재 url(자체 호스팅 `/images/…` — 호출부가 이미 조건을 확인했다). */
  url: string
  onCancel: () => void
  /** 새로 올라간 이미지의 url. 블록 반영은 호출부(NoteFormattingToolbar)가 한다. */
  onApply: (newUrl: string) => void
}

/** 원본과 **동일 MIME 유지**(규약 C) — 저장 파일명 규칙(§4.27 ④)은 확장자로 포맷을 결정한다. */
function mimeFromUrl(url: string): 'image/png' | 'image/jpeg' | 'image/webp' {
  const ext = url.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'webp') return 'image/webp'
  return 'image/png'
}

function fileNameFor(mime: string): string {
  if (mime === 'image/jpeg') return 'crop.jpg'
  if (mime === 'image/webp') return 'crop.webp'
  return 'crop.png'
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

export default function ImageCropDialog({ url, onCancel, onApply }: ImageCropDialogProps) {
  const imgRef = useRef<HTMLImageElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const dragStart = useRef<{ x: number; y: number } | null>(null)
  const uploadImage = useUploadImage()

  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [display, setDisplay] = useState<{ w: number; h: number } | null>(null)
  const [selection, setSelection] = useState<Rect | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function measure() {
    const img = imgRef.current
    if (!img) return
    setDisplay({ w: img.clientWidth, h: img.clientHeight })
  }

  // 모달이 열린 채 창 크기가 바뀌면(드문 경우) 표시 크기를 다시 재서 배율 계산이 어긋나지 않게 한다.
  useEffect(() => {
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  function pointFromEvent(e: ReactPointerEvent<HTMLDivElement>) {
    const box = containerRef.current!.getBoundingClientRect()
    return {
      x: clamp(e.clientX - box.left, 0, box.width),
      y: clamp(e.clientY - box.top, 0, box.height),
    }
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (busy) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = pointFromEvent(e)
    dragStart.current = p
    setSelection({ x: p.x, y: p.y, w: 0, h: 0 })
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!dragStart.current) return
    const p = pointFromEvent(e)
    const start = dragStart.current
    setSelection({
      x: Math.min(start.x, p.x),
      y: Math.min(start.y, p.y),
      w: Math.abs(p.x - start.x),
      h: Math.abs(p.y - start.y),
    })
  }

  function handlePointerUp() {
    dragStart.current = null
    setSelection((s) => (s && s.w >= MIN_SELECTION_PX && s.h >= MIN_SELECTION_PX ? s : null))
  }

  const canApply = Boolean(
    selection && display && natural && selection.w >= MIN_SELECTION_PX && selection.h >= MIN_SELECTION_PX,
  )

  async function handleApply() {
    if (!canApply || !selection || !display || !natural || !imgRef.current) return
    setBusy(true)
    setError(null)
    try {
      const scaleX = natural.w / display.w
      const scaleY = natural.h / display.h
      const sx = Math.round(selection.x * scaleX)
      const sy = Math.round(selection.y * scaleY)
      const sw = Math.max(1, Math.round(selection.w * scaleX))
      const sh = Math.max(1, Math.round(selection.h * scaleY))

      const canvas = document.createElement('canvas')
      canvas.width = sw
      canvas.height = sh
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('이 브라우저에서는 이미지를 자를 수 없습니다')
      ctx.drawImage(imgRef.current, sx, sy, sw, sh, 0, 0, sw, sh)

      const mime = mimeFromUrl(url)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, 0.92))
      if (!blob) throw new Error('잘린 이미지를 만들지 못했습니다')

      const file = new File([blob], fileNameFor(mime), { type: mime })
      const result = await uploadImage.mutateAsync(file)
      onApply(result.url)
    } catch (err) {
      setError(err instanceof Error ? err.message : '이미지를 자르지 못했습니다')
      setBusy(false)
    }
  }

  return (
    <Modal
      title="이미지 자르기"
      onClose={busy ? () => {} : onCancel}
      widthClass="max-w-2xl"
      footer={
        <>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded border border-border px-3 py-1.5 text-sm text-primary hover:bg-bg disabled:opacity-50"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={!canApply || busy}
            className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
          >
            {busy ? '적용 중…' : '적용'}
          </button>
        </>
      }
    >
      <p className="mb-2 text-xs text-muted">이미지 위를 드래그해 자를 영역을 선택하세요.</p>
      <div
        ref={containerRef}
        className="relative inline-block max-w-full touch-none select-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <img
          ref={imgRef}
          src={url}
          alt=""
          draggable={false}
          className="block max-h-[60vh] max-w-full"
          onLoad={(e) => {
            const el = e.currentTarget
            setNatural({ w: el.naturalWidth, h: el.naturalHeight })
            measure()
          }}
        />
        {selection && display && (
          <>
            <div
              className="pointer-events-none absolute border-2 border-accent"
              style={{ left: selection.x, top: selection.y, width: selection.w, height: selection.h }}
            />
            <div
              className="pointer-events-none absolute bg-black/40"
              style={{ left: 0, top: 0, width: display.w, height: selection.y }}
            />
            <div
              className="pointer-events-none absolute bg-black/40"
              style={{
                left: 0,
                top: selection.y + selection.h,
                width: display.w,
                height: Math.max(0, display.h - selection.y - selection.h),
              }}
            />
            <div
              className="pointer-events-none absolute bg-black/40"
              style={{ left: 0, top: selection.y, width: selection.x, height: selection.h }}
            />
            <div
              className="pointer-events-none absolute bg-black/40"
              style={{
                left: selection.x + selection.w,
                top: selection.y,
                width: Math.max(0, display.w - selection.x - selection.w),
                height: selection.h,
              }}
            />
          </>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-wrong">{error}</p>}
    </Modal>
  )
}
