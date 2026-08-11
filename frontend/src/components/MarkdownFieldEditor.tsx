import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import MarkdownView from './MarkdownView'
import EditablePreview from './EditablePreview'
import type { BlockEditSurface } from './EditablePreview'
import RefInsertModal from './RefInsertModal'
import { useFontScale } from '../hooks/useFontScale'
import { PALETTE_COLORS, PALETTE_LABEL, TEXT_SIZES, TEXT_SIZE_LABEL } from './markdown/palette'
import type { PaletteColor, TextSize } from './markdown/palette'

// 공용 Markdown 편집 서브컴포넌트 (stage-26 9절 후속 보완, F52 ④) — 문서 본문·해설 양쪽에서
// 필드별 분기 없이 그대로 쓴다(9-4). 툴바(그룹화+툴팁, 9-3) · 뷰 모드 3종(9-2) · 접이식 문법
// 도움말(9-1) · 참조 삽입 · 선택 영역 래핑(토글 해제·중첩 방지 포함, 9-6ⓑ)을 한 곳에 둔다.
// 색상 하드코딩 0 — 토큰 클래스만.

type ViewMode = 'edit' | 'split' | 'preview'

// 10-4 — 마지막으로 고른 뷰 모드를 기억한다(모든 MarkdownFieldEditor 인스턴스가 공유하는 전역
// 선호값 — 필드별로 따로 두지 않는다. 지시서 예시 키 이름 그대로).
const VIEW_MODE_STORAGE_KEY = 'docEditor.viewMode'
const VIEW_MODE_VALUES: ViewMode[] = ['edit', 'split', 'preview']

function isViewMode(value: string | null): value is ViewMode {
  return value != null && (VIEW_MODE_VALUES as string[]).includes(value)
}

// 저장된 선택이 있으면 그대로, 없으면 넓은 화면(md, 768px)에서는 분할을 기본으로 한다(10-4 —
// 서식이 바로 실렌더로 보이게). window가 없는 환경(SSR 등은 이 앱에 없지만 방어적으로)은 'edit'.
function getInitialViewMode(): ViewMode {
  if (typeof window === 'undefined') return 'edit'
  try {
    const stored = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY)
    if (isViewMode(stored)) return stored
  } catch {
    // localStorage 접근 불가(사생활 보호 모드 등) — 쓰기 경로(setViewMode)와 대칭으로 읽기도
    // 가드한다. 마운트 자체가 크래시하면 안 되므로 기본값 산정으로 안전하게 진행.
  }
  return window.matchMedia('(min-width: 768px)').matches ? 'split' : 'edit'
}

interface HelpItem {
  code: string
  name: string
}
interface HelpGroup {
  title: string
  items: HelpItem[]
}

const HELP_GROUPS: HelpGroup[] = [
  {
    title: '참조·임베드',
    items: [
      { code: '![[DOC-0012]]', name: '임베드 — 카드로 펼침' },
      { code: '[[DOC-0012]]', name: '링크 칩 — 문서 이동' },
      { code: '[[#절 제목]]', name: '앵커 — 같은 문서 안 이동' },
    ],
  },
  {
    title: '구간 블록',
    items: [
      { code: ':::fold[제목] … :::', name: '접기(기본 접힘)' },
      { code: ':::hide[제목] … :::', name: '가리기(탭하면 공개)' },
    ],
  },
  {
    title: '인라인 꾸미기',
    items: [
      { code: '++밑줄++', name: '밑줄' },
      { code: '==형광펜==', name: '형광펜(기본 노랑)' },
      { code: '||스포일러||', name: '가려 두기(탭하면 공개)' },
      { code: ':t[텍스트]{c=red bg=yellow s=large}', name: '글자색·형광펜·크기' },
    ],
  },
  {
    title: '콜아웃',
    items: [
      { code: ':::note[제목] … :::', name: '참고' },
      { code: ':::warn[제목] … :::', name: '주의' },
      { code: ':::tip[제목] … :::', name: '팁' },
    ],
  },
]

const TOOLBAR_BTN = 'rounded px-2 py-1 text-xs text-primary hover:bg-surface'
const SELECT_CLASS =
  'rounded border border-border bg-surface px-1 py-1 text-xs text-primary outline-none focus:border-accent'
const DIVIDER = <span className="mx-1 h-4 w-px bg-border" aria-hidden />

// 활성 편집 표면(S27 3-2) — 툴바·단축키·참조 삽입이 "지금 편집 중인 textarea"를 모드와 무관하게
// 같은 방식으로 다루기 위한 최소 인터페이스.
interface EditSurface {
  el: HTMLTextAreaElement | null
  text: string
  setText: (next: string) => void
}

interface MarkdownFieldEditorProps {
  id: string
  label: string
  value: string
  onChange: (next: string) => void
  rows?: number
  // 10-2 — textarea·미리보기 최소 높이(Tailwind 클래스). 기본은 기존 크기 그대로 유지하고,
  // 본문처럼 넓게 쓸 필드만 호출부에서 크게 넘긴다(필드별 분기가 아니라 파라미터화 — rows prop과
  // 같은 패턴).
  minHeightClass?: string
  // 임베드 순환 검출 시작점(F43) — 편집 중인 문서 자신의 doc_no(있으면). 새 문서는 아직 없다.
  docNo?: string | null
  // 참조 삽입 팝업이 열려 있는 동안 바깥(모달) Esc·배경 클릭이 편집기 전체를 닫지 않도록 부모에
  // 알린다(여러 필드 인스턴스가 동시에 있을 수 있어 부모가 종합 판단).
  onRefModalOpenChange?: (open: boolean) => void
}

export default function MarkdownFieldEditor({
  id,
  label,
  value,
  onChange,
  rows = 8,
  minHeightClass = '',
  docNo,
  onRefModalOpenChange,
}: MarkdownFieldEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // 편집기 크롬 전체(툴바·뷰 모드·참조 삽입 팝업 포함) — 편집 가능 미리보기(S27)가 "이 밖으로
  // 나가는 클릭 = 확정 / 안에서의 조작 = 블록 유지"를 판정하는 기준.
  const rootRef = useRef<HTMLDivElement>(null)
  // 미리보기 모드의 활성 블록 편집 표면(없으면 null) — 툴바·단축키·참조 삽입의 대상(3-2).
  const blockSurfaceRef = useRef<BlockEditSurface | null>(null)
  const registerBlockSurface = useCallback((surface: BlockEditSurface | null) => {
    blockSurfaceRef.current = surface
  }, [])
  const keepEditingRef = useRef(false)
  const [viewMode, setViewModeState] = useState<ViewMode>(getInitialViewMode)
  function setViewMode(mode: ViewMode) {
    // 미리보기를 떠나기 전에 활성 초안을 확정한다(모드 전환으로 초안이 사라지지 않게).
    if (viewMode === 'preview' && mode !== 'preview') blockSurfaceRef.current?.commit()
    setViewModeState(mode)
    try {
      window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode)
    } catch {
      // localStorage 접근 불가(사생활 보호 모드 등) — 세션 안에서만 기억, 크래시는 없어야 한다.
    }
  }
  // 뷰 모드가 분할일 때만 의미 있는 좁은 화면 보조 탭(9-2 "좁은 화면 탭 전환과 일관").
  const [mobileSubTab, setMobileSubTab] = useState<'edit' | 'preview'>('edit')
  const [helpOpen, setHelpOpen] = useState(false)
  const [refInsertOpen, setRefInsertOpen] = useState(false)
  const scale = useFontScale()

  // 치명-1 수정: 부모(DocEditor)가 매 렌더 새 identity의 콜백을 넘겨도(메모 없이) 이 이펙트가
  // 다시 돌지 않도록 콜백은 ref로만 참조하고, 의존성 배열엔 refInsertOpen만 둔다 — 그래야 실제로
  // 열림/닫힘이 바뀔 때만 부모에 알린다(콜백 identity 변화 자체는 알림 트리거가 아니다).
  const onRefModalOpenChangeRef = useRef(onRefModalOpenChange)
  useEffect(() => {
    onRefModalOpenChangeRef.current = onRefModalOpenChange
  })
  useEffect(() => {
    onRefModalOpenChangeRef.current?.(refInsertOpen)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refInsertOpen])

  // 참조 삽입 팝업이 열려 있는 동안에는 미리보기의 활성 블록이 blur로 확정되지 않게 잠근다(2-4).
  keepEditingRef.current = refInsertOpen

  // 라이브 미리보기 디바운스(9-6ⓐ) — 타이핑마다 MarkdownView를 다시 그려 임베드 API를 즉시 호출하지
  // 않는다.
  const [debouncedValue, setDebouncedValue] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), 300)
    return () => clearTimeout(timer)
  }, [value])

  // 경미-2 수정: 래핑 가드(중첩·부분 겹침)가 조용히 무시하던 것을 짧은 안내 문구로 알린다.
  const [wrapNotice, setWrapNotice] = useState<string | null>(null)
  const wrapNoticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(wrapNoticeTimer.current), [])
  function flashWrapNotice(message: string) {
    setWrapNotice(message)
    clearTimeout(wrapNoticeTimer.current)
    wrapNoticeTimer.current = setTimeout(() => setWrapNotice(null), 1800)
  }

  // 활성 편집 표면(3-2) — (편집·분할) 본문 textarea | (미리보기) 활성 블록 textarea.
  // 툴바·단축키·참조 삽입은 전부 이 하나를 통해서만 값을 읽고 쓴다(모드별 분기 금지).
  function getSurface(): EditSurface | null {
    if (viewMode === 'preview') {
      const block = blockSurfaceRef.current
      if (!block) return null
      return { el: block.getEl(), text: block.getText(), setText: block.setText }
    }
    return { el: textareaRef.current, text: value, setText: onChange }
  }

  function requireSurface(): EditSurface | null {
    const surface = getSurface()
    if (!surface) {
      flashWrapNotice('편집할 블록을 먼저 클릭하세요')
      return null
    }
    return surface
  }

  // 툴바 버튼은 포커스를 가져가지 않는다 — 미리보기 모드에서 blur 확정으로 블록이 닫히는 것을
  // 막고(2-4), 편집·분할 모드에서도 본문 textarea의 선택 영역이 그대로 유지된다.
  function keepFocus(e: ReactMouseEvent) {
    e.preventDefault()
  }

  // 경미(§10 잔여) 5 — 툴바 조작이 값을 통째로 교체(onChange(전체 문자열))하면 브라우저 네이티브
  // undo 스택이 끊긴다(Ctrl+Z 무반응). 실측(headless Chrome, CDP): `textarea.setRangeText()` +
  // 수동 input 이벤트 dispatch는 React 상태 반영은 정상이지만 **Ctrl+Z가 전혀 먹지 않았다**
  // (setRangeText는 스펙상 자동으로 신뢰된 input 이벤트를 큐잉하긴 하지만, 그 자동 이벤트조차
  // React onChange를 제대로 못 태웠고 — 그래서 여기 있던 수동 dispatch가 필요했다 — 브라우저의
  // 실제 편집 명령/undo 스택에는 애초에 들어가지 않았다). 반면 `document.execCommand('insertText',
  // false, replacement)`(선택 영역을 먼저 지정한 뒤 호출 — 선택 구간을 지우고 그 자리에 넣는
  // 실제 "타이핑처럼 보이는" 편집 명령)는 같은 조건에서 Ctrl+Z가 정확히 그 구간만 되돌리는 것과
  // React 상태 반영(추가 수동 dispatch 없이도) 둘 다 실측으로 확인됐다 — deprecated API지만
  // 모든 주요 브라우저가 여전히 지원하고(제거 계획 없음), 정확히 이 용도(undo 보존 프로그램적
  // 편집)로 널리 쓰인다. 모든 툴바 경로(wrapSelection·applyLineTransform·insertAtCursor)가
  // 이 함수 하나로 수렴한다.
  //
  // selection은 대체 후 값 기준 절대 오프셋(없으면 execCommand 기본 동작인 "삽입 뒤 커서 collapse"
  // 에 맡긴다 — insertAtCursor가 정확히 이 기본 동작을 원한다).
  function applyRangeEdit(
    surface: EditSurface,
    start: number,
    end: number,
    replacement: string,
    selection?: { start: number; end: number },
  ) {
    const el = surface.el
    if (!el || typeof document.execCommand !== 'function') {
      // textarea가 DOM에 없거나 execCommand 미지원 환경 — undo 스택은 못 지키지만 기능 자체는
      // 그대로 동작해야 한다(안전한 폴백).
      surface.setText(`${surface.text.slice(0, start)}${replacement}${surface.text.slice(end)}`)
      return
    }
    el.focus()
    el.setSelectionRange(start, end)
    document.execCommand('insertText', false, replacement)
    if (selection) {
      requestAnimationFrame(() => {
        el.setSelectionRange(selection.start, selection.end)
      })
    }
  }

  function insertAtCursor(snippet: string) {
    const surface = requireSurface()
    if (!surface) return
    const el = surface.el
    const start = el?.selectionStart ?? surface.text.length
    const end = el?.selectionEnd ?? surface.text.length
    const caret = start + snippet.length
    applyRangeEdit(surface, start, end, snippet, { start: caret, end: caret })
  }

  // 선택 영역 래핑(F52 ④, 9-6ⓑ) — 세 갈래:
  // ① 선택이 정확히 before…after로 감싸져 있으면 벗긴다(토글 해제).
  // ② 선택 안쪽에 같은 기호가 이미 있으면(중첩) 래핑도 벗기기도 하지 않는다 — 구조가 깨지는 것을
  //    막는 안전 처리(무시).
  // ③ 그 외에는 기존처럼 감싼다(선택이 없으면 자리표시자를 넣고 선택 상태로 남긴다).
  function wrapSelection(before: string, after: string, placeholder: string) {
    const surface = requireSurface()
    if (!surface) return
    const el = surface.el
    const text = surface.text
    const start = el?.selectionStart ?? text.length
    const end = el?.selectionEnd ?? text.length
    const hasSelection = end > start

    if (hasSelection) {
      const selected = text.slice(start, end)
      const exactlyWrapped =
        before.length > 0 &&
        selected.length >= before.length + after.length &&
        selected.startsWith(before) &&
        selected.endsWith(after)

      if (exactlyWrapped) {
        const inner = selected.slice(before.length, selected.length - after.length)
        const innerHasMarker = inner.includes(before) || (after !== before && inner.includes(after))
        if (innerHasMarker) {
          // 중첩 — 안전하게 아무 것도 하지 않는다(대신 왜 안 됐는지 짧게 안내).
          flashWrapNotice('선택 영역에 같은 기호가 있어 적용할 수 없습니다')
          return
        }
        applyRangeEdit(surface, start, end, inner, { start, end: start + inner.length })
        return
      }

      // 부분적으로만 겹치는 경우(중첩 재래핑) — 잘못된 위치에 감싸 문법이 깨지는 것을 막는다.
      const overlapsMarker = selected.includes(before) || (after !== before && selected.includes(after))
      if (overlapsMarker) {
        flashWrapNotice('선택 영역에 같은 기호가 있어 적용할 수 없습니다')
        return
      }
    }

    const selected = hasSelection ? text.slice(start, end) : placeholder
    const inserted = `${before}${selected}${after}`
    const selStart = start + before.length
    const selEnd = selStart + selected.length
    applyRangeEdit(surface, start, end, inserted, { start: selStart, end: selEnd })
  }

  function wrapDirective(attr: string, placeholder: string) {
    wrapSelection(':t[', `]{${attr}}`, placeholder)
  }

  function insertCallout(kind: 'note' | 'warn' | 'tip') {
    wrapSelection(`:::${kind}[제목]\n`, '\n:::', '내용')
  }

  // 목록·들여쓰기(10-3) — 파싱·렌더 변경 0(GFM이 이미 처리) — 선택된 줄 범위의 각 줄 앞에
  // prefix를 토글(이미 있으면 제거)하는 삽입 도우미만 추가한다.
  function applyLineTransform(transform: (lines: string[]) => string[]) {
    const surface = requireSurface()
    if (!surface) return
    const el = surface.el
    const text = surface.text
    const start = el?.selectionStart ?? text.length
    const end = el?.selectionEnd ?? text.length
    const lineStart = text.lastIndexOf('\n', start - 1) + 1
    const nextNewline = text.indexOf('\n', end)
    const lineEnd = nextNewline === -1 ? text.length : nextNewline
    const segment = text.slice(lineStart, lineEnd)
    const nextSegment = transform(segment.split('\n')).join('\n')
    applyRangeEdit(surface, lineStart, lineEnd, nextSegment, { start: lineStart, end: lineStart + nextSegment.length })
  }

  // 공백만 있는 줄은 건드리지 않는다. "전부 있으면 전부 제거(토글 해제), 아니면 없는 줄만 부여"
  // 규칙(§10 잔여 경미-3 — 부분 적용 시 이미 접두가 있는 줄에 이중으로 덧붙이지 않는다).
  function toggleLinePrefix(
    lines: string[],
    test: (line: string) => boolean,
    add: (line: string) => string,
    remove: (line: string) => string,
  ) {
    const meaningful = lines.filter((l) => l.trim() !== '')
    const allPrefixed = meaningful.length > 0 && meaningful.every(test)
    if (allPrefixed) return lines.map((l) => (test(l) ? remove(l) : l))
    // 부분 적용 — 접두가 없는(그리고 공백만이 아닌) 줄에만 추가한다. 이미 있는 줄은 그대로 둬
    // "- - x" 같은 이중 접두를 만들지 않는다.
    return lines.map((l) => (l.trim() === '' || test(l) ? l : add(l)))
  }

  function toggleBulletList() {
    applyLineTransform((lines) =>
      toggleLinePrefix(
        lines,
        (l) => l.startsWith('- '),
        (l) => `- ${l}`,
        (l) => l.slice(2),
      ),
    )
  }

  function toggleNumberedList() {
    applyLineTransform((lines) => {
      const meaningful = lines.filter((l) => l.trim() !== '')
      const allNumbered = meaningful.length > 0 && meaningful.every((l) => /^\d+\.\s/.test(l))
      if (allNumbered) return lines.map((l) => l.replace(/^\d+\.\s/, ''))
      // 부분 적용 — 번호가 없는 줄만 새로 매기되, 이미 번호가 있는 줄도 포함해 전체를 순서대로
      // 다시 매긴다(이중 접두 방지 + 지시서 "없는 줄만 부여 후 전체 번호 재정렬"). 이미 번호가
      // 있던 줄은 그 번호를 떼고 새 순번으로 교체한다(원문 앞에 또 붙이지 않는다).
      let n = 1
      return lines.map((l) => {
        if (l.trim() === '') return l
        const stripped = l.replace(/^\d+\.\s/, '')
        return `${n++}. ${stripped}`
      })
    })
  }

  function indentLines() {
    // 경미(§10 잔여) 4 — 공백만 있는 줄의 판정 기준을 다른 헬퍼(toggleLinePrefix·
    // toggleNumberedList)와 같은 trim() === ''로 통일.
    applyLineTransform((lines) => lines.map((l) => (l.trim() === '' ? l : `  ${l}`)))
  }

  function outdentLines() {
    applyLineTransform((lines) =>
      lines.map((l) => {
        if (l.startsWith('  ')) return l.slice(2)
        if (l.startsWith('\t') || l.startsWith(' ')) return l.slice(1)
        return l
      }),
    )
  }

  // 단축키 4종만(과설계 금지). textarea 포커스 시 preventDefault.
  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (!e.ctrlKey) return
    const key = e.key.toLowerCase()
    if (!e.shiftKey && key === 'b') {
      e.preventDefault()
      wrapSelection('**', '**', '굵게')
    } else if (!e.shiftKey && key === 'i') {
      e.preventDefault()
      wrapSelection('*', '*', '기울임')
    } else if (!e.shiftKey && key === 'u') {
      e.preventDefault()
      wrapSelection('++', '++', '밑줄')
    } else if (e.shiftKey && key === 'h') {
      e.preventDefault()
      wrapSelection('==', '==', '형광펜')
    }
  }

  const showTextarea = viewMode !== 'preview'
  const showPreview = viewMode !== 'edit'
  const splitting = viewMode === 'split'

  return (
    <div ref={rootRef} className="flex flex-col gap-1 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm text-primary">
          {label}
        </label>
        <div className="flex flex-wrap items-center gap-2">
          {/* 뷰 모드 3종(9-2) — 원본(Markdown 소스) 표시·숨김을 이 토글로 통제. */}
          <div className="flex gap-0.5 rounded border border-border p-0.5" role="group" aria-label="보기 모드">
            {(
              [
                { value: 'edit', label: '편집' },
                { value: 'split', label: '분할' },
                { value: 'preview', label: '미리보기' },
              ] as { value: ViewMode; label: string }[]
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onMouseDown={keepFocus}
                onClick={() => setViewMode(opt.value)}
                className={`rounded px-2 py-0.5 text-xs ${
                  viewMode === opt.value ? 'bg-accent-soft text-accent' : 'text-primary hover:bg-bg'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onMouseDown={keepFocus}
            onClick={() => setRefInsertOpen(true)}
            className="rounded border border-border px-2 py-1 text-xs text-primary hover:bg-bg"
          >
            ＋ 참조 삽입
          </button>
        </div>
      </div>

      {/* 툴바 — 서식 / 색·크기 / 삽입 3그룹(9-3) + 툴팁(title). 선택 영역 래핑(F52 ④). */}
      <div className="flex flex-wrap items-center gap-1 rounded border border-border bg-bg p-1">
        <div className="flex items-center gap-0.5" role="group" aria-label="서식">
          <button type="button" onMouseDown={keepFocus} title="굵게 (Ctrl+B)" onClick={() => wrapSelection('**', '**', '굵게')} className={`${TOOLBAR_BTN} font-bold`}>
            B
          </button>
          <button type="button" onMouseDown={keepFocus} title="기울임 (Ctrl+I)" onClick={() => wrapSelection('*', '*', '기울임')} className={`${TOOLBAR_BTN} italic`}>
            I
          </button>
          <button type="button" onMouseDown={keepFocus} title="취소선" onClick={() => wrapSelection('~~', '~~', '취소선')} className={`${TOOLBAR_BTN} line-through`}>
            S
          </button>
          <button type="button" onMouseDown={keepFocus} title="밑줄 (Ctrl+U)" onClick={() => wrapSelection('++', '++', '밑줄')} className={`${TOOLBAR_BTN} underline`}>
            U
          </button>
        </div>

        {DIVIDER}

        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="색·크기">
          <button
            type="button"
            onMouseDown={keepFocus}
            title="형광펜(기본 노랑, Ctrl+Shift+H)"
            onClick={() => wrapSelection('==', '==', '형광펜')}
            className="rounded bg-mark-yellow px-2 py-1 text-xs text-primary hover:opacity-80"
          >
            형광펜
          </button>
          <select
            aria-label="형광펜 색상"
            title="형광펜 색상 선택"
            defaultValue=""
            onChange={(e) => {
              const color = e.target.value as PaletteColor | ''
              if (color) wrapDirective(`bg=${color}`, '형광펜')
              e.target.value = ''
            }}
            className={SELECT_CLASS}
          >
            <option value="" disabled>
              형광펜 색…
            </option>
            {PALETTE_COLORS.map((c) => (
              <option key={c} value={c}>
                {PALETTE_LABEL[c]}
              </option>
            ))}
          </select>
          <select
            aria-label="글자색"
            title="글자색 선택"
            defaultValue=""
            onChange={(e) => {
              const color = e.target.value as PaletteColor | ''
              if (color) wrapDirective(`c=${color}`, '글자색')
              e.target.value = ''
            }}
            className={SELECT_CLASS}
          >
            <option value="" disabled>
              글자색…
            </option>
            {PALETTE_COLORS.map((c) => (
              <option key={c} value={c}>
                {PALETTE_LABEL[c]}
              </option>
            ))}
          </select>
          <select
            aria-label="글자 크기"
            title="글자 크기 선택"
            defaultValue=""
            onChange={(e) => {
              const size = e.target.value as TextSize | ''
              if (size) wrapDirective(`s=${size}`, '크기')
              e.target.value = ''
            }}
            className={SELECT_CLASS}
          >
            <option value="" disabled>
              크기…
            </option>
            {TEXT_SIZES.map((s) => (
              <option key={s} value={s}>
                {TEXT_SIZE_LABEL[s]}
              </option>
            ))}
          </select>
        </div>

        {DIVIDER}

        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="삽입">
          <button type="button" onMouseDown={keepFocus} title="인라인 스포일러" onClick={() => wrapSelection('||', '||', '스포일러')} className={TOOLBAR_BTN}>
            스포일러
          </button>
          <button type="button" onMouseDown={keepFocus} title="콜아웃 — 참고" onClick={() => insertCallout('note')} className={`${TOOLBAR_BTN} text-accent`}>
            참고
          </button>
          <button type="button" onMouseDown={keepFocus} title="콜아웃 — 주의" onClick={() => insertCallout('warn')} className={`${TOOLBAR_BTN} text-warning`}>
            주의
          </button>
          <button type="button" onMouseDown={keepFocus} title="콜아웃 — 팁" onClick={() => insertCallout('tip')} className={`${TOOLBAR_BTN} text-correct`}>
            팁
          </button>
          {DIVIDER}
          <button type="button" onMouseDown={keepFocus} title="글머리 기호 목록" onClick={toggleBulletList} className={TOOLBAR_BTN}>
            •목록
          </button>
          <button type="button" onMouseDown={keepFocus} title="번호 매기기 목록" onClick={toggleNumberedList} className={TOOLBAR_BTN}>
            1.목록
          </button>
          <button type="button" onMouseDown={keepFocus} title="들여쓰기" onClick={indentLines} className={TOOLBAR_BTN}>
            들여쓰기
          </button>
          <button type="button" onMouseDown={keepFocus} title="내어쓰기" onClick={outdentLines} className={TOOLBAR_BTN}>
            내어쓰기
          </button>
        </div>
      </div>
      {wrapNotice && (
        <p role="status" className="text-xs text-warning">
          {wrapNotice}
        </p>
      )}

      {/* 분할 모드의 좁은 화면 보조 탭 — 원본/미리보기 중 하나만 보인다(9-2). */}
      {splitting && (
        <div className="flex gap-1 md:hidden">
          <button
            type="button"
            onClick={() => setMobileSubTab('edit')}
            className={`rounded border px-2 py-1 text-xs ${
              mobileSubTab === 'edit' ? 'border-accent bg-accent-soft text-accent' : 'border-border text-primary hover:bg-bg'
            }`}
          >
            원본
          </button>
          <button
            type="button"
            onClick={() => setMobileSubTab('preview')}
            className={`rounded border px-2 py-1 text-xs ${
              mobileSubTab === 'preview' ? 'border-accent bg-accent-soft text-accent' : 'border-border text-primary hover:bg-bg'
            }`}
          >
            미리보기
          </button>
        </div>
      )}

      <div className={splitting ? 'grid gap-2 md:grid-cols-2' : ''}>
        {showTextarea && (
          <textarea
            id={id}
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={rows}
            className={`rounded border border-border bg-surface px-3 py-2 text-sm text-primary outline-none focus:border-accent ${minHeightClass} ${
              splitting && mobileSubTab === 'preview' ? 'hidden md:block' : ''
            }`}
          />
        )}
        {showPreview &&
          (viewMode === 'preview' ? (
            // 미리보기 모드 = **편집 가능**(S27) — 블록 클릭으로 그 자리에서 소스 편집.
            // 분할 모드의 미리보기 패널은 아래 읽기 전용 경로 그대로다(편집 표면 2개 금지).
            <EditablePreview
              value={value}
              onChange={onChange}
              docNo={docNo}
              scale={scale}
              containerClassName={`overflow-y-auto rounded border border-border bg-surface px-3 py-2 ${
                minHeightClass ? `${minHeightClass} max-h-[70vh]` : 'max-h-64'
              }`}
              chromeRef={rootRef}
              keepEditingRef={keepEditingRef}
              registerSurface={registerBlockSurface}
              onFormatKeyDown={handleKeyDown}
            />
          ) : (
            <div
              className={`overflow-y-auto rounded border border-border bg-surface px-3 py-2 ${
                minHeightClass ? `${minHeightClass} max-h-[70vh]` : 'max-h-64'
              } ${splitting && mobileSubTab === 'edit' ? 'hidden md:block' : ''}`}
            >
              <MarkdownView content={debouncedValue || '_미리볼 내용이 없습니다._'} docNo={docNo} scale={scale} />
            </div>
          ))}
      </div>

      {/* 문법 도움말(9-1) — 기본 접힘, 카테고리 그룹 + 코드 칩. */}
      <div className="rounded border border-border">
        <button
          type="button"
          onClick={() => setHelpOpen((v) => !v)}
          aria-expanded={helpOpen}
          className="flex w-full items-center justify-between px-2 py-1.5 text-xs font-medium text-primary hover:bg-bg"
        >
          <span>문법 도움말</span>
          <span aria-hidden>{helpOpen ? '▾' : '▸'}</span>
        </button>
        {helpOpen && (
          <div className="grid gap-3 border-t border-border p-2 sm:grid-cols-2">
            {HELP_GROUPS.map((g) => (
              <div key={g.title}>
                <p className="mb-1 text-[11px] font-semibold text-muted">{g.title}</p>
                <ul className="flex flex-col gap-1">
                  {g.items.map((it) => (
                    <li key={it.code} className="flex flex-wrap items-baseline gap-1.5 text-xs">
                      <code className="rounded bg-bg px-1 py-0.5 text-[11px] text-primary">{it.code}</code>
                      <span className="text-muted">{it.name}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      {refInsertOpen && <RefInsertModal onInsert={insertAtCursor} onClose={() => setRefInsertOpen(false)} />}
    </div>
  )
}
