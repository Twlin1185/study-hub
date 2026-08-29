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
import { createContext, useContext, useState } from 'react'
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

// ---- 흐름형 다단(:::columns{n=2}) — stage-41 ----
//
// Word의 "단"과 같은 **흐름형**이다: 자식 블록 시퀀스는 하나의 흐름이고 CSS `column-count`가
// 그 흐름을 n개 단에 나눠 담는다(문단 내부도 단을 넘어 흐른다 — 결정 ④). 고정 열(Notion 컬럼)이
// 아니므로 "어느 블록이 몇째 단"이라는 정보 자체가 없다.
//
// 표시 규칙(데이터는 손대지 않는다 — 강등은 여기서만 한다):
//   · 단 수는 **2·3만** 그린다. 유입 데이터의 범위 밖 값(`n=4` 이상)은 3단으로 상한 강등하고,
//     2 미만(`n=1`·`n=0`·음수)은 1단으로 본다. 저장된 `count`는 그대로 남는다.
//   · **모바일 우선** — 기본 1단, `md`(≥768px) 이상에서 n단. 1단에서는 column-rule이 그려질
//     자리가 없으므로 "모바일 = 구분선 없음"이 자동으로 성립한다.
//   · **인쇄는 강등하지 않는다** — 인쇄 레이아웃 폭(A4)은 md 브레이크포인트를 넘으므로 화면
//     (데스크톱)과 같은 단 수가 그대로 적용된다. 인쇄 전용 오버라이드가 필요 없다.
//   · **중첩 columns는 안쪽을 1단으로** 표시한다(입력 UI는 중첩을 막지만 유입 데이터는 보존되므로
//     렌더가 감당해야 한다). 깊이는 컨텍스트로 센다 — CSS 하위 선택자보다 확정적이다.
// 간격·구분선·자식 break-inside는 `index.css`의 `.md-columns`가 맡는다(색은 토큰만).
const COLUMNS_CLASS: Record<1 | 2 | 3, string> = {
  1: 'columns-1',
  2: 'columns-1 md:columns-2',
  3: 'columns-1 md:columns-3',
}

/** 다단 중첩 깊이 — 0이면 최상위. 1 이상이면 안쪽이므로 1단으로 표시한다. */
const ColumnsDepth = createContext(0)

export function ColumnsSection({ count, children }: { count: number; children: ReactNode }) {
  const depth = useContext(ColumnsDepth)
  const clamped: 1 | 2 | 3 = count <= 1 ? 1 : count === 2 ? 2 : 3
  const cols: 1 | 2 | 3 = depth > 0 ? 1 : clamped
  return (
    <ColumnsDepth.Provider value={depth + 1}>
      <div className={`my-3 ${COLUMNS_CLASS[cols]} md-columns`} data-columns={cols}>
        {children}
      </div>
    </ColumnsDepth.Provider>
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
