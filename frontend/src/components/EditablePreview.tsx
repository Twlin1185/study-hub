import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { FocusEvent as ReactFocusEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import MarkdownView from './MarkdownView'
import RichBlockEditor from './RichBlockEditor'
import type { RichBlockHandle } from './RichBlockEditor'
import { isRichEditableBlock } from './markdown/inlineModel'
import { scanBlocks } from '../utils/markdownBlocks'
import type { BlockRange } from '../utils/markdownBlocks'
import type { FontScale } from '../api/types'

// 편집 가능 미리보기(F55 / S27) — `MarkdownFieldEditor`의 '미리보기' 뷰 모드 전용.
// 미리보기를 최상위 블록 단위로 렌더하고(블록마다 **공용 MarkdownView** 재사용 — 미리보기 전용
// 렌더 경로 금지), 블록을 클릭하면 그 블록만 자동 높이 textarea(로컬 초안)로 바뀐다.
// 확정(blur·Ctrl+Enter) 시에만 원본 value의 오프셋 구간을 문자열 치환해 onChange를 1회 부른다 —
// 재조립은 항상 구간 치환뿐이라 **손대지 않은 문서는 1바이트도 바뀌지 않는다**(R28 ①).
// 색상 하드코딩 0 — 토큰 클래스만.
//
// S30(F56) — 위 계약은 전건 유지하고, **리치 대상 블록**(문단·헤딩·목록·인용, 판정 술어는
// `isRichEditableBlock`)만 소스 textarea 대신 **리치 편집 표면**(RichBlockEditor)으로 연다.
// 표·코드펜스·수식·임베드·콜아웃·이미지 포함 블록은 판정이 거짓이라 S27 경로 그대로다(회귀 0).
// 확정·취소·창 포커스 예외·툴바 표면 규약은 두 모드가 **같은 코드 경로**를 쓴다.

// 편집 진입으로 삼지 않는 요소(2-2) — 링크·임베드 [원문 열기]·스포일러/fold/hide 토글 등은
// 기존 클릭 동작을 그대로 유지한다(모바일 탭 동일).
const INTERACTIVE_SELECTOR = 'a, button, summary, input, select, textarea, [role="button"], [contenteditable]'

// 끝/앞의 "빈 줄"만 정리한다(내용 줄의 끝 공백은 건드리지 않는다).
const TRAILING_BLANK_RE = /(?:\n[ \t]*)+$/
const LEADING_BLANK_RE = /^(?:[ \t]*\n)+/

// 확정할 초안 정규화: 앞뒤의 빈 줄만 떼어 내고(내용 줄 끝 공백은 보존), 공백뿐이면 빈 문자열로
// 본다(= 블록 삭제 / 자리표시자에선 "아무 일 없음").
function normalizeDraft(text: string): string {
  const trimmed = text.replace(LEADING_BLANK_RE, '').replace(TRAILING_BLANK_RE, '')
  return trimmed.trim() === '' ? '' : trimmed
}

function autoSize(el: HTMLTextAreaElement) {
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

/** 블록 편집 표면 종류 — 'rich'는 S30 리치 표면, 'source'는 S27 소스 textarea. */
type BlockEditMode = 'source' | 'rich'

type EditTarget =
  | { kind: 'block'; start: number; end: number; mode: BlockEditMode }
  | { kind: 'append' }
  // 목록·인용 해제(S30 ⓕ)의 착지점 — 그 블록 **뒤에** 새 블록을 여는 초안(소스 표면).
  | { kind: 'insert'; at: number }

interface CommitResult {
  next: string
  /** 확정 전(value) 오프셋 → 확정 후(next) 오프셋 */
  map: (offset: number) => number
}

/** 툴바·단축키·참조 삽입이 활성 블록 초안을 대상으로 동작하게 부모에 넘기는 핸들(3-2). */
export interface BlockEditSurface {
  getEl: () => HTMLTextAreaElement | null
  getText: () => string
  setText: (next: string) => void
  // 결함 3 수정 — 서식 적용 후 이 범위를 선택 상태로 두라는 요청을 큐잉한다. draft는 이
  // 컴포넌트가 소유한 로컬 state라 부모(MarkdownFieldEditor)는 커밋 시점을 알 수 없으므로,
  // 이 컴포넌트 자신의 draft 커밋 직후 useLayoutEffect에서 소비한다(아래).
  requestSelection: (start: number, end: number) => void
  /**
   * 표면의 현재 선택 구간. textarea 표면은 el의 selectionStart/End 그대로이고, **리치 표면은
   * 텍스트 오프셋이 아니라 자체 좌표(직렬화된 소스 오프셋)** 를 돌려준다 — 툴바가 표면 종류를
   * 알 필요가 없게 하는 유일한 확장점이다(S30 ⓖ).
   */
  getSelection: () => { start: number; end: number }
  /**
   * 툴바 조작 직전 표면 상태를 스냅샷으로 굳힌다(리치 표면만 구현). false면 이번 조작은
   * 진행하지 않는다 — 조합 중이거나(무시) 3층 검사에 걸려 소스 편집으로 폴백한 경우다.
   */
  sync?: () => boolean
  /** [소스로 편집] 퇴로(S30 ⓘ ①) — 리치 표면만 구현. */
  toSource?: () => void
  commit: () => void
}

interface EditablePreviewProps {
  value: string
  onChange: (next: string) => void
  docNo?: string | null
  scale: FontScale
  /** 미리보기 패널 바깥 상자 클래스(기존 읽기 전용 미리보기와 동일하게 부모가 넘긴다). */
  containerClassName?: string
  /** 편집기 크롬(툴바·참조 삽입 팝업 포함) 루트 — 이 안으로 포커스/클릭이 가면 확정하지 않는다. */
  chromeRef: { current: HTMLElement | null }
  /** 참조 삽입 팝업처럼 포커스를 오래 가져가는 크롬 조작 중 blur 확정을 막는 스위치. */
  keepEditingRef: { current: boolean }
  /** 활성 블록 편집 표면 등록(없으면 null). 부모는 안정된 identity의 콜백을 넘겨야 한다. */
  registerSurface: (surface: BlockEditSurface | null) => void
  /** 부모의 서식 단축키 핸들러(Ctrl+B/I/U·Ctrl+Shift+H) — 블록 초안·리치 표면에 그대로 적용. */
  onFormatKeyDown?: (e: ReactKeyboardEvent<HTMLElement>) => void
  /** S30 ⓘ ② 퇴로 플래그 — false면 리치 표면을 쓰지 않고 S27 동작으로 완전 복귀. */
  wysiwyg?: boolean
  /** 부모의 role="status" 안내 영역 재사용(신규 컴포넌트 0). */
  onNotice?: (message: string) => void
  /** 지금 활성 표면이 리치 블록인가 — 툴바 [소스로 편집] 버튼 노출 판단용. */
  onRichActiveChange?: (active: boolean) => void
}

// 블록 렌더는 내용 기준 메모 — 한 블록을 확정해도 나머지 블록은 다시 그리지 않는다(2-1).
const BlockRender = memo(function BlockRender({
  content,
  docNo,
  scale,
}: {
  content: string
  docNo?: string | null
  scale: FontScale
}) {
  return <MarkdownView content={content} docNo={docNo} scale={scale} />
})

const BLOCK_CLASS =
  'cursor-text rounded border border-transparent px-2 py-0.5 outline-none hover:border-border hover:bg-bg focus-visible:border-accent'
const PLACEHOLDER_CLASS =
  'mt-1 w-full rounded border border-dashed border-border px-2 py-2 text-left text-sm text-muted hover:bg-bg'
const DRAFT_CLASS =
  'w-full resize-none overflow-hidden rounded border border-accent bg-surface px-2 py-1 text-sm leading-relaxed text-primary outline-none'

const FALLBACK_NOTICE = '서식 편집을 그대로 저장할 수 없어 소스 편집으로 전환했습니다'

export default function EditablePreview({
  value,
  onChange,
  docNo,
  scale,
  containerClassName = '',
  chromeRef,
  keepEditingRef,
  registerSurface,
  onFormatKeyDown,
  wysiwyg = true,
  onNotice,
  onRichActiveChange,
}: EditablePreviewProps) {
  // 블록 분해는 **확정된 value 기준**이다 — 초안은 로컬 state라 타이핑 중에는 value가 그대로이고
  // 따라서 편집 중 다른 블록이 갈라지거나 편집기가 닫히는 일이 없다(2-3).
  const blocks = useMemo(() => scanBlocks(value), [value])

  const [editing, setEditing] = useState<EditTarget | null>(null)
  const [draft, setDraft] = useState('')

  const containerRef = useRef<HTMLDivElement>(null)
  const draftElRef = useRef<HTMLTextAreaElement>(null)
  // 네이티브 이벤트(문서 pointerdown)와 blur 핸들러가 렌더 시점과 무관하게 최신 값을 봐야 하므로
  // 렌더 중 동기화한다(이펙트 지연 없이 항상 현재 값).
  const valueRef = useRef(value)
  valueRef.current = value
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const noticeRef = useRef(onNotice)
  noticeRef.current = onNotice
  const richActiveRef = useRef(onRichActiveChange)
  richActiveRef.current = onRichActiveChange
  const wysiwygRef = useRef(wysiwyg)
  wysiwygRef.current = wysiwyg
  const draftRef = useRef('')
  const editingRef = useRef<EditTarget | null>(null)
  // 리치 표면 핸들(활성 블록이 리치일 때만). 직렬화·소스 교체·선택 복원의 창구다.
  const richHandleRef = useRef<RichBlockHandle | null>(null)
  // 툴바 조작 직전에 굳힌 리치 표면 스냅샷(소스 + 선택 구간).
  const richSnapRef = useRef<{ source: string; selStart: number; selEnd: number } | null>(null)
  // 결함 3 — draft(초안) 커밋 직후에만 소비하는 대기 중 선택 요청(아래 [draft] useLayoutEffect).
  const pendingSelectionRef = useRef<{ start: number; end: number } | null>(null)
  // 미리보기 상자 안에서 시작한 클릭은 blur가 아니라 click 핸들러가 "확정 + 다른 블록 열기"를
  // 한 번에 처리한다(그래야 확정 직후 밀린 오프셋을 정확히 다시 계산할 수 있다).
  const suppressBlurRef = useRef(false)
  const pointerInDraftRef = useRef(false)

  /** 지금 편집 중인 표면의 DOM 요소(소스 textarea 또는 리치 호스트) — 클릭·blur 판정 기준. */
  const activeEl = useCallback((): HTMLElement | null => {
    const target = editingRef.current
    if (!target) return null
    if (target.kind === 'block' && target.mode === 'rich') return richHandleRef.current?.getEl() ?? null
    return draftElRef.current
  }, [])

  const closeEditor = useCallback(() => {
    draftRef.current = ''
    editingRef.current = null
    richHandleRef.current = null
    richSnapRef.current = null
    setDraft('')
    setEditing(null)
  }, [])

  const openEditor = useCallback((target: EditTarget, source: string) => {
    let next = target
    let text = ''
    if (target.kind === 'block') {
      text = source.slice(target.start, target.end)
      // S30 ⓐ — 판정 술어 하나로 갈린다(신규 블록 분해 로직 0). 퇴로 플래그가 꺼져 있으면 항상 소스.
      const mode: BlockEditMode = wysiwygRef.current && isRichEditableBlock(text) ? 'rich' : 'source'
      next = { ...target, mode }
    }
    draftRef.current = text
    editingRef.current = next
    richHandleRef.current = null
    richSnapRef.current = null
    suppressBlurRef.current = false
    setDraft(text)
    setEditing(next)
  }, [])

  /**
   * 리치 표면 → 소스 편집 전환. 3층 폴백(설계 ⓑ)·미지원 조작의 착지점·[소스로 편집] 퇴로가
   * 전부 여기로 모인다. **초안(text)은 그대로 들고 간다** — 본문에 적용하지 않을 뿐,
   * 사용자가 친 내용이 조용히 사라지는 경로는 만들지 않는다(S27 불변 계약 계승).
   */
  const switchToSource = useCallback((text: string, message: string | null = FALLBACK_NOTICE) => {
    const target = editingRef.current
    if (!target || target.kind !== 'block') return
    const next: EditTarget = { kind: 'block', start: target.start, end: target.end, mode: 'source' }
    richHandleRef.current = null
    richSnapRef.current = null
    draftRef.current = text
    editingRef.current = next
    setDraft(text)
    setEditing(next)
    if (message) noticeRef.current?.(message)
  }, [])

  // 확정 본체 — 원본 구간 치환 1회. 값이 실제로 달라졌을 때만 onChange를 부른다(무편집 = dirty 아님).
  const commitText = useCallback(
    (raw: string): CommitResult | null => {
      const target = editingRef.current
      if (!target) return null
      const current = valueRef.current
      const mid = normalizeDraft(raw)
      closeEditor()

      let result: CommitResult
      if (target.kind === 'append') {
        // 빈 초안 확정 = 아무 일도 없음(2-5).
        if (mid === '') return null
        // 기존 본문 바이트는 **그대로 두고** 뒤에 붙인다(끝 개행도 보존) — 구분 빈 줄이 되도록
        // 모자란 개행만 계산해 채운다. 내용이 아예 없는(공백뿐인) 문서만 초안으로 대체한다.
        if (current.trim() === '') {
          result = { next: mid, map: () => 0 }
        } else {
          const tail = TRAILING_BLANK_RE.exec(current)
          const newlines = tail ? (tail[0].match(/\n/g)?.length ?? 0) : 0
          const sep = newlines >= 2 ? '' : newlines === 1 ? '\n' : '\n\n'
          result = { next: `${current}${sep}${mid}`, map: (o) => o }
        }
      } else if (target.kind === 'insert') {
        // 목록·인용 해제로 생긴 새 블록 — 앞뒤에 구분 빈 줄이 되도록 모자란 개행만 채운다.
        if (mid === '') return null
        const at = Math.min(Math.max(0, target.at), current.length)
        const before = current.slice(0, at)
        const after = current.slice(at)
        const lead = before === '' ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
        const tailSep = after === '' ? '' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n'
        const inserted = `${lead}${mid}${tailSep}`
        result = {
          next: `${before}${inserted}${after}`,
          map: (o) => (o <= at ? o : o + inserted.length),
        }
      } else if (mid === '') {
        // 블록 전체 삭제 — 앞뒤 구분 빈 줄이 이중으로 남지 않게 정리한다(2-5).
        const before = current.slice(0, target.start).replace(TRAILING_BLANK_RE, '')
        const afterRaw = current.slice(target.end)
        const after = afterRaw.replace(LEADING_BLANK_RE, '')
        const sep = before !== '' && after !== '' ? '\n\n' : ''
        const base = before.length + sep.length
        const oldAfterStart = target.end + (afterRaw.length - after.length)
        result = {
          next: `${before}${sep}${after}`,
          map: (o) => (o <= target.start ? Math.min(o, before.length) : base + Math.max(0, o - oldAfterStart)),
        }
      } else {
        const delta = mid.length - (target.end - target.start)
        result = {
          next: `${current.slice(0, target.start)}${mid}${current.slice(target.end)}`,
          map: (o) => (o <= target.start ? o : o >= target.end ? o + delta : target.start),
        }
      }

      if (result.next !== current) onChangeRef.current(result.next)
      return result
    },
    [closeEditor],
  )

  /**
   * 확정 — 표면 종류에 상관없이 이 하나로 모인다(S30 ⓗ = S27 규약 전건 계승).
   * 리치 표면은 여기서 ⓑ 직렬화 + 3층 검사를 거쳐 **같은 구간 치환**으로 반영된다.
   */
  const commit = useCallback((): CommitResult | null => {
    const target = editingRef.current
    if (!target) return null
    if (target.kind === 'block' && target.mode === 'rich') {
      const handle = richHandleRef.current
      if (!handle) {
        closeEditor()
        return null
      }
      const res = handle.snapshot()
      if (res.ok) return commitText(res.source)
      if (res.reason === 'unsafe') {
        // 3층 실패 — 본문에는 **적용하지 않고** 소스 편집으로 폴백한다(조용한 본문 변형 0).
        switchToSource(res.source)
        return null
      }
      // 조합 중이면 확정을 미룬다(초안·캐럿 유지). 세션이 없으면 변경 없이 닫는다.
      if (res.reason === 'nosession') closeEditor()
      return null
    }
    return commitText(draftRef.current)
  }, [closeEditor, commitText, switchToSource])

  /** 빈 목록 항목·빈 인용 줄에서의 해제(설계 ⓕ) — 그 줄을 뺀 소스로 확정하고 뒤에 새 블록을 연다. */
  const handleDemote = useCallback(
    (sourceWithoutLine: string) => {
      const target = editingRef.current
      if (!target || target.kind !== 'block') return
      const end = target.end
      const committed = commitText(sourceWithoutLine)
      const at = committed ? committed.map(end) : end
      openEditor({ kind: 'insert', at }, committed ? committed.next : valueRef.current)
    },
    [commitText, openEditor],
  )

  // 툴바·단축키·참조 삽입 대상 등록(3-2 · S30 ⓖ 4번째 표면).
  useEffect(() => {
    if (!editing) {
      registerSurface(null)
      richActiveRef.current?.(false)
      return
    }
    if (editing.kind === 'block' && editing.mode === 'rich') {
      registerSurface({
        // 리치 표면은 textarea가 아니다 — 부모의 applyRangeEdit는 el이 없을 때의 안전한
        // 폴백 경로(setText + requestSelection)를 그대로 탄다(네이티브 undo는 S27 한계 승계).
        getEl: () => null,
        getText: () => richSnapRef.current?.source ?? '',
        setText: (next) => richHandleRef.current?.setSource(next),
        requestSelection: (start, end) => richHandleRef.current?.requestSelection(start, end),
        getSelection: () => ({
          start: richSnapRef.current?.selStart ?? 0,
          end: richSnapRef.current?.selEnd ?? 0,
        }),
        sync: () => {
          const handle = richHandleRef.current
          if (!handle) return false
          const res = handle.snapshot()
          if (!res.ok) {
            if (res.reason === 'unsafe') switchToSource(res.source)
            return false
          }
          richSnapRef.current = res
          return true
        },
        toSource: () => {
          const res = richHandleRef.current?.snapshot()
          if (!res) return
          if (res.ok) switchToSource(res.source, null)
          else if (res.reason === 'unsafe') switchToSource(res.source)
        },
        commit: () => {
          commit()
        },
      })
      richActiveRef.current?.(true)
      return () => {
        registerSurface(null)
        richActiveRef.current?.(false)
      }
    }
    registerSurface({
      getEl: () => draftElRef.current,
      getText: () => draftRef.current,
      setText: (next) => {
        draftRef.current = next
        setDraft(next)
      },
      requestSelection: (start, end) => {
        pendingSelectionRef.current = { start, end }
      },
      getSelection: () => {
        const el = draftElRef.current
        const len = draftRef.current.length
        return { start: el?.selectionStart ?? len, end: el?.selectionEnd ?? len }
      },
      commit: () => {
        commit()
      },
    })
    richActiveRef.current?.(false)
    return () => registerSurface(null)
  }, [editing, registerSurface, commit, switchToSource])

  // 편집기 **바깥** 클릭은 확정(3-3·3-4) — 저장 버튼·모달 오버레이·닫기(X)가 전부 이 경로를 지나므로
  // 초안이 조용히 사라지는 길이 없다. 크롬(툴바·참조 삽입 팝업) 안이면 블록을 유지한다(2-4).
  // (편집 중이 아닐 때도 붙여 둔다 — 두 플래그가 늘 최신이어야 다음 클릭 판정이 어긋나지 않는다.
  //  편집 중이 아니면 commit()은 무동작.)
  useEffect(() => {
    function handlePointerDown(e: PointerEvent) {
      const node = e.target as Node | null
      const inDraft = !!(node && activeEl()?.contains(node))
      const inContainer = !!(node && containerRef.current?.contains(node))
      pointerInDraftRef.current = inDraft
      suppressBlurRef.current = inContainer && !inDraft
      if (inDraft || keepEditingRef.current) return
      if (node && chromeRef.current?.contains(node)) return
      commit()
    }
    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => document.removeEventListener('pointerdown', handlePointerDown, true)
  }, [commit, chromeRef, keepEditingRef, activeEl])

  // 초안 **밖**에서 눌린 Esc(예: 툴바 셀렉트에 포커스가 가 있는 상태) — 그대로 두면 바깥 모달의
  // window keydown이 편집기를 닫아 미확정 초안이 조용히 사라진다(3-3 위반). 여기서 가로채
  // ⓐ 전파를 끊고 ⓑ 취소가 아니라 **확정**한다 — 확정된 값이 부모의 dirty 판정에 합류하므로
  // 이어지는 Esc는 기존 "작성 중인 내용이 있습니다" 확인창을 정상적으로 거친다.
  // (초안 textarea·리치 표면 안의 Esc = 취소는 각자의 onKeyDown 경로 그대로.)
  useEffect(() => {
    function handleKeyDownCapture(e: KeyboardEvent) {
      if (e.key !== 'Escape' || e.ctrlKey || e.altKey || e.metaKey) return
      if (!editingRef.current) return
      if (keepEditingRef.current) return // 참조 삽입 팝업이 열려 있으면 그쪽 Esc가 우선
      const node = e.target as Node | null
      if (node && activeEl()?.contains(node)) return
      e.stopPropagation()
      commit()
    }
    document.addEventListener('keydown', handleKeyDownCapture, true)
    return () => document.removeEventListener('keydown', handleKeyDownCapture, true)
  }, [commit, keepEditingRef, activeEl])

  // 안전망 이중화 — 어떤 경로로든 이 컴포넌트가 사라질 때 남아 있는 초안은 확정한다.
  const commitRef = useRef(commit)
  commitRef.current = commit
  useEffect(
    () => () => {
      commitRef.current()
    },
    [],
  )

  // 열릴 때 포커스 + 자동 높이, 타이핑마다 높이 재계산(소스 표면 전용 — 리치 표면은 자기 이펙트에서).
  useLayoutEffect(() => {
    if (!editing) return
    const el = draftElRef.current
    if (!el) return
    autoSize(el)
    el.focus()
    const caret = el.value.length
    el.setSelectionRange(caret, caret)
  }, [editing])

  // 결함 3 — draft가 실제로 DOM에 커밋된 직후(페인트 전) 대기 중 선택 요청을 소비한다. 요청이
  // 없으면(일반 타이핑 등) 아무 것도 하지 않는다.
  useLayoutEffect(() => {
    const el = draftElRef.current
    if (el) autoSize(el)
    const pending = pendingSelectionRef.current
    pendingSelectionRef.current = null
    if (pending && el) {
      el.setSelectionRange(pending.start, pending.end)
    }
  }, [draft])

  function activate(target: { start: number; end: number } | 'append') {
    const committed = commit()
    const source = committed ? committed.next : valueRef.current
    if (target === 'append') {
      openEditor({ kind: 'append' }, source)
      return
    }
    if (!committed) {
      openEditor({ kind: 'block', start: target.start, end: target.end, mode: 'source' }, source)
      return
    }
    // 다른 블록을 확정하면서 오프셋이 밀렸다 — 새 값 기준으로 같은 블록을 다시 찾는다.
    const mapped = committed.map(target.start)
    const nextBlocks = scanBlocks(source)
    const found = nextBlocks.find((b) => mapped >= b.start && mapped < b.end) ?? nextBlocks.find((b) => b.end > mapped)
    if (!found) return
    openEditor({ kind: 'block', start: found.start, end: found.end, mode: 'source' }, source)
  }

  function handleContainerClick(e: ReactMouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement | null
    const startedInDraft = pointerInDraftRef.current
    // 두 플래그는 이 클릭에 대한 판정에만 쓰인다 — 다음 클릭(키보드 활성화 포함)까지 끌고 가면
    // 초안 안을 클릭한 뒤로 컨테이너 클릭이 통째로 막힌다.
    suppressBlurRef.current = false
    pointerInDraftRef.current = false
    if (!target) return
    if (startedInDraft) return // 초안·리치 표면 안에서 시작한 클릭·드래그
    if (activeEl()?.contains(target)) return // 표면 안 클릭(캐럿 이동)은 아무 일도 아니다
    // 링크·스포일러·fold 토글 등은 원래 동작만 하고 편집으로 진입하지 않는다. 빈 여백 클릭도
    // 마찬가지 — 다만 편집 중이던 초안은 확정한다(어정쩡하게 열린 채 남지 않게).
    if (target.closest(INTERACTIVE_SELECTOR)) {
      commit()
      return
    }
    const holder = target.closest('[data-block-start]') as HTMLElement | null
    if (!holder) {
      commit()
      return
    }
    const start = Number(holder.dataset.blockStart)
    const end = Number(holder.dataset.blockEnd)
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      commit()
      return
    }
    activate({ start, end })
  }

  // 자리표시자는 컨테이너 위임이 아니라 자기 onClick으로 처리한다 — 버튼이라 키보드(Enter·Space)
  // 활성화도 그대로 통하고, 위임 경로의 포인터 플래그 판정에 걸리지 않는다.
  function handleAppendClick(e: ReactMouseEvent<HTMLButtonElement>) {
    e.stopPropagation()
    suppressBlurRef.current = false
    pointerInDraftRef.current = false
    activate('append')
  }

  function handleBlockKeyDown(e: ReactKeyboardEvent<HTMLDivElement>, block: BlockRange) {
    if (e.target !== e.currentTarget) return
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    activate({ start: block.start, end: block.end })
  }

  function handleDraftKeyDown(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      // 취소 — 초안 폐기. 바깥 모달(Esc로 닫힘)까지 전파되지 않게 막는다(첫 Esc = 편집 취소).
      e.preventDefault()
      e.stopPropagation()
      closeEditor()
      return
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      commit()
      return
    }
    onFormatKeyDown?.(e)
  }

  function handleDraftBlur(e: ReactFocusEvent<HTMLElement>) {
    if (keepEditingRef.current) return
    if (suppressBlurRef.current) return
    // 창 포커스 상실 예외(2-6, screens §5.3 S27 ⓒ — S27 계약의 정밀화이지 번복이 아니다):
    // 파일 탐색기·다른 앱 클릭·알트탭으로 브라우저 창 전체가 포커스를 잃으면 `relatedTarget`이
    // null인 focusout이 뜬다. 이건 "페이지 안에서 편집을 떠난" 것이 아니므로 확정하지 않는다 —
    // 블록·캐럿·초안을 그대로 두고 창으로 돌아오면 이어서 편집한다. 아래의 기존 확정 경로들은
    // 전부 document.hasFocus() === true인 상태에서만 도달하므로 이 분기의 영향을 받지 않는다.
    if (!document.hasFocus()) return
    const next = e.relatedTarget as Node | null
    // 표면 **안**으로 포커스가 옮겨간 것은 이탈이 아니다 — 리치 표면 안의 참조 칩(button)처럼
    // 포커스를 받는 요소를 눌렀다고 블록이 닫히면 안 된다.
    if (next && activeEl()?.contains(next)) return
    // 편집기 크롬(툴바·셀렉트 등)으로 포커스가 옮겨간 것은 편집 이탈이 아니다 — 단, 미리보기 상자
    // 안(다른 블록)으로 옮겨간 경우는 확정한다.
    if (next && chromeRef.current?.contains(next) && !containerRef.current?.contains(next)) return
    commit()
  }

  function renderDraft(key: string) {
    return (
      <textarea
        key={key}
        ref={draftElRef}
        value={draft}
        onChange={(e) => {
          draftRef.current = e.target.value
          setDraft(e.target.value)
        }}
        onKeyDown={handleDraftKeyDown}
        onBlur={handleDraftBlur}
        rows={1}
        aria-label="블록 편집"
        placeholder="Markdown 입력 — Ctrl+Enter 확정 · Esc 취소"
        className={DRAFT_CLASS}
      />
    )
  }

  function renderRich(block: BlockRange) {
    return (
      <RichBlockEditor
        key={`rich-${block.start}`}
        source={value.slice(block.start, block.end)}
        docNo={docNo}
        scale={scale}
        onRegister={(handle) => {
          richHandleRef.current = handle
        }}
        onLeaveRich={(next) => switchToSource(next, null)}
        onFallback={(next) => switchToSource(next)}
        onDemote={handleDemote}
        onEscape={closeEditor}
        onCommit={() => {
          commit()
        }}
        onBlur={handleDraftBlur}
        onFormatKeyDown={onFormatKeyDown}
      />
    )
  }

  // 목록·인용 해제로 생긴 새 블록 초안은 그 위치의 블록 **뒤에** 그린다.
  let insertAfter = -1
  if (editing?.kind === 'insert') {
    const at = editing.at
    blocks.forEach((b, idx) => {
      if (b.end <= at) insertAfter = idx
    })
  }

  return (
    <div ref={containerRef} className={containerClassName} onClick={handleContainerClick}>
      {editing?.kind === 'insert' && insertAfter === -1 && renderDraft('draft-insert')}
      {blocks.map((b, idx) => {
        const isEditing = editing?.kind === 'block' && editing.start === b.start && editing.end === b.end
        const body = isEditing ? (
          editing.mode === 'rich' ? (
            renderRich(b)
          ) : (
            renderDraft(`draft-${b.start}`)
          )
        ) : (
          <div
            key={b.start}
            data-block-start={b.start}
            data-block-end={b.end}
            tabIndex={0}
            onKeyDown={(e) => handleBlockKeyDown(e, b)}
            className={BLOCK_CLASS}
          >
            <BlockRender content={value.slice(b.start, b.end)} docNo={docNo} scale={scale} />
          </div>
        )
        if (editing?.kind !== 'insert' || insertAfter !== idx) return body
        return (
          <Fragment key={`slot-${b.start}`}>
            {body}
            {renderDraft('draft-insert')}
          </Fragment>
        )
      })}

      {/* 말미 자리표시자(2-5·2-6) — 빈 문서에서는 이 줄이 "미리볼 내용이 없습니다" 안내를 겸한다. */}
      {editing?.kind === 'append' ? (
        renderDraft('draft-append')
      ) : (
        <button type="button" onClick={handleAppendClick} className={PLACEHOLDER_CLASS}>
          클릭해서 입력…
        </button>
      )}
    </div>
  )
}
