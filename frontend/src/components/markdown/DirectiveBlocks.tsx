// 접기(:::fold) · 가리기(:::hide) 블록 (설계 §4.19 ②⑧).
//
// - 접기: 제목 줄만 표시, 클릭 시 펼침(기본 접힘). 전환은 CSS(grid-template-rows)만 사용.
// - 가리기: 내용을 흐려 가리고 탭/클릭으로 공개(암기·자가 테스트용).
// - **인쇄는 전부 공개**(§4.19 ⑧): 내용을 DOM에서 제거하지 않고 print: 변형으로 항상 펼친다.
// - 색상 하드코딩 0 — 토큰 클래스만.
import { useState } from 'react'
import type { ReactNode } from 'react'

const BLOCK = 'print-avoid-break my-3 rounded-lg border border-border bg-surface'

export function FoldSection({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={BLOCK}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-primary hover:bg-bg"
      >
        <span
          className={`shrink-0 text-xs text-muted transition-transform duration-200 print:hidden ${open ? 'rotate-90' : ''}`}
          aria-hidden
        >
          ▶
        </span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="shrink-0 text-xs text-muted print:hidden">{open ? '접기' : '펼치기'}</span>
      </button>
      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out print:grid-rows-[1fr] ${
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden print:overflow-visible">
          <div className="border-t border-border px-3 py-1">{children}</div>
        </div>
      </div>
    </div>
  )
}

export function HideSection({ label, children }: { label: string; children: ReactNode }) {
  const [revealed, setRevealed] = useState(false)
  return (
    <div className={`${BLOCK} border-dashed`}>
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-primary">{label}</span>
        <button
          type="button"
          onClick={() => setRevealed((v) => !v)}
          aria-expanded={revealed}
          className="shrink-0 rounded border border-border px-2 py-0.5 text-xs text-primary hover:bg-bg print:hidden"
        >
          {revealed ? '가리기' : '공개'}
        </button>
      </div>
      <div className="relative border-t border-border px-3 py-1">
        <div
          className={
            revealed ? '' : 'select-none blur-[6px] print:select-auto print:blur-none'
          }
          aria-hidden={!revealed}
        >
          {children}
        </div>
        {!revealed && (
          // 모바일 탭 공개 — 가린 영역 전체가 버튼이다.
          <button
            type="button"
            onClick={() => setRevealed(true)}
            className="absolute inset-0 flex items-center justify-center rounded text-xs font-medium text-muted print:hidden"
          >
            탭하여 공개
          </button>
        )}
      </div>
    </div>
  )
}
