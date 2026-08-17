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
//
// **적용 범위(검토 지적 중요-3)**: 원인이 "프레임당 하나의 undo 스택"이므로 피해자는 제목만이
// 아니다. 같은 화면에 뜨는 **모든** 입력란(참조 피커 검색창·라벨 입력·서식 툴바 링크 입력 등)이
// 똑같이 본문 스택을 파먹는다. 그래서 이 훅은
//   - **편집 표면 밖에서 포커스된 `input`/`textarea`/contenteditable 전부**에 대해 되돌리기 키의
//     기본 동작을 죽이고,
//   - **자체 히스토리는 제목 입력란에만** 태운다.
// 트레이드오프: 제목 밖 입력란은 자체 undo 없이 네이티브 undo까지 잃는다. 그래도 **조용한 본문
// 손실**보다 낫다 — 그 입력란들은 한 줄짜리 임시 입력이고, 잘못 쳤으면 지우면 그만이다.
// **편집 표면 안(`.bn-editor`/`.ProseMirror`)은 절대 건드리지 않는다** — U-1 훅과 BlockNote
// 기본 키맵의 영역이라 여기서 손대면 이중 undo가 난다.
//
// **키보드 밖 경로(검토 지적 의심-2)**: 우클릭 → "실행 취소"는 keydown을 거치지 않는다.
// `beforeinput`의 `inputType === 'historyUndo'|'historyRedo'`를 같은 게이트로 잡아 닫는다
// (취소 가능한 이벤트다). 이 이벤트를 지원하지 않는 환경을 위해 keydown 경로도 그대로 둔다.
//
// ─────────────────────────────────────────────────────────────────────────────
// **결함 U-3(2026-08-17)**: 위 `beforeinput` 게이트가 뚫렸다 — "제목 입력란에서 우클릭 실행
// 취소하면 본문이 사라진다".
//
// **원인**: `beforeinput{historyUndo}`의 `target`은 **명령을 낸 곳이 아니라 되돌려질 DOM의
// 주인**이다(Blink는 되돌릴 UndoStep의 root editable에 이 이벤트를 쏜다). 제목에서 우클릭
// 취소를 눌러도 스택 맨 위가 본문 편집분이면 `target`은 **본문 contenteditable**이 되고,
// 종전 `classify`는 편집 표면을 `'skip'`으로 흘려보내 게이트를 정확히 비켜 갔다.
//
// **그다음에 무슨 일이 벌어지나(코드 확인)**: `@blocknote/core`의 HistoryExtension은
// `prosemirror-history`의 `history()` 플러그인을 그대로 얹는다(dist: `prosemirrorPlugins:[history()]`).
// 그 플러그인에는 **정식 `beforeinput` 핸들러**가 있다:
//   `handleDOMEvents.beforeinput(view, e){ inputType==='historyUndo' ? undo : ... ; e.preventDefault(); command(...) }`
// 즉 흘려보낸 이벤트는 네이티브 DOM 파괴가 아니라 **본문의 정상 PM undo**로 실행된다.
// 사용자가 본 "본문이 사라진다"의 정체가 이것이다(제목에서 낸 명령이 본문을 되돌림).
//
// **그래서 "history 계열 beforeinput은 무조건 차단"은 쓸 수 없다** — 그 차단은 본문에서
// 우클릭 → 실행 취소하는 **정당한 경로**(prosemirror-history)까지 같이 죽인다.
// 대신 **발원지(origin)** 로 가른다. `target`은 못 믿으니 두 신호를 본다:
//   ① 직전 `contextmenu` 이벤트의 대상  ② 현재 `document.activeElement`.
// **둘 다 편집 표면 안**을 가리킬 때만 정당한 본문 undo로 보고 통과시킨다. 하나라도 밖(제목·
// 다른 입력란·body)을 가리키면 삼킨다 — 확신이 없으면 막는다(조용한 본문 손실이 최악이므로).
// 신호가 갈리는 실제 사례: 우클릭 시 입력란에 포커스를 주지 않는 브라우저(①=제목, ②=본문).
// 발원지가 제목이면 삼킨 뒤 **자체 히스토리**를 태운다(사용자 기대 = 제목이 되돌아감).
// **한계**: `event.cancelable === false`인 환경에서는 기본 동작을 막을 수 없다. 그때도
// `stopImmediatePropagation`으로 이중 실행(PM undo)은 막지만 네이티브 undo 자체는 못 막는다.
import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

/** 타이핑이 이만큼 멈추면 되돌림 경계를 하나 만든다(묶음 커밋). */
const COALESCE_MS = 500
/** 이 문자를 입력하면 그 자리에서 경계를 만든다(단어 단위 되돌림). */
const BOUNDARY = /[\s.,;:!?()[\]{}<>'"`~@#$%^&*+=|/\\·…—–-]/
/**
 * 길이 기반 경계(결함 U-4) — 마지막 커밋 이후 길이 변화가 이만큼 쌓이면 **조합이 끝나는
 * 시점**에 경계를 하나 만든다.
 *
 * **왜 필요한가**: 종전 경계는 "유휴 500ms"와 "공백·문장부호"뿐이었다. 한글은 조합 중
 * (`composing`) 커밋하지 않고 `compositionend`에서 유휴 타이머를 **다시 걸기만** 하므로,
 * 음절을 쉬지 않고 이으면 타이머가 매번 재무장돼 **타이핑을 완전히 멈출 때까지 커밋이 한 번도
 * 일어나지 않는다**. 게다가 한글 제목은 공백이 없는 경우가 많아 경계 문자도 안 걸린다.
 * 결과가 "제목이 한 덩이로 통째 사라짐"(U-4)이었다.
 *
 * **왜 4인가**: 되돌림 횟수 = `floor(L/N)`(+ 나머지가 있으면 1). 목표는 결함 원문의 예시
 * `테스트노트입니다`(8자)에서 "통째"가 아닌 **2~3회**다 — N=4면 8자가 정확히 2회,
 * 20자면 5회로 "긴 제목이면 조금 더"에 맞는다. N=8~12로 잡으면 8자짜리가 다시 **1회**(=통째)가
 * 되어 결함이 그대로 남는다. 한글 4음절은 대략 한 어절이라 의미 단위로도 자연스럽다.
 * 반대편 극단(9자에 21회 = 결함 U-2)과는 한 자리 수 차이로 멀다.
 *
 * **적용 범위**: 조합(`composition`)이 **끝나는 순간에만** 본다. 조합 중에 끊으면 음절 중간
 * 스냅샷이 남고, 라틴 문자 타이핑은 공백 경계로 이미 어절 단위라 여기 손댈 이유가 없다.
 */
const CHUNK_CHARS = 4
/**
 * 직전 우클릭 대상을 "발원지 신호"로 인정하는 유효 시간(ms).
 * 컨텍스트 메뉴를 열어 두고 고르는 시간을 넉넉히 잡되, 아주 오래된 우클릭이 발원지 판정을
 * 지배하지 않도록 상한을 둔다. (보수 판정이라 낡은 값은 "더 막는" 쪽으로만 기운다.)
 */
const CONTEXT_MENU_TTL_MS = 30_000
/** 히스토리 상한 — 제목은 짧아 이 정도면 세션 내내 마르지 않는다. */
const MAX_ENTRIES = 200
/**
 * 조합 강제 확정(`blur`) 후 되돌리기까지의 대기(ms).
 * `blur()` → `compositionend` → React `onChange`/`onCompositionEnd` → 상태 flush 까지 넘긴 뒤에
 * 되돌려야 "조합분이 값에 들어간 상태"에서 되돌리게 된다. U-1 래퍼와 같은 값(40ms)을 쓴다.
 */
const COMPOSITION_SETTLE_MS = 40
/**
 * 편집 표면(= BlockNote가 소유한 contenteditable) 판정 선택자.
 * `useEditorDOMElement`(U-1 훅이 쓰는 것)는 BlockNote 컨텍스트 **안**에서만 쓸 수 있는데
 * 제목 입력란은 `<BlockNoteView>` 밖에 있어 이 훅에서는 쓸 수 없다. 그래서 DOM 판정으로 간다.
 * 두 클래스는 편집 가능한 요소 자신에 붙는다 — 툴바·피커 패널은 그 바깥(또는 포털)이라
 * 여기 걸리지 않는다.
 */
const EDITING_SURFACE = '.bn-editor, .ProseMirror'

/** 편집 표면 안에서 난 이벤트인가 — 안이면 이 훅은 **아무것도 하지 않는다**. */
function inEditingSurface(target: EventTarget | null): boolean {
  const node = target instanceof Node ? target : null
  const element = node instanceof Element ? node : (node?.parentElement ?? null)
  return element?.closest(EDITING_SURFACE) != null
}

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
  /**
   * 조합 확정용 `blur()` ~ 재포커스 사이(= 되돌리기 예약 상태)인가.
   * 그 창에서는 포커스가 `document.body`라 대상 판정이 전부 빗나가 **네이티브 undo가 새어
   * 나간다**(검토 지적 경미-1). 창이 열려 있는 동안의 되돌리기 키는 통째로 삼킨다.
   */
  const rewinding = useRef(false)
  /** 위 창의 타이머 핸들 — 언마운트 시 정리한다(검토 지적 경미-2). */
  const settleTimer = useRef<number | null>(null)
  /**
   * 직전 우클릭(컨텍스트 메뉴) 대상과 시각 — 네이티브 history 명령의 **발원지** 판정용(U-3).
   * `beforeinput{historyUndo}`의 `target`은 "되돌려질 DOM의 주인"이라 명령을 낸 곳을 알려주지
   * 않는다. 우클릭 대상은 알려준다.
   */
  const lastContextMenu = useRef<{ target: EventTarget | null; at: number } | null>(null)

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

  /**
   * 마지막 커밋 이후의 길이 변화량(U-4). 늘어남·줄어듦을 가리지 않는다 — 되돌림 덩어리가
   * 커지는 건 지우기에서도 똑같기 때문이다. (다만 이 값을 실제로 쓰는 곳은 `endComposition`
   * 하나뿐이라, 백스페이스 연타는 종전대로 "유휴 500ms" 경계에 맡긴다. 눌러서 지우는 동작은
   * 하나의 제스처이므로 한 번에 되살아나는 편이 기대에 맞는다.)
   */
  const changedSinceCommit = useCallback((): number => {
    const top = past.current[past.current.length - 1]
    if (!top) return valueRef.current.length
    return Math.abs(valueRef.current.length - top.value.length)
  }, [])

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
    // 길이 기반 경계(U-4) — 마지막 커밋 이후 `CHUNK_CHARS`만큼 변했으면 **바로 여기서** 끊는다.
    // 여기가 음절 경계(조합이 막 끝난 지점)라 잘라도 조합이 깨지지 않는다. 이 분기가 없으면
    // 쉬지 않고 친 한글 제목이 유휴 타이머를 무한 재무장시켜 통째로 한 덩이가 된다.
    if (changedSinceCommit() >= CHUNK_CHARS) {
      commit()
      return
    }
    // 그 밖에는 종전대로 — 조합 결과 전체를 하나의 단계로 묶기 위해 유휴 타이머만 다시 건다.
    // (다음 음절이 이어지면 같은 묶음으로 합쳐진다.)
    scheduleCommit()
  }, [changedSinceCommit, commit, scheduleCommit])

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

  // 되돌리기 요청 가로채기 — `document` 캡처 단계에서 잡아, **편집 표면 밖**에서는 네이티브
  // undo가 단 한 번도 돌지 않게 한다(그게 본문 스택 유출의 유일한 통로다).
  useEffect(() => {
    /** 기본 동작 + 다른 리스너까지 통째로 막는다. */
    const swallow = (event: Event) => {
      if (event.cancelable) event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }

    /**
     * 이 이벤트를 이 훅이 맡아야 하는가.
     *  - `'skip'`  : 편집 표면 안(U-1 훅·BlockNote 키맵 영역) 또는 되돌리기와 무관한 대상.
     *  - `'block'` : 제목 밖 입력란 — 기본 동작만 죽인다(자체 히스토리 없음).
     *  - `'title'` : 제목 입력란 — 죽이고 자체 히스토리로 되돌린다.
     */
    const classify = (target: EventTarget | null): 'skip' | 'block' | 'title' => {
      if (inEditingSurface(target)) return 'skip'
      const input = inputRef.current
      if (input && target === input) return 'title'
      // blur~재포커스 창에서는 포커스가 `document.body`다 — 그 창의 키는 대상과 무관하게 삼킨다.
      if (rewinding.current) return 'block'
      // 편집 표면 **밖은 대상을 가리지 않고 전부 막는다**(2026-08-17 재검토 의심-1).
      // 종전에는 `isTextEntry`(input/textarea/contenteditable)만 막았으나, 포커스가 버튼·`<select>`·
      // `document.body`에 있을 때의 `Ctrl+Z`도 Blink의 **프레임당 1개** undo 스택을 건드릴 수 있다
      // (예: 본문 편집 → 상단 버튼 클릭 → `Ctrl+Z`). 그 경로가 실제로 도는지는 브라우저 실조작 없이
      // 단정할 수 없으나, **조용한 본문 손실**의 대가가 크고 이 훅은 노트 편집 화면에서만 마운트되므로
      // 넓게 막는 쪽을 택한다. 편집 표면 안은 위에서 이미 `'skip'`으로 빠졌으므로 본문 undo는 무영향이다.
      return 'block'
    }

    /** 제목 히스토리 실행 — 조합 중이면 IME 확정을 강제한 뒤로 미룬다. */
    const run = (direction: 'undo' | 'redo') => {
      if (rewinding.current) return // 이미 예약된 되돌리기가 하나 있다 — 중복 실행 금지.
      const rewind = direction === 'redo' ? redo : undo
      if (!composing.current) {
        rewind()
        return
      }
      // 조합 중 — IME에 확정을 강제하고(blur) 확정분이 값에 반영된 뒤 되돌린다.
      rewinding.current = true
      inputRef.current?.blur()
      settleTimer.current = window.setTimeout(() => {
        settleTimer.current = null
        inputRef.current?.focus()
        rewind()
        rewinding.current = false
      }, COMPOSITION_SETTLE_MS)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      const key = event.key.toLowerCase()
      const isZ = key === 'z' || event.code === 'KeyZ'
      const isY = key === 'y' || event.code === 'KeyY'
      if (!isZ && !isY) return
      const role = classify(event.target)
      if (role === 'skip') return

      // **무조건** 기본 동작을 죽인다(조합 중이든 아니든, 되돌릴 게 있든 없든).
      // 이 한 줄이 본문 스택 유출 = 조용한 본문 손실을 끊는 지점이다.
      swallow(event)
      if (role === 'block') return
      run(isY || event.shiftKey ? 'redo' : 'undo')
    }

    /** 발원지 신호 ① — 아직 유효한 직전 우클릭 대상(없으면 null). */
    const contextSignal = (): EventTarget | null => {
      const recent = lastContextMenu.current
      if (!recent) return null
      return Date.now() - recent.at <= CONTEXT_MENU_TTL_MS ? recent.target : null
    }

    /**
     * 네이티브 history 명령이 **편집 표면 안에서 요청됐다고 확신**할 수 있는가(U-3).
     * 신호 ①(직전 우클릭)·②(현재 포커스)를 **모두** 보고, 하나라도 편집 표면 밖을 가리키면
     * false다. 확신이 설 때만 `prosemirror-history`에 넘긴다 — 나머지는 전부 삼킨다.
     */
    const requestedInsideSurface = (): boolean => {
      const signals = [contextSignal(), document.activeElement].filter(
        (target): target is EventTarget => target != null,
      )
      return signals.length > 0 && signals.every(inEditingSurface)
    }

    /** 발원지가 제목 입력란인가 — 신호 둘 중 하나라도 제목을 가리키면 그렇다고 본다. */
    const requestedFromTitle = (): boolean => {
      const input = inputRef.current
      if (!input) return false
      return contextSignal() === input || document.activeElement === input
    }

    // 우클릭 → "실행 취소"·"다시 실행"은 keydown 없이 여기로만 온다(취소 가능한 이벤트).
    // 키보드 경로는 위에서 이미 `preventDefault`되므로 이 핸들러와 겹쳐 두 번 돌 일은 없다.
    const onBeforeInput = (event: InputEvent) => {
      const type = event.inputType
      if (type !== 'historyUndo' && type !== 'historyRedo') return
      const direction = type === 'historyRedo' ? 'redo' : 'undo'
      const role = classify(event.target)
      if (role !== 'skip') {
        // 되돌려질 DOM이 제목이거나(=`'title'`) 편집 표면 밖의 다른 입력란이다(=`'block'`).
        swallow(event)
        lastContextMenu.current = null
        if (role === 'title') run(direction)
        return
      }
      // 여기부터가 U-3 경로 — 되돌려질 DOM이 **편집 표면**이다. `target`만으로는 이 명령을
      // 본문에서 냈는지 제목에서 냈는지 알 수 없으므로 발원지 신호로 가른다.
      const insideSurface = requestedInsideSurface()
      const fromTitle = requestedFromTitle()
      // 신호 ①은 **한 번 판정에 쓰면 소비**한다(2026-08-17 검토 경미-1) — 우클릭 메뉴는 명령이
      // 나가는 순간 닫히므로, 남겨 두면 TTL 30초 동안 낡은 발원지가 무관한 undo를 오판정한다.
      lastContextMenu.current = null
      if (insideSurface) return // 정당한 본문 우클릭 undo — prosemirror-history에 맡긴다.
      swallow(event)
      // 제목에서 낸 명령이면 사용자가 기대하는 대상은 제목이다. 본문은 손대지 않는다.
      if (fromTitle) run(direction)
    }

    /** 발원지 신호 ① 수집 — 판정만 하고 이벤트는 건드리지 않는다. */
    const onContextMenu = (event: MouseEvent) => {
      lastContextMenu.current = { target: event.target, at: Date.now() }
    }

    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('beforeinput', onBeforeInput, true)
    document.addEventListener('contextmenu', onContextMenu, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('beforeinput', onBeforeInput, true)
      document.removeEventListener('contextmenu', onContextMenu, true)
    }
  }, [redo, undo])

  // 언마운트 시 남은 타이머 정리(유휴 커밋 + 조합 확정 대기 둘 다).
  useEffect(
    () => () => {
      clearTimer()
      if (settleTimer.current !== null) window.clearTimeout(settleTimer.current)
      settleTimer.current = null
      rewinding.current = false
    },
    [clearTimer],
  )

  return { inputRef, recordChange, beginComposition, endComposition, commit }
}
