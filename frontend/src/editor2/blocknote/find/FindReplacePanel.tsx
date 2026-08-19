// 찾기/바꾸기 **패널**(stage-36 F-7 · 규약 E) — 편집 표면 하나당 하나.
//
// 범위는 **이 편집 표면의 문서 안**이다(본문·해설은 각각 자기 패널을 갖는다). 문서를 가로지르는
// 전역 검색은 기존 FTS(§4 검색 API)가 담당하므로 문구도 "이 표면에서 찾기"로 못 박는다 — 규약 E.
//
// 색 리터럴 0(불변 규칙 5) — 토큰 유틸(`border-border`·`bg-surface`·`text-primary`…)만 쓴다.
// 하이라이트 자체는 PM 장식이라 `notes.css`가 `tokens.css` 변수로 결선한다.
import { useCallback, useEffect, useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useEditorDOMElement } from '@blocknote/react'
import type { EditorState } from 'prosemirror-state'
import { useNoteEditor } from '../toolbar/useNoteEditor'
import { usePmSnapshot } from '../usePmSnapshot'
import {
  closeFind,
  openFind,
  replaceAll,
  replaceCurrent,
  selectedPlainText,
  setFindQuery,
  stepFind,
} from './commands'
import { getFindState } from './findPlugin'

interface FindSnapshot {
  open: boolean
  query: string
  caseSensitive: boolean
  total: number
  activeIndex: number
}

/** 편집기 뷰가 아직 없을 때(첫 렌더) 쓰는 값 — 패널은 닫힌 상태로 시작한다. */
const IDLE: FindSnapshot = { open: false, query: '', caseSensitive: false, total: 0, activeIndex: -1 }

// 모듈 스코프 함수 — `usePmSnapshot`의 구독이 매 렌더 요동치지 않게 한다.
function readFind(state: EditorState): FindSnapshot {
  const find = getFindState(state)
  return {
    open: find.open,
    query: find.query,
    caseSensitive: find.caseSensitive,
    total: find.matches.length,
    activeIndex: find.activeIndex,
  }
}

function sameFind(a: FindSnapshot, b: FindSnapshot): boolean {
  return (
    a.open === b.open &&
    a.query === b.query &&
    a.caseSensitive === b.caseSensitive &&
    a.total === b.total &&
    a.activeIndex === b.activeIndex
  )
}

/**
 * 화면에 편집 표면이 둘 이상일 때(문서 편집 = 본문·해설) **찾기 패널은 한 번에 하나만** 뜬다.
 * 표면마다 자기 패널·자기 문서 범위를 갖는 것이 규약 E지만, 두 패널이 동시에 떠 있으면 화면
 * 오른쪽 아래에서 서로 겹치고 "지금 어느 표면을 찾고 있는지"도 흐려진다. 새로 열리는 쪽이
 * 나머지를 닫는다(모듈 스코프 등록부 — 표면끼리 부모를 거치지 않고 합의한다).
 */
const openCloser = new Map<object, () => void>()

export default function FindReplacePanel() {
  const editor = useNoteEditor()
  const dom = useEditorDOMElement()
  const snapshot = usePmSnapshot(editor, readFind, sameFind, IDLE)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const queryRef = useRef<HTMLInputElement | null>(null)
  const replacementRef = useRef<HTMLInputElement | null>(null)
  const wasOpen = useRef(false)

  const focusQueryInput = useCallback(() => {
    // 패널이 그려진 뒤에 잡아야 한다(열림 트랜잭션 → 리렌더 → DOM 존재).
    window.setTimeout(() => {
      queryRef.current?.focus()
      queryRef.current?.select()
    })
  }, [])

  // 다른 표면의 패널이 열려 있으면 닫는다(위 `openCloser` 주석 참조).
  useEffect(() => {
    const close = () => closeFind(editor)
    openCloser.set(editor, close)
    return () => {
      openCloser.delete(editor)
    }
  }, [editor])

  const closeOtherSurfaces = useCallback(() => {
    for (const [owner, close] of openCloser) if (owner !== editor) close()
  }, [editor])

  // ---------------------------------------------------------------- Ctrl+F 가로채기(범위 제한)
  //
  // 규약 E: **브라우저 기본 Ctrl+F를 영구히 뺏지 않는다.** 그래서 전역 리스너를 달되
  //   ① 편집 표면 안에서 난 Ctrl+F  ② 이 패널 안에서 난 Ctrl+F
  // 두 경우에만 가로채고, 그 밖(목록·제목 입력란·다른 표면)에서는 **아무것도 하지 않는다**
  // = 브라우저 찾기가 그대로 뜬다. `document` 캡처에 다는 이유는 마이크로 마크 래퍼
  // (`useMicroMarkShortcuts`)와 같다 — ProseMirror가 편집 표면 노드에 먼저 붙는다.
  useEffect(() => {
    if (!dom) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return
      if (event.key.toLowerCase() !== 'f') return
      const target = event.target
      if (!(target instanceof Node)) return
      const inEditor = dom.contains(target)
      const inPanel = panelRef.current?.contains(target) ?? false
      if (!inEditor && !inPanel) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      closeOtherSurfaces()
      // 선택 글자가 없으면(빈 문자열) **직전 검색어를 지우지 않는다** — 씨앗을 넘기지 않는다.
      const seed = inEditor ? selectedPlainText(editor) : ''
      openFind(editor, seed === '' ? undefined : seed)
      focusQueryInput()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [dom, editor, focusQueryInput, closeOtherSurfaces])

  // 편집 표면에서 Esc → 패널 닫기(패널 안의 Esc는 아래 `onKeyDown`이 받는다).
  useEffect(() => {
    if (!dom || !snapshot.open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (!(event.target instanceof Node) || !dom.contains(event.target)) return
      closeFind(editor)
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [dom, editor, snapshot.open])

  // 방금 열렸으면 검색어 칸으로 포커스를 옮긴다(단축키 경로 밖에서 열려도 동작하게).
  useEffect(() => {
    if (snapshot.open && !wasOpen.current) focusQueryInput()
    wasOpen.current = snapshot.open
  }, [snapshot.open, focusQueryInput])

  if (!snapshot.open) return null

  const dismiss = () => {
    closeFind(editor)
    editor.focus()
  }

  const onPanelKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // 패널 입력은 편집기 키맵과 무관해야 한다(툴바 입력란과 같은 관례).
    event.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      dismiss()
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      stepFind(editor, event.shiftKey ? -1 : 1)
    }
  }

  const counter =
    snapshot.query === ''
      ? ''
      : snapshot.total === 0
        ? '없음'
        : `${snapshot.activeIndex + 1} / ${snapshot.total}`

  const disabled = snapshot.total === 0

  return (
    <div
      ref={panelRef}
      onKeyDown={onPanelKeyDown}
      role="search"
      aria-label="이 편집 표면에서 찾기"
      className="editor2-find-panel flex flex-col gap-1 rounded-lg border border-border bg-surface-raised p-2 text-xs shadow"
    >
      <div className="flex items-center gap-1">
        <input
          ref={queryRef}
          value={snapshot.query}
          onChange={(e) => setFindQuery(editor, e.target.value, snapshot.caseSensitive)}
          placeholder="찾을 말"
          aria-label="찾을 말"
          className="w-40 rounded border border-border bg-surface px-1.5 py-0.5 text-primary placeholder:text-muted"
        />
        <span className="w-16 shrink-0 text-center text-muted">{counter}</span>
        <button
          type="button"
          onClick={() => stepFind(editor, -1)}
          disabled={disabled}
          title="이전 (Shift+Enter)"
          className="rounded border border-border px-1.5 py-0.5 text-primary hover:bg-bg disabled:cursor-not-allowed disabled:text-muted"
        >
          이전
        </button>
        <button
          type="button"
          onClick={() => stepFind(editor, 1)}
          disabled={disabled}
          title="다음 (Enter)"
          className="rounded border border-border px-1.5 py-0.5 text-primary hover:bg-bg disabled:cursor-not-allowed disabled:text-muted"
        >
          다음
        </button>
        <button
          type="button"
          onClick={dismiss}
          title="닫기 (Esc)"
          aria-label="찾기 닫기"
          className="rounded border border-border px-1.5 py-0.5 text-muted hover:bg-bg"
        >
          ✕
        </button>
      </div>

      <div className="flex items-center gap-1">
        <input
          ref={replacementRef}
          placeholder="바꿀 말"
          aria-label="바꿀 말"
          className="w-40 rounded border border-border bg-surface px-1.5 py-0.5 text-primary placeholder:text-muted"
        />
        <button
          type="button"
          onClick={() => replaceCurrent(editor, replacementRef.current?.value ?? '')}
          disabled={disabled}
          className="rounded border border-border px-1.5 py-0.5 text-primary hover:bg-bg disabled:cursor-not-allowed disabled:text-muted"
        >
          바꾸기
        </button>
        <button
          type="button"
          onClick={() => replaceAll(editor, replacementRef.current?.value ?? '')}
          disabled={disabled}
          className="rounded border border-border px-1.5 py-0.5 text-primary hover:bg-bg disabled:cursor-not-allowed disabled:text-muted"
        >
          모두 바꾸기
        </button>
        <label className="ml-auto flex items-center gap-1 text-muted">
          <input
            type="checkbox"
            checked={snapshot.caseSensitive}
            onChange={(e) => setFindQuery(editor, snapshot.query, e.target.checked)}
            aria-label="대소문자 구분"
          />
          Aa
        </label>
      </div>

      {/* 규약 E의 두 제약을 화면에 명시한다 — 조용한 기대 어긋남을 만들지 않는다. */}
      <p className="text-[11px] text-muted">
        이 표면 안에서만 찾습니다 · 참조 칩·수식 같은 요소 안의 글자는 제외
      </p>
    </div>
  )
}
