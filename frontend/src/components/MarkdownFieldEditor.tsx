import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import MarkdownView from './MarkdownView'
import RefInsertModal from './RefInsertModal'
import { useFontScale } from '../hooks/useFontScale'
import { PALETTE_COLORS, PALETTE_LABEL, TEXT_SIZES, TEXT_SIZE_LABEL } from './markdown/palette'
import type { PaletteColor, TextSize } from './markdown/palette'

// 공용 Markdown 편집 서브컴포넌트 (stage-26 9절 후속 보완, F52 ④) — 문서 본문·해설 양쪽에서
// 필드별 분기 없이 그대로 쓴다(9-4). 툴바(그룹화+툴팁, 9-3) · 뷰 모드 3종(9-2) · 접이식 문법
// 도움말(9-1) · 참조 삽입 · 선택 영역 래핑(토글 해제·중첩 방지 포함, 9-6ⓑ)을 한 곳에 둔다.
// 색상 하드코딩 0 — 토큰 클래스만.

type ViewMode = 'edit' | 'split' | 'preview'

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

interface MarkdownFieldEditorProps {
  id: string
  label: string
  value: string
  onChange: (next: string) => void
  rows?: number
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
  docNo,
  onRefModalOpenChange,
}: MarkdownFieldEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('edit')
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

  function insertAtCursor(snippet: string) {
    const el = textareaRef.current
    const start = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? value.length
    const next = `${value.slice(0, start)}${snippet}${value.slice(end)}`
    onChange(next)
    requestAnimationFrame(() => {
      if (!el) return
      el.focus()
      const caret = start + snippet.length
      el.setSelectionRange(caret, caret)
    })
  }

  // 선택 영역 래핑(F52 ④, 9-6ⓑ) — 세 갈래:
  // ① 선택이 정확히 before…after로 감싸져 있으면 벗긴다(토글 해제).
  // ② 선택 안쪽에 같은 기호가 이미 있으면(중첩) 래핑도 벗기기도 하지 않는다 — 구조가 깨지는 것을
  //    막는 안전 처리(무시).
  // ③ 그 외에는 기존처럼 감싼다(선택이 없으면 자리표시자를 넣고 선택 상태로 남긴다).
  function wrapSelection(before: string, after: string, placeholder: string) {
    const el = textareaRef.current
    const start = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? value.length
    const hasSelection = end > start

    if (hasSelection) {
      const selected = value.slice(start, end)
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
        const next = `${value.slice(0, start)}${inner}${value.slice(end)}`
        onChange(next)
        requestAnimationFrame(() => {
          if (!el) return
          el.focus()
          el.setSelectionRange(start, start + inner.length)
        })
        return
      }

      // 부분적으로만 겹치는 경우(중첩 재래핑) — 잘못된 위치에 감싸 문법이 깨지는 것을 막는다.
      const overlapsMarker = selected.includes(before) || (after !== before && selected.includes(after))
      if (overlapsMarker) {
        flashWrapNotice('선택 영역에 같은 기호가 있어 적용할 수 없습니다')
        return
      }
    }

    const selected = hasSelection ? value.slice(start, end) : placeholder
    const inserted = `${before}${selected}${after}`
    const next = `${value.slice(0, start)}${inserted}${value.slice(end)}`
    onChange(next)
    requestAnimationFrame(() => {
      if (!el) return
      el.focus()
      const selStart = start + before.length
      const selEnd = selStart + selected.length
      el.setSelectionRange(selStart, selEnd)
    })
  }

  function wrapDirective(attr: string, placeholder: string) {
    wrapSelection(':t[', `]{${attr}}`, placeholder)
  }

  function insertCallout(kind: 'note' | 'warn' | 'tip') {
    wrapSelection(`:::${kind}[제목]\n`, '\n:::', '내용')
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
    <div className="flex flex-col gap-1 text-sm">
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
          <button type="button" title="굵게 (Ctrl+B)" onClick={() => wrapSelection('**', '**', '굵게')} className={`${TOOLBAR_BTN} font-bold`}>
            B
          </button>
          <button type="button" title="기울임 (Ctrl+I)" onClick={() => wrapSelection('*', '*', '기울임')} className={`${TOOLBAR_BTN} italic`}>
            I
          </button>
          <button type="button" title="취소선" onClick={() => wrapSelection('~~', '~~', '취소선')} className={`${TOOLBAR_BTN} line-through`}>
            S
          </button>
          <button type="button" title="밑줄 (Ctrl+U)" onClick={() => wrapSelection('++', '++', '밑줄')} className={`${TOOLBAR_BTN} underline`}>
            U
          </button>
        </div>

        {DIVIDER}

        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="색·크기">
          <button
            type="button"
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
          <button type="button" title="인라인 스포일러" onClick={() => wrapSelection('||', '||', '스포일러')} className={TOOLBAR_BTN}>
            스포일러
          </button>
          <button type="button" title="콜아웃 — 참고" onClick={() => insertCallout('note')} className={`${TOOLBAR_BTN} text-accent`}>
            참고
          </button>
          <button type="button" title="콜아웃 — 주의" onClick={() => insertCallout('warn')} className={`${TOOLBAR_BTN} text-warning`}>
            주의
          </button>
          <button type="button" title="콜아웃 — 팁" onClick={() => insertCallout('tip')} className={`${TOOLBAR_BTN} text-correct`}>
            팁
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
            className={`rounded border border-border bg-surface px-3 py-2 text-sm text-primary outline-none focus:border-accent ${
              splitting && mobileSubTab === 'preview' ? 'hidden md:block' : ''
            }`}
          />
        )}
        {showPreview && (
          <div
            className={`max-h-64 overflow-y-auto rounded border border-border bg-surface px-3 py-2 ${
              splitting && mobileSubTab === 'edit' ? 'hidden md:block' : ''
            }`}
          >
            <MarkdownView content={debouncedValue || '_미리볼 내용이 없습니다._'} docNo={docNo} scale={scale} />
          </div>
        )}
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
