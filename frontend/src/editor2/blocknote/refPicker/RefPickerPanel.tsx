// 참조 피커 — **3종(문서 링크·앵커·문서 임베드) 공용 인라인 팝오버 1개** (stage-34 규약 A ①~③).
//
// 이 파일이 지키는 계약:
//   ① 대상은 목록에서만 고른다 — doc/embed는 검색·최근 문서, anchor는 현재 노트의 heading.
//      **자유 입력 target 경로가 없다**(규약 B).
//   ② 선택 텍스트는 절대 조용히 사라지지 않는다 — 도메인 통과분만 "라벨로 대체", 미통과분은
//      사유를 띄우고 **선택을 그대로 둔 채** 커서 삽입으로 내려간다(규약 A ②, 이 단계 DoD 4).
//   ③ 라벨을 비우면 추종형(대상 제목을 따라간다). 언제든 되돌릴 수 있다(규약 A ③).
//
// 색은 전부 토큰 유틸(Tailwind) — 색 리터럴 0(불변 규칙 5).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearch } from '../../../api/search'
import { safeSnippetHtml } from '../../../utils/snippet'
import { isSafeRefText, normalizeRefText, refTextRejection } from '../../schema/refDomain'
import { readRecentDocs, rememberRecentDoc } from '../../lib/recentDocs'
import AnchoredPanel from './AnchoredPanel'
import type { AnchorCandidate } from './headings'
import type { RefKind } from './RefTitleContext'

const SEARCH_DEBOUNCE_MS = 250
const PANEL_WIDTH = 340

/** 피커를 열 때 캡처하는 선택 스냅샷(열고 나면 편집기를 건드리지 않으므로 값이 변하지 않는다). */
export interface SelectionSnapshot {
  hasSelection: boolean
  /** 선택 안에 원자 인라인(칩·이미지·원문 보존·줄바꿈)이 있는가 — 있으면 라벨 후보로 쓰지 않는다. */
  hasAtom: boolean
  /** `normalizeRefText`를 통과시킨 선택 텍스트 */
  text: string
  safe: boolean
  rejection: string | null
}

export interface RefPickerRequest {
  mode: RefKind
  rect: DOMRect | null
  anchors: AnchorCandidate[]
  selection: SelectionSnapshot
  /**
   * 편집 모드(칩 팝오버 [대상 변경]) — 있으면 삽입 대신 이 콜백으로 **대상·라벨만** 바꾼다.
   * 이때 종류(mode) 전환 탭은 감춘다(칩 ↔ 임베드 블록은 서로 다른 노드다).
   */
  edit?: { currentLabel: string; apply: (target: string, label: string) => void }
}

interface DocOption {
  doc_no: string
  title: string
  id?: number | null
  snippet?: string
}

const MODE_LABEL: Record<RefKind, string> = {
  doc: '문서 링크',
  anchor: '앵커',
  embed: '문서 임베드',
}

const MODE_HINT: Record<RefKind, string> = {
  doc: '문서를 검색해 링크 칩을 넣습니다',
  anchor: '이 노트의 제목(heading) 중에서 고릅니다',
  embed: '문서 임베드 블록을 넣습니다',
}

function labelError(raw: string): string | null {
  const value = normalizeRefText(raw)
  if (value === '') return null // 빈 라벨 = 추종형(정상)
  return isSafeRefText(value) ? null : refTextRejection(value)
}

interface RefPickerPanelProps {
  request: RefPickerRequest
  onClose: () => void
  onPickDoc: (mode: RefKind, doc: DocOption, label: string, replaceSelection: boolean) => void
  onPickAnchor: (target: string, label: string, replaceSelection: boolean) => void
}

export default function RefPickerPanel({
  request,
  onClose,
  onPickDoc,
  onPickAnchor,
}: RefPickerPanelProps) {
  const { selection, edit } = request
  const [mode, setMode] = useState<RefKind>(request.mode)
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  // 선택 텍스트가 도메인을 통과했을 때만 "라벨로 쓰기"가 켜진 채 시작한다.
  const [useSelectionLabel, setUseSelectionLabel] = useState(selection.safe)
  const [label, setLabel] = useState(edit ? edit.currentLabel : selection.safe ? selection.text : '')
  const [rejectionDismissed, setRejectionDismissed] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [query])

  const recent = useMemo(() => readRecentDocs(), [])
  const search = useSearch(mode === 'anchor' ? '' : debounced)

  const options: DocOption[] = useMemo(() => {
    if (mode === 'anchor') return []
    if (debounced === '') return recent.map((item) => ({ ...item }))
    return (search.data?.items ?? []).map((item) => ({
      doc_no: item.doc_no,
      title: item.title,
      id: item.document_id,
      snippet: item.snippet,
    }))
  }, [debounced, mode, recent, search.data])

  const anchorOptions = useMemo(() => {
    if (mode !== 'anchor') return []
    const q = query.trim()
    return q === '' ? request.anchors : request.anchors.filter((item) => item.text.includes(q))
  }, [mode, query, request.anchors])

  const rowCount = mode === 'anchor' ? anchorOptions.length : options.length
  useEffect(() => {
    setActiveIndex(0)
  }, [mode, debounced, query])

  const currentLabelError = labelError(label)
  // 규약 A ② — 선택이 도메인을 통과하지 못했으면 사용자가 길을 정할 때까지 삽입을 막는다.
  // (유효한 라벨을 직접 입력해도 풀린다.)
  const blocked =
    !edit &&
    selection.hasSelection &&
    !selection.safe &&
    !rejectionDismissed &&
    normalizeRefText(label) === ''

  const replaceSelection = !edit && selection.safe && useSelectionLabel && mode !== 'embed'

  const commitDoc = useCallback(
    (doc: DocOption) => {
      if (blocked || currentLabelError) return
      const finalLabel = normalizeRefText(label)
      rememberRecentDoc({ doc_no: doc.doc_no, title: doc.title, id: doc.id })
      if (edit) {
        edit.apply(doc.doc_no, finalLabel)
        onClose()
        return
      }
      onPickDoc(mode, doc, finalLabel, replaceSelection)
      onClose()
    },
    [blocked, currentLabelError, edit, label, mode, onClose, onPickDoc, replaceSelection],
  )

  const commitAnchor = useCallback(
    (candidate: AnchorCandidate) => {
      if (!candidate.usable || blocked || currentLabelError) return
      const finalLabel = normalizeRefText(label)
      if (edit) {
        edit.apply(candidate.text, finalLabel)
        onClose()
        return
      }
      onPickAnchor(candidate.text, finalLabel, replaceSelection)
      onClose()
    },
    [blocked, currentLabelError, edit, label, onClose, onPickAnchor, replaceSelection],
  )

  const commitActive = useCallback(() => {
    if (mode === 'anchor') {
      const candidate = anchorOptions[activeIndex]
      if (candidate) commitAnchor(candidate)
      return
    }
    const doc = options[activeIndex]
    if (doc) commitDoc(doc)
  }, [activeIndex, anchorOptions, commitAnchor, commitDoc, mode, options])

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((i) => (rowCount === 0 ? 0 : (i + 1) % rowCount))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((i) => (rowCount === 0 ? 0 : (i - 1 + rowCount) % rowCount))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      commitActive()
    }
  }

  // 키보드 이동이 목록 밖으로 나가지 않게 스크롤을 따라 붙인다.
  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>('[data-active="true"]')
    node?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, rowCount])

  const listboxId = 'editor2-ref-picker-list'
  const activeId = rowCount > 0 ? `${listboxId}-${activeIndex}` : undefined

  return (
    <AnchoredPanel rect={request.rect} width={PANEL_WIDTH} onClose={onClose} label="참조 삽입">
      <div className="flex min-h-0 flex-col" onKeyDown={onKeyDown}>
        {!edit && (
          <div className="flex shrink-0 gap-1 border-b border-border p-2" role="tablist" aria-label="참조 종류">
            {(['doc', 'anchor', 'embed'] as RefKind[]).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={mode === value}
                onClick={() => setMode(value)}
                className={`flex-1 rounded border px-2 py-1 text-xs ${
                  mode === value
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-border text-muted hover:bg-bg'
                }`}
              >
                {MODE_LABEL[value]}
              </button>
            ))}
          </div>
        )}

        {/* 규약 A ② — 선택 텍스트의 처지를 항상 눈에 보이게 알린다. */}
        {!edit && selection.hasSelection && (
          <div className="shrink-0 border-b border-border px-2 py-2 text-xs">
            {selection.safe ? (
              <label className="flex items-start gap-2 text-primary">
                <input
                  type="checkbox"
                  checked={useSelectionLabel}
                  onChange={(e) => {
                    setUseSelectionLabel(e.target.checked)
                    setLabel(e.target.checked ? selection.text : '')
                  }}
                  className="mt-0.5"
                />
                <span>
                  선택한 텍스트를 라벨로 사용 — <b className="text-accent">{selection.text}</b>
                  <span className="mt-0.5 block text-muted">
                    {useSelectionLabel && mode !== 'embed'
                      ? '선택한 글자가 칩의 라벨이 됩니다(사라지지 않습니다).'
                      : '선택은 그대로 두고 커서 위치에 넣습니다.'}
                  </span>
                </span>
              </label>
            ) : (
              <div className="flex flex-col gap-1">
                <p className="text-wrong">
                  선택한 텍스트는 라벨로 쓸 수 없습니다 —{' '}
                  {selection.hasAtom
                    ? '선택에 참조 칩·이미지·수식 같은 요소가 들어 있습니다'
                    : (selection.rejection ?? '쓸 수 없는 문자가 들어 있습니다')}
                </p>
                <p className="text-muted">선택한 글자는 그대로 둡니다. 라벨을 직접 입력하거나 라벨 없이 넣으세요.</p>
                {!rejectionDismissed && (
                  <div className="flex gap-1 pt-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        setRejectionDismissed(true)
                        setLabel('')
                      }}
                      className="rounded border border-border px-2 py-0.5 text-primary hover:bg-bg"
                    >
                      라벨 없이 삽입
                    </button>
                    <button
                      type="button"
                      onClick={onClose}
                      className="rounded border border-border px-2 py-0.5 text-muted hover:bg-bg"
                    >
                      취소
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="shrink-0 border-b border-border px-2 py-2">
          <label className="block text-[11px] text-muted" htmlFor="editor2-ref-label">
            라벨 (비우면 대상 문서 제목을 따라갑니다)
          </label>
          <input
            id="editor2-ref-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="제목 추종"
            className="mt-1 w-full rounded border border-border bg-surface px-2 py-1 text-sm text-primary placeholder:text-muted"
          />
          <div className="mt-1 flex items-center justify-between gap-2">
            {currentLabelError ? (
              <span className="text-[11px] text-wrong">{currentLabelError}</span>
            ) : (
              <span className="text-[11px] text-muted">
                {normalizeRefText(label) === '' ? '제목 추종형으로 넣습니다' : '지정 라벨로 넣습니다'}
              </span>
            )}
            {normalizeRefText(label) !== '' && (
              <button
                type="button"
                onClick={() => {
                  setLabel('')
                  setUseSelectionLabel(false)
                }}
                className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted hover:bg-bg"
              >
                제목 추종으로 되돌리기
              </button>
            )}
          </div>
        </div>

        <div className="shrink-0 px-2 pt-2">
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded
            aria-controls={listboxId}
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={mode === 'anchor' ? '제목 거르기…' : '문서 검색 (제목·본문)'}
            className="w-full rounded border border-border bg-surface px-2 py-1 text-sm text-primary placeholder:text-muted"
          />
          <p className="pt-1 text-[11px] text-muted">{MODE_HINT[mode]}</p>
        </div>

        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label={MODE_LABEL[mode]}
          className={`min-h-0 flex-1 overflow-y-auto p-2 ${blocked ? 'pointer-events-none opacity-50' : ''}`}
        >
          {mode === 'anchor'
            ? anchorOptions.map((candidate, index) => (
                <li
                  key={candidate.text}
                  id={`${listboxId}-${index}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  aria-disabled={!candidate.usable}
                  data-active={index === activeIndex}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => commitAnchor(candidate)}
                  className={`cursor-pointer rounded px-2 py-1.5 text-sm ${
                    index === activeIndex ? 'bg-accent-soft' : ''
                  } ${candidate.usable ? 'text-primary' : 'cursor-not-allowed text-muted'}`}
                >
                  <span className="mr-1 text-[11px] text-muted">H{candidate.level}</span>
                  <span className={candidate.usable ? '' : 'line-through'}>{candidate.text}</span>
                  {!candidate.usable && candidate.reason && (
                    <span className="mt-0.5 block text-[11px] text-wrong">{candidate.reason}</span>
                  )}
                </li>
              ))
            : options.map((doc, index) => (
                <li
                  key={doc.doc_no}
                  id={`${listboxId}-${index}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  data-active={index === activeIndex}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => commitDoc(doc)}
                  className={`cursor-pointer rounded px-2 py-1.5 text-sm text-primary ${
                    index === activeIndex ? 'bg-accent-soft' : ''
                  }`}
                >
                  <span className="mr-1 text-[11px] text-muted">{doc.doc_no}</span>
                  <span>{doc.title}</span>
                  {doc.snippet && (
                    <span
                      className="mt-0.5 block text-[11px] text-muted"
                      // 백엔드가 <mark>만 남긴 스니펫 — 기존 XSS 차단 유틸을 그대로 쓴다(§4.9 관례).
                      dangerouslySetInnerHTML={{ __html: safeSnippetHtml(doc.snippet) }}
                    />
                  )}
                </li>
              ))}

          {rowCount === 0 && (
            <li className="px-2 py-3 text-center text-xs text-muted">
              {mode === 'anchor'
                ? '이 노트에 제목(heading) 블록이 없습니다'
                : debounced === ''
                  ? search.isFetching
                    ? '불러오는 중…'
                    : '최근 참조한 문서가 없습니다 — 검색해 보세요'
                  : search.isFetching
                    ? '검색 중…'
                    : '검색 결과가 없습니다'}
            </li>
          )}
        </ul>
      </div>
    </AnchoredPanel>
  )
}
