import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type {
  ClipboardEvent as ReactClipboardEvent,
  FocusEvent as ReactFocusEvent,
  KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import MarkdownView from './MarkdownView'
import { isRichEditableBlock } from './markdown/inlineModel'
import { escapeInlineText } from './markdown/inlineSerialize'
import {
  applySelection,
  buildRichSession,
  enterOp,
  lineIsEmptyAt,
  lineIsHeadingAt,
  placeCaretAtEnd,
  quoteReleaseOp,
  snapshotSource,
  syncSession,
} from './markdown/richSurface'
import type { DomPoint, RichSession } from './markdown/richSurface'
import { htmlToDialectMarkdown } from '../utils/htmlPasteMarkdown'
import type { FontScale } from '../api/types'

// WYSIWYG 인라인 편집 — 리치 편집 표면(F56 / S30 ⓑ~ⓘ, stage-30 B-2·B-4~B-8).
//
// **렌더는 공용 MarkdownView 1곳뿐이다**(미리보기 전용 렌더 경로 신설 금지 — F43 앵커·S27 계승).
// 여기서는 그 결과 HTML을 contentEditable 컨테이너로 옮겨 편집하고, 편집 결과는 인라인 모델
// (`richSurface.ts`)을 거쳐 블록 소스로 되돌린다. DOM을 긁어 본문을 복원하는 경로는 없다.
//
// **React 재렌더 격리(B-4 — S27 `EditablePreview` 블록 memo 렌더 구조에 대한 예외 1건)**:
// 편집 대상 DOM(host)은 JSX 자식이 없다 — 내용은 `staging`(숨긴 React 서브트리)의 innerHTML을
// **초기 1회(및 소스가 실제로 바뀔 때만)** 복사해 넣고, 그 뒤로는 **수동 DOM 관리**다. React가
// 이 서브트리를 다시 그리면 조합 중인 IME·캐럿·선택이 통째로 날아가므로 구조로 차단한다.
// (그래서 편집 중에는 참조 칩의 제목이 나중에 도착해도 갱신되지 않는다 — 확정 후 렌더에서 보인다.)
//
// 타이핑은 모델 동기화를 **미룬다**(스냅샷 시점에 DOM을 한 번에 읽는다) — 키 입력마다 재파싱하는
// 경로가 없어 IME 조합·성능 양쪽에 안전하다.

export type RichSnapResult =
  | { ok: true; source: string; selStart: number; selEnd: number }
  | { ok: false; reason: 'composing' | 'nosession' }
  | { ok: false; reason: 'unsafe'; source: string }

/** 부모(EditablePreview)가 툴바 표면·확정에 쓰는 핸들. */
export interface RichBlockHandle {
  /** 지금 DOM 상태를 블록 소스로 직렬화 + 3층 검사. 선택 구간은 소스 오프셋으로 함께 온다. */
  snapshot: () => RichSnapResult
  /** 소스를 통째로 갈아 끼운다(툴바 서식·삽입의 결과) — 다시 렌더하고 선택을 복원한다. */
  setSource: (next: string) => void
  requestSelection: (start: number, end: number) => void
  getEl: () => HTMLElement | null
  focus: () => void
}

interface RichBlockEditorProps {
  /** 세션 시작 블록 소스 */
  source: string
  docNo?: string | null
  scale: FontScale
  onRegister: (handle: RichBlockHandle | null) => void
  /** 리치 대상이 아니게 된 소스(이미지 삽입 등)·세션 구성 실패 — 소스 편집 표면으로 넘긴다. */
  onLeaveRich: (source: string, message?: string) => void
  /** 3층(재파싱 동형성) 실패 — 그 편집을 본문에 적용하지 않고 소스 편집으로 폴백한다. */
  onFallback: (source: string) => void
  /** 목록·인용 해제(문단화) — 이 블록을 확정하고 그 뒤에 새 블록 초안을 연다. */
  onDemote: (source: string) => void
  onEscape: () => void
  onCommit: () => void
  onBlur: (e: ReactFocusEvent<HTMLElement>) => void
  /** 부모의 서식 단축키(Ctrl+B/I/U·Ctrl+Shift+H) — 표면 추상화로 그대로 흡수된다. */
  onFormatKeyDown?: (e: ReactKeyboardEvent<HTMLElement>) => void
}

const HOST_CLASS =
  'w-full rounded border border-accent bg-surface px-2 py-1 text-sm text-primary outline-none'

const BLOCK_TAGS = 'li, p, h1, h2, h3, h4, h5, h6, blockquote'

export default function RichBlockEditor(props: RichBlockEditorProps) {
  const { docNo, scale } = props
  const [source, setSourceState] = useState(props.source)

  const hostRef = useRef<HTMLDivElement>(null)
  const stagingRef = useRef<HTMLDivElement>(null)
  const sessionRef = useRef<RichSession | null>(null)
  const sourceRef = useRef(source)
  const pendingSelRef = useRef<{ start: number; end: number } | null>(null)
  const composingRef = useRef(false)

  // 콜백은 ref로만 본다 — 부모가 매 렌더 새 identity를 넘겨도 아래 레이아웃 이펙트가 다시 돌아
  // 편집 중인 DOM을 갈아엎는 일이 없어야 한다.
  const cbRef = useRef(props)
  cbRef.current = props

  // ---- 렌더 결과를 편집 표면으로 옮긴다(B-2) ----
  useLayoutEffect(() => {
    const host = hostRef.current
    const staging = stagingRef.current
    if (!host || !staging) return
    host.innerHTML = staging.innerHTML
    const session = buildRichSession(host, source)
    sessionRef.current = session
    if (!session) {
      // 렌더 DOM과 모델의 정합이 어긋났다 — 보수적으로 소스 편집에 넘긴다(회귀 0).
      cbRef.current.onLeaveRich(source)
      return
    }
    host.focus({ preventScroll: true })
    const pending = pendingSelRef.current
    pendingSelRef.current = null
    if (pending) applySelection(session, pending.start, pending.end)
    else placeCaretAtEnd(session)
  }, [source])

  const getSelectionObj = useCallback(() => {
    const host = hostRef.current
    return host?.ownerDocument.defaultView?.getSelection() ?? null
  }, [])

  const currentPoints = useCallback((): DomPoint[] => {
    const host = hostRef.current
    const sel = getSelectionObj()
    if (!host || !sel || sel.rangeCount === 0) return []
    const range = sel.getRangeAt(0)
    if (!host.contains(range.startContainer) || !host.contains(range.endContainer)) return []
    return [
      { node: range.startContainer, offset: range.startOffset },
      { node: range.endContainer, offset: range.endOffset },
    ]
  }, [getSelectionObj])

  const snapshot = useCallback((): RichSnapResult => {
    // ⓔ IME — 조합 중에는 모델 동기화·서식 명령을 전부 보류한다(조합을 끊지 않는다).
    if (composingRef.current) return { ok: false, reason: 'composing' }
    const session = sessionRef.current
    if (!session) return { ok: false, reason: 'nosession' }
    const snap = snapshotSource(session, currentPoints())
    if (!snap.ok) return { ok: false, reason: 'unsafe', source: snap.source }
    const a = snap.offsets[0] ?? snap.source.length
    const b = snap.offsets[1] ?? a
    return { ok: true, source: snap.source, selStart: Math.min(a, b), selEnd: Math.max(a, b) }
  }, [currentPoints])

  const applySource = useCallback((next: string, sel?: { start: number; end: number }) => {
    // ⓖ 이미지 세칙 — 삽입 결과가 배제 노드를 만들면 예외 규칙을 새로 만들지 않고 판정 술어에
    // 따라 소스 편집 표면으로 재진입한다.
    if (!isRichEditableBlock(next)) {
      cbRef.current.onLeaveRich(next)
      return
    }
    if (next === sourceRef.current) {
      const session = sessionRef.current
      if (sel && session) applySelection(session, sel.start, sel.end)
      return
    }
    sourceRef.current = next
    pendingSelRef.current = sel ?? null
    setSourceState(next)
  }, [])

  // ---- 툴바 표면 등록(C-1) ----
  useEffect(() => {
    const handle: RichBlockHandle = {
      snapshot,
      setSource: (next) => applySource(next),
      requestSelection: (start, end) => {
        pendingSelRef.current = { start, end }
      },
      getEl: () => hostRef.current,
      focus: () => hostRef.current?.focus({ preventScroll: true }),
    }
    cbRef.current.onRegister(handle)
    return () => cbRef.current.onRegister(null)
  }, [snapshot, applySource])

  // ---- 키 규약(B-7) ----
  function nearestBlockEl(node: Node): HTMLElement | null {
    const host = hostRef.current
    if (!host || !host.contains(node)) return null
    const el = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement
    const found = el?.closest<HTMLElement>(BLOCK_TAGS) ?? null
    return found && host.contains(found) ? found : null
  }

  function handleSnapFailure(res: RichSnapResult): void {
    if (!res.ok && res.reason === 'unsafe') cbRef.current.onFallback(res.source)
  }

  /** 캐럿이 그 선택자에 해당하는 조상 안에 있는가(인용·헤딩 판정). */
  function caretWithin(selector: string): boolean {
    const sel = getSelectionObj()
    if (!sel || sel.rangeCount === 0) return false
    const node = sel.getRangeAt(0).startContainer
    const el = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement
    const found = el?.closest(selector) ?? null
    return !!found && !!hostRef.current?.contains(found)
  }

  function runLineOp(allowLineBreak: boolean): void {
    const res = snapshot()
    if (!res.ok) {
      handleSnapFailure(res)
      return
    }
    const op = enterOp(res.source, res.selStart)
    if (!op) {
      // 인용·문단 규약(ⓕ + 2026-08-15 확정) — 둘 다 **블록 안 개행**이라 "블록 분할 미지원"과
      // 충돌하지 않는다. 이 앱은 remark-breaks 렌더라 개행이 곧 시각 줄바꿈이고, Markdown이
      // "빈 인용 줄"을 소스로 표현하지 못하므로 줄바꿈은 소스 재조립이 아니라 DOM 편집 명령으로
      // 넣는다(네이티브 undo도 살아 있다).
      // 헤딩 안 개행은 의미가 없어 그대로 무시한다.
      if (lineIsHeadingAt(res.source, res.selStart)) return
      if (caretWithin('blockquote') && lineIsEmptyAt(res.source, res.selStart)) {
        cbRef.current.onDemote(quoteReleaseOp(res.source, res.selStart).source)
        return
      }
      if (allowLineBreak && typeof document.execCommand === 'function') {
        document.execCommand('insertLineBreak')
      }
      return
    }
    if (op.kind === 'demote') {
      cbRef.current.onDemote(op.source)
      return
    }
    applySource(op.source, { start: op.caret, end: op.caret })
  }

  function handleEnter(): void {
    const sel = getSelectionObj()
    if (!sel || !sel.isCollapsed) return // 선택 구간이 있는 Enter = 미지원(무시)
    runLineOp(true)
  }

  /** 캐럿이 그 블록 요소(항목·문단)의 맨 앞인가 */
  function atBlockStart(block: HTMLElement, node: Node, offset: number): boolean {
    const probe = block.ownerDocument.createRange()
    probe.selectNodeContents(block)
    try {
      probe.setEnd(node, offset)
    } catch {
      return false
    }
    return probe.toString().length === 0
  }

  function atBlockEnd(block: HTMLElement, node: Node, offset: number): boolean {
    const probe = block.ownerDocument.createRange()
    probe.selectNodeContents(block)
    try {
      probe.setStart(node, offset)
    } catch {
      return false
    }
    return probe.toString().length === 0
  }

  function handleBackspace(e: ReactKeyboardEvent<HTMLDivElement>): void {
    const sel = getSelectionObj()
    if (!sel || !sel.isCollapsed || sel.rangeCount === 0) return // 선택 삭제는 네이티브 그대로
    const range = sel.getRangeAt(0)
    const block = nearestBlockEl(range.startContainer)
    if (!block) return
    if (!atBlockStart(block, range.startContainer, range.startOffset)) return
    // 여기서부터는 전부 "다른 항목·블록과의 병합" 영역이다 — 빈 항목의 목록 해제만 지원한다.
    e.preventDefault()
    if ((block.textContent ?? '').trim() !== '') return // 항목 병합·블록 병합 = 미지원(무시)
    runLineOp(false)
  }

  function handleDelete(e: ReactKeyboardEvent<HTMLDivElement>): void {
    const sel = getSelectionObj()
    if (!sel || !sel.isCollapsed || sel.rangeCount === 0) return
    const range = sel.getRangeAt(0)
    const block = nearestBlockEl(range.startContainer)
    if (!block) return
    if (!atBlockEnd(block, range.startContainer, range.startOffset)) return
    e.preventDefault() // 뒤 항목·블록 끌어올리기 = 미지원(무시)
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLDivElement>): void {
    // ⓔ 조합 중 키는 전부 흘려 보낸다(툴바·단축키 무시 — 조합을 끊지 않는다).
    if (composingRef.current || e.nativeEvent.isComposing) return

    if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault()
      e.stopPropagation()
      cbRef.current.onEscape()
      return
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      cbRef.current.onCommit()
      return
    }
    if (e.key === 'Tab') {
      e.preventDefault() // 들여쓰기 변경 = 미지원(정식 경로는 [소스로 편집])
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      handleEnter()
      return
    }
    if (e.key === 'Backspace') {
      handleBackspace(e)
      return
    }
    if (e.key === 'Delete') {
      handleDelete(e)
      return
    }
    cbRef.current.onFormatKeyDown?.(e)
  }

  // ---- 붙여넣기(B-6 · 설계 ⓒ) ----
  function handlePaste(e: ReactClipboardEvent<HTMLDivElement>): void {
    const data = e.clipboardData
    if (!data) return
    const files = Array.from(data.files ?? [])
    // 이미지 파일 붙여넣기는 F54 기존 업로드 경로(부모 컨테이너)가 그대로 처리한다 — 여기서
    // 가로채지 않는다(신규 업로드 경로 0).
    if (files.some((file) => file.type.startsWith('image/'))) return
    if (composingRef.current) return
    e.preventDefault()
    const html = data.getData('text/html')
    const plain = data.getData('text/plain')
    // text/html은 화이트리스트 변환기로 방언 Markdown이 되고, 없으면 text/plain을 **글자 그대로**
    // (= 리치 표면에서 타이핑한 것과 같은 취급으로) 이스케이프해 넣는다.
    const inserted = html ? htmlToDialectMarkdown(html) : escapeInlineText(plain)
    if (!inserted) return
    const res = snapshot()
    if (!res.ok) {
      handleSnapFailure(res)
      return
    }
    const next = `${res.source.slice(0, res.selStart)}${inserted}${res.source.slice(res.selEnd)}`
    const caret = res.selStart + inserted.length
    applySource(next, { start: caret, end: caret })
  }

  return (
    <>
      {/*
        숨긴 렌더 무대 — 공용 MarkdownView(sourcePos on)가 여기서 그린 결과를 아래 편집 표면으로
        복사한다. React가 손대는 DOM은 **이쪽뿐**이고, 편집 표면은 수동 관리다(B-4 예외 1건).
      */}
      <div ref={stagingRef} className="hidden" aria-hidden>
        <MarkdownView content={source} docNo={docNo} scale={scale} sourcePos />
      </div>
      <div
        ref={hostRef}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline
        aria-label="블록 편집(서식 보기) — Ctrl+Enter 확정 · Esc 취소"
        data-rich-block=""
        spellCheck={false}
        className={HOST_CLASS}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onBlur={(e) => {
          // 표면이 포커스를 잃는 시점에는 브라우저가 조합을 이미 확정해 DOM에 반영한 뒤다 —
          // compositionend를 놓친 경우에도 확정이 막히지 않도록 조합 플래그를 여기서 내린다
          // (조합 중 확정 보류가 "영영 확정되지 않는 초안"으로 굳는 것을 막는 안전망).
          composingRef.current = false
          props.onBlur(e)
        }}
        onDragStart={(e) => e.preventDefault() /* 블록·텍스트 드래그 재배열 = 미지원 */}
        onCompositionStart={() => {
          composingRef.current = true
        }}
        onCompositionEnd={() => {
          composingRef.current = false
          // 조합 확정분을 여기서 한 번에 모델로 흘린다(조합 중에는 아무 것도 하지 않았다).
          const session = sessionRef.current
          if (session) syncSession(session)
        }}
      />
    </>
  )
}
