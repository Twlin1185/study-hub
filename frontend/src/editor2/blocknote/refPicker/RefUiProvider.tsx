// 참조 UI 공급자 — 제목 추종 캐시 · 피커 · 칩 팝오버를 **한 곳에서** 쥔다(stage-34 규약 A ③).
//
// **N+1 금지**: 칩은 `requestTitle()`로 등록만 하고, 여기서 한 프레임(30ms) 모아
// `resolveEmbeds` **배치 1회**로 해석한다(설계 §4.19 ③ 계약). 캐시는 `Map` 하나이고
// **편집 세션 동안만** 산다 — 전역 영속 캐시를 만들지 않는다(§4.19 명시).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { resolveEmbeds, type EmbedResolveItem } from '../../../api/embeds'
import { isDocNo, isSafeRefText, normalizeRefText, refTextRejection } from '../../schema/refDomain'
import { selectionHasAtomInline } from '../toolbar/atoms'
import type { NoteBlockNoteEditor } from '../schema'
import { collectAnchorCandidates } from './headings'
import { insertDocEmbedBlock, insertRefChip } from './insert'
import RefChipMenu from './RefChipMenu'
import RefPickerPanel, { type RefPickerRequest, type SelectionSnapshot } from './RefPickerPanel'
import { RefUiContext, type RefChipMenuRequest, type RefKind, type RefTitleEntry } from './RefTitleContext'

/** 제목 배치 조회를 모으는 창(ms). 첫 렌더의 칩 전부가 한 요청에 담길 만큼만 짧게. */
const BATCH_MS = 30

const EMPTY_SELECTION: SelectionSnapshot = {
  hasSelection: false,
  hasAtom: false,
  text: '',
  safe: false,
  rejection: null,
}

/** 툴바·슬래시 메뉴가 피커를 여는 통로(칩 렌더와 달리 편집기 UI 안에서만 쓴다). */
interface RefPickerCommands {
  openPicker: (mode: RefKind) => void
}

const RefPickerCommandContext = createContext<RefPickerCommands>({ openPicker: () => {} })

export function useRefPickerCommands(): RefPickerCommands {
  return useContext(RefPickerCommandContext)
}

function readSelectionSnapshot(editor: NoteBlockNoteEditor): SelectionSnapshot {
  const collapsed = editor.transact((tr) => tr.selection.from === tr.selection.to)
  if (collapsed) return EMPTY_SELECTION
  const hasAtom = selectionHasAtomInline(editor)
  const text = normalizeRefText(editor.getSelectedText())
  const safe = !hasAtom && isSafeRefText(text)
  return {
    hasSelection: true,
    hasAtom,
    text,
    safe,
    rejection: safe ? null : refTextRejection(text),
  }
}

export default function RefUiProvider({
  editor,
  children,
}: {
  editor: NoteBlockNoteEditor
  children: ReactNode
}) {
  const cacheRef = useRef(new Map<string, EmbedResolveItem>())
  const pendingRef = useRef(new Set<string>())
  const timerRef = useRef<number | null>(null)
  const aliveRef = useRef(true)
  const [version, setVersion] = useState(0)

  const [picker, setPicker] = useState<RefPickerRequest | null>(null)
  const [chipMenu, setChipMenu] = useState<RefChipMenuRequest | null>(null)

  useEffect(
    () => () => {
      aliveRef.current = false
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    },
    [],
  )

  const flush = useCallback(() => {
    timerRef.current = null
    const batch = Array.from(pendingRef.current)
    if (batch.length === 0) return
    void resolveEmbeds(batch)
      .then((items) => {
        if (!aliveRef.current) return
        const byNo = new Map(items.map((item) => [item.doc_no, item]))
        for (const docNo of batch) {
          // 응답에 빠진 대상은 "찾지 못함"으로 확정한다 — 영원히 pending으로 남기지 않는다.
          cacheRef.current.set(docNo, byNo.get(docNo) ?? { doc_no: docNo, found: false })
          pendingRef.current.delete(docNo)
        }
        setVersion((v) => v + 1)
      })
      .catch(() => {
        if (!aliveRef.current) return
        // 실패는 캐시에 못 박지 않는다 — 다음 요청 때 다시 시도할 수 있게 대기열에서만 뺀다.
        for (const docNo of batch) pendingRef.current.delete(docNo)
        setVersion((v) => v + 1)
      })
  }, [])

  const requestTitle = useCallback(
    (docNo: string) => {
      if (!isDocNo(docNo)) return
      if (cacheRef.current.has(docNo) || pendingRef.current.has(docNo)) return
      pendingRef.current.add(docNo)
      if (timerRef.current === null) timerRef.current = window.setTimeout(flush, BATCH_MS)
    },
    [flush],
  )

  const getTitle = useCallback(
    (docNo: string): RefTitleEntry => {
      const item = cacheRef.current.get(docNo)
      if (item) return { state: 'resolved', item }
      return { state: pendingRef.current.has(docNo) ? 'pending' : 'unresolved' }
    },
    // `version`은 값이 바뀌었음을 소비자에게 알리는 신호다(캐시 자체는 ref).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version],
  )

  const openChipMenu = useCallback(
    (request: RefChipMenuRequest) => {
      requestTitle(request.target)
      setChipMenu(request)
    },
    [requestTitle],
  )

  const openPicker = useCallback(
    (mode: RefKind) => {
      setChipMenu(null)
      setPicker({
        mode,
        rect: editor.getSelectionBoundingBox() ?? null,
        anchors: collectAnchorCandidates(editor),
        selection: readSelectionSnapshot(editor),
      })
    },
    [editor],
  )

  const onChangeTarget = useCallback(
    (request: RefChipMenuRequest) => {
      setChipMenu(null)
      setPicker({
        mode: request.refType,
        rect: request.rect,
        anchors: collectAnchorCandidates(editor),
        selection: EMPTY_SELECTION,
        edit: {
          currentLabel: request.label,
          apply: (target, label) => request.update({ target, label }),
        },
      })
    },
    [editor],
  )

  const uiValue = useMemo(
    () => ({ requestTitle, getTitle, openChipMenu, enabled: true }),
    [requestTitle, getTitle, openChipMenu],
  )
  const commands = useMemo(() => ({ openPicker }), [openPicker])

  return (
    <RefUiContext.Provider value={uiValue}>
      <RefPickerCommandContext.Provider value={commands}>
        {children}
        {picker && (
          <RefPickerPanel
            request={picker}
            onClose={() => setPicker(null)}
            onPickDoc={(mode, doc, label, replaceSelection) => {
              if (mode === 'embed') insertDocEmbedBlock(editor, doc.doc_no, label)
              else insertRefChip(editor, 'doc', doc.doc_no, label, replaceSelection)
            }}
            onPickAnchor={(target, label, replaceSelection) =>
              insertRefChip(editor, 'anchor', target, label, replaceSelection)
            }
          />
        )}
        {chipMenu && (
          <RefChipMenu
            request={chipMenu}
            entry={getTitle(chipMenu.target)}
            onClose={() => setChipMenu(null)}
            onChangeTarget={onChangeTarget}
          />
        )}
      </RefPickerCommandContext.Provider>
    </RefUiContext.Provider>
  )
}
