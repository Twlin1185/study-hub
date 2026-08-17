// 제목 입력란 전용 undo/redo 히스토리 (stage-34 결함 U-2).
//
// **증상**: 노트 제목 `<input>`에 포커스를 둔 채 `Ctrl+Z`를 누르면 **본문**이 되돌아간다.
// 제목에 한 글자도 안 친 상태에서도 본문 편집분이 조용히 사라진다(`ABCMMM` → `ABC`).
// 제목 자체의 undo도 **한 글자씩**만 되돌아간다(9글자 원복에 21회).
//
// **원인(실측)**: Blink의 네이티브 undo 스택은 **프레임당 하나**다. 본문 contenteditable의
// 편집도 같은 스택에 쌓이므로, 제목 입력란에서 난 `Ctrl+Z`의 기본 동작이 그 스택을 파먹는다.
// 게다가 제목은 React 제어 입력이라 `value`가 매 입력마다 프로그램적으로 재설정되고, 그때마다
// 네이티브 undo 단위가 한 글자로 쪼개진다. 쪼개진 제목분이 마르면 그 다음 항목 = **본문 편집분**이
// 나오고, 되돌려진 DOM 변경을 ProseMirror가 문서에 반영해 버린다(= 조용한 본문 손실).
//
// **해법(두 겹)**:
//   ① 제목 입력란에서 난 `Ctrl+Z`/`Ctrl+Shift+Z`/`Ctrl+Y`는 **무조건** `preventDefault()` —
//      네이티브 undo가 단 한 번도 돌지 않게 해 본문 스택 유출 경로를 끊는다(치명분).
//   ② 기본 동작을 죽인 만큼 제목 undo를 **직접** 제공한다. 되돌리기 단위는 글자가 아니라 묶음이다.
//
// **묶음(coalescing) 기준**: 타이핑이 `COALESCE_MS`(500ms) 멈추거나 공백·문장부호를 입력한
// 순간에 스냅샷을 커밋한다. 근거 — (a) 500ms는 규약 C의 저장 디바운스(1.5초)보다 짧아 "한 번
// 저장될 분량"이 여러 undo 단계로 쪼개지지 않으면서도 사용자가 잠시 멈추고 생각한 지점은
// 되돌림 경계로 남는다. (b) 공백·문장부호 경계는 단어 단위 되돌림이라는 통상적 편집기 관례와
// 맞고, 워드프로세서·에디터 사용자가 기대하는 단위다. 결과적으로 쉬지 않고 친 "테스트노트"는
// 1회, "abc def"는 2회로 되돌아간다 — 결함 원문의 "9글자에 21회"와 대비되는 지점.
//
// **IME(한글)**: 조합 중에는 커밋하지 않는다(자모 단위로 쪼개지지 않게). 조합이 끝나면 다시
// 유휴 타이머를 걸어 **조합 결과 전체가 하나의 단계**로 들어간다. 조합 중에 `Ctrl+Z`가 와도
// `preventDefault()`는 무조건 하고(본문 무손실이 최우선), IME에 확정을 강제한 뒤(`blur()`)
// 되돌린다 — `blocknote/toolbar/useHistoryShortcuts.ts`(결함 U-1)와 같은 정신이다.
// 조합 중 `event.key`가 `'Process'`로 오는 IME가 있어 물리 키(`event.code`)로도 판정한다.
import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

/** 타이핑이 이만큼 멈추면 되돌림 경계를 하나 만든다(묶음 커밋). */
const COALESCE_MS = 500
/** 이 문자를 입력하면 그 자리에서 경계를 만든다(단어 단위 되돌림). */
const BOUNDARY = /[\s.,;:!?()[\]{}<>'"`~@#$%^&*+=|/\\·…—–-]/
/** 히스토리 상한 — 제목은 짧아 이 정도면 세션 내내 마르지 않는다. */
const MAX_ENTRIES = 200
/**
 * 조합 강제 확정(`blur`) 후 되돌리기까지의 대기(ms).
 * `blur()` → `compositionend` → React `onChange`/`onCompositionEnd` → 상태 flush 까지 넘긴 뒤에
 * 되돌려야 "조합분이 값에 들어간 상태"에서 되돌리게 된다. U-1 래퍼와 같은 값(40ms)을 쓴다.
 */
const COMPOSITION_SETTLE_MS = 40

interface TitleHistoryEntry {
  value: string
  selectionStart: number
  selectionEnd: number
}

export interface TitleHistoryOptions {
  /** 현재 제목 값(제어 입력의 `value`). */
  value: string
  /**
   * 되돌린 값을 적용한다 — 호출부는 여기서 상태 갱신 + `scheduleSave()`를 모두 해야 한다
   * (되돌리기도 편집이므로 규약 C의 저장 파이프라인에 그대로 태운다).
   */
  apply: (next: string) => void
}

export interface TitleHistory {
  /** 제목 `<input>`에 달 ref — 키 가로채기 대상 판정과 커서 복원에 쓴다. */
  inputRef: RefObject<HTMLInputElement | null>
  /** `onChange`에서 새 값과 함께 호출(상태 갱신과 순서 무관). */
  recordChange: (next: string) => void
  /** `onCompositionStart`에서 호출. */
  beginComposition: () => void
  /** `onCompositionEnd`에서 호출. */
  endComposition: () => void
  /** `onBlur`에서 호출 — 포커스를 잃는 지점도 되돌림 경계다. */
  commit: () => void
}

/** 제목 입력란에 자체 undo 스택을 부여하고, 네이티브 undo(본문 스택 공유)를 차단한다. */
export function useTitleHistory({ value, apply }: TitleHistoryOptions): TitleHistory {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const valueRef = useRef(value)
  valueRef.current = value

  // 최신 `apply`를 ref로 들고 있어 키 리스너를 다시 붙이지 않는다(리렌더마다 재등록 방지).
  const applyRef = useRef(apply)
  applyRef.current = apply

  // `past`의 **맨 위 = 마지막으로 커밋된 상태**. 살아 있는(아직 미커밋) 값은 `valueRef`다.
  const past = useRef<TitleHistoryEntry[]>([
    { value, selectionStart: value.length, selectionEnd: value.length },
  ])
  const future = useRef<TitleHistoryEntry[]>([])
  const composing = useRef(false)
  const timer = useRef<number | null>(null)
  /** 값 적용 후 DOM이 갱신되면 복원할 커서 위치. */
  const pendingSelection = useRef<TitleHistoryEntry | null>(null)

  const readEntry = useCallback((): TitleHistoryEntry => {
    const input = inputRef.current
    const current = valueRef.current
    const start = input?.selectionStart ?? current.length
    const end = input?.selectionEnd ?? current.length
    return { value: current, selectionStart: start, selectionEnd: end }
  }, [])

  const clearTimer = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }, [])

  const commit = useCallback(() => {
    clearTimer()
    // 조합 중이면 **버리지 않고 뒤로 미룬다** — 여기서 그냥 돌아가면 그 구간의 경계가 통째로
    // 사라진다(규약 C의 `saveNow`가 같은 이유로 재예약한다).
    if (composing.current) {
      timer.current = window.setTimeout(commit, COALESCE_MS)
      return
    }
    const entry = readEntry()
    const top = past.current[past.current.length - 1]
    if (top && top.value === entry.value) return
    past.current.push(entry)
    if (past.current.length > MAX_ENTRIES) past.current.shift()
  }, [clearTimer, readEntry])

  const scheduleCommit = useCallback(() => {
    clearTimer()
    timer.current = window.setTimeout(commit, COALESCE_MS)
  }, [clearTimer, commit])

  const recordChange = useCallback(
    (next: string) => {
      const previous = valueRef.current
      valueRef.current = next
      // 표준 동작 — 새 입력이 들어오면 redo 스택은 버린다.
      future.current = []
      if (composing.current) return
      // 경계 문자를 **입력한** 경우에만 즉시 커밋한다(지우기는 유휴 타이머에 맡긴다).
      const grew = next.length > previous.length
      const caret = inputRef.current?.selectionStart ?? next.length
      const typed = caret > 0 ? next[caret - 1] : ''
      if (grew && typed && BOUNDARY.test(typed)) {
        commit()
        return
      }
      scheduleCommit()
    },
    [commit, scheduleCommit],
  )

  const applyEntry = useCallback((entry: TitleHistoryEntry) => {
    valueRef.current = entry.value
    pendingSelection.current = entry
    applyRef.current(entry.value)
  }, [])

  const undo = useCallback(() => {
    clearTimer()
    const live = readEntry()
    const top = past.current[past.current.length - 1]
    if (!top) return
    if (top.value !== live.value) {
      // 아직 커밋되지 않은 타이핑 구간 — 마지막 커밋 지점으로 한 번에 되돌린다.
      future.current.push(live)
      applyEntry(top)
      return
    }
    if (past.current.length < 2) return
    past.current.pop()
    future.current.push(top)
    applyEntry(past.current[past.current.length - 1])
  }, [applyEntry, clearTimer, readEntry])

  const redo = useCallback(() => {
    clearTimer()
    const entry = future.current.pop()
    if (!entry) return
    past.current.push(entry)
    applyEntry(entry)
  }, [applyEntry, clearTimer])

  const beginComposition = useCallback(() => {
    composing.current = true
  }, [])

  const endComposition = useCallback(() => {
    composing.current = false
    // 조합 결과 전체를 하나의 단계로 — 여기서 즉시 커밋하지 않고 유휴 타이머만 다시 건다.
    // (다음 음절이 이어지면 같은 묶음으로 합쳐진다.)
    scheduleCommit()
  }, [scheduleCommit])

  // 값이 DOM에 반영된 뒤 커서를 복원한다(`apply` → 부모 상태 갱신 → 리렌더 다음 시점).
  useLayoutEffect(() => {
    const pending = pendingSelection.current
    const input = inputRef.current
    if (!pending || !input) return
    if (input.value !== pending.value) return // 아직 미갱신 — 다음 렌더에서 복원한다.
    pendingSelection.current = null
    if (document.activeElement !== input) input.focus()
    input.setSelectionRange(pending.selectionStart, pending.selectionEnd)
  })

  // 키 가로채기 — `document` 캡처 단계에서 잡아 **어떤 경우에도** 네이티브 undo가 돌지 않게 한다.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      const key = event.key.toLowerCase()
      const isZ = key === 'z' || event.code === 'KeyZ'
      const isY = key === 'y' || event.code === 'KeyY'
      if (!isZ && !isY) return
      const input = inputRef.current
      // 제목 입력란에서 난 키만 처리한다 — 본문 편집 표면은 기존 경로(BlockNote 키맵 +
      // `useHistoryShortcuts`)가 그대로 담당한다.
      if (!input || event.target !== input) return

      // **무조건** 기본 동작을 죽인다(조합 중이든 아니든, 되돌릴 게 있든 없든).
      // 이 한 줄이 본문 스택 유출 = 조용한 본문 손실을 끊는 지점이다.
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()

      const rewind = isY || event.shiftKey ? redo : undo
      if (!composing.current) {
        rewind()
        return
      }
      // 조합 중 — IME에 확정을 강제하고(blur) 확정분이 값에 반영된 뒤 되돌린다.
      input.blur()
      window.setTimeout(() => {
        inputRef.current?.focus()
        rewind()
      }, COMPOSITION_SETTLE_MS)
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [redo, undo])

  // 언마운트 시 남은 타이머 정리.
  useEffect(() => () => clearTimer(), [clearTimer])

  return { inputRef, recordChange, beginComposition, endComposition, commit }
}
