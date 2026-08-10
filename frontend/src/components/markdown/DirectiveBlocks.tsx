// 접기(:::fold) · 가리기(:::hide) · 콜아웃(:::note/warn/tip) 블록 + 인라인 스포일러(||…||)
// (설계 §4.19 ②⑧ + §5.3 S26/F52).
//
// - 접기: 제목 줄만 표시, 클릭 시 펼침(기본 접힘). 전환은 CSS(grid-template-rows)만 사용.
// - 가리기: 내용을 흐려 가리고 탭/클릭으로 공개(암기·자가 테스트용).
// - 콜아웃(F52): 좌측 보더 + 제목 색만 의미별로 다르다(note=accent·warn=warning·tip=correct —
//   전부 기존 토큰 재사용, 콜아웃 전용 신규 토큰 0).
// - 인라인 스포일러(F52): 가림 기본, 클릭/키보드로 토글 공개. **채점 경계가 아니다**(렌더 계층일
//   뿐 — quiz/session 응답의 정답 부재는 서버 계약, 불변 규칙 1).
// - **인쇄는 전부 공개**(§4.19 ⑧, F52 결정 ⑤ 연장): 내용을 DOM에서 제거하지 않고 print: 변형으로
//   항상 펼친다.
// - 색상 하드코딩 0 — 토큰 클래스만.
import { useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'

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

// ---- 콜아웃(:::note/warn/tip) — F52 ----
type CalloutKind = 'note' | 'warn' | 'tip'

const CALLOUT_STYLE: Record<CalloutKind, { border: string; text: string; icon: string; defaultLabel: string }> = {
  note: { border: 'border-l-accent', text: 'text-accent', icon: 'ℹ', defaultLabel: '참고' },
  warn: { border: 'border-l-warning', text: 'text-warning', icon: '⚠', defaultLabel: '주의' },
  tip: { border: 'border-l-correct', text: 'text-correct', icon: '💡', defaultLabel: '팁' },
}

export function CalloutBlock({
  kind,
  label,
  children,
}: {
  kind: CalloutKind
  label: string
  children: ReactNode
}) {
  const style = CALLOUT_STYLE[kind]
  return (
    <div
      className={`print-avoid-break my-3 rounded-lg border border-border border-l-4 ${style.border} bg-surface-raised px-3 py-2`}
    >
      <p className={`flex items-center gap-1.5 text-sm font-medium ${style.text}`}>
        <span aria-hidden>{style.icon}</span>
        <span>{label || style.defaultLabel}</span>
      </p>
      <div className="mt-1 border-t border-border pt-1 text-primary">{children}</div>
    </div>
  )
}

// ---- 인라인 스포일러(||…||) — F52 ----
// 가린 상태 = 배경·글자색을 같은 토큰(--text)으로 맞춰 "먹칠" 효과(다크 모드도 토큰만으로 자동
// 대응). 공개 상태는 옅은 배경으로 다시 가릴 수 있음을 암시. 인쇄는 항상 공개(§4.19 ⑧ 관례).
export function InlineSpoiler({ children }: { children: ReactNode }) {
  const [revealed, setRevealed] = useState(false)

  function toggle() {
    setRevealed((v) => !v)
  }

  function onKeyDown(e: KeyboardEvent<HTMLSpanElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      toggle()
    }
  }

  return (
    <span
      role="button"
      tabIndex={0}
      aria-expanded={revealed}
      aria-label={revealed ? undefined : '가려진 내용 — 탭하여 공개'}
      onClick={toggle}
      onKeyDown={onKeyDown}
      className={
        revealed
          ? 'cursor-pointer rounded bg-bg px-0.5 print:cursor-auto print:bg-transparent'
          : 'cursor-pointer select-none rounded bg-primary px-0.5 text-primary print:cursor-auto print:select-auto print:bg-transparent print:text-inherit'
      }
    >
      {children}
    </span>
  )
}
