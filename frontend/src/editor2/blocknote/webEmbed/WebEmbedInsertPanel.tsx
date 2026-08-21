// 웹 임베드 삽입 패널 — URL 입력 → §4.30 1회 조회 → 삽입(stage-37 F-4 · 규약 B).
//
// `refPicker/RefPickerPanel.tsx`와 같은 `AnchoredPanel`을 재사용한다(참조 피커와 다른 팝오버 규칙을
// 새로 만들지 않는다). 이 패널의 수명은 짧다(URL 하나 입력하고 바로 닫힌다) — `RefUiProvider` 같은
// 상시 컨텍스트를 새로 두지 않고 `NoteEditorDialectUI`(이미 BlockNoteView 안쪽이라 이 블록 삽입에는
// 바깥 컨텍스트가 필요 없다)가 직접 들고 있다가 여기 렌더한다.
//
// **조회 실패는 삽입을 막지 않는다**(§4.30 계약)지만, 실패 사유를 사용자가 못 보고 지나가면 "왜 카드가
// 비었는지" 알 길이 없다(조용한 실패 없음). 그래서 실패 시 **자동으로 닫지 않고** 사유를 보여준 채
// [다시 시도]·[URL 카드로 삽입] 중 사용자가 고르게 한다 — 성공 시에는 그대로 삽입하고 닫는다.
import { useCallback, useEffect, useRef, useState } from 'react'
import AnchoredPanel from '../refPicker/AnchoredPanel'
import type { NoteBlockNoteEditor } from '../schema'
import { fetchWebEmbedPreview, webEmbedFetchErrorMessage } from './api'
import { insertWebEmbedBlock } from './insert'

const PANEL_WIDTH = 340

interface WebEmbedInsertPanelProps {
  editor: NoteBlockNoteEditor
  rect: DOMRect | null
  onClose: () => void
}

export default function WebEmbedInsertPanel({ editor, rect, onClose }: WebEmbedInsertPanelProps) {
  const [url, setUrl] = useState('')
  const [phase, setPhase] = useState<'idle' | 'busy' | 'failed'>('idle')
  const [failure, setFailure] = useState<string | null>(null)
  // 조회 중 패널이 닫히면(Esc·바깥 클릭·취소) 응답이 늦게 와도 삽입하지 않는다 — "취소"의 의미를 지킨다.
  const aliveRef = useRef(true)
  useEffect(
    () => () => {
      aliveRef.current = false
    },
    [],
  )

  const attemptFetch = useCallback(async () => {
    const trimmed = url.trim()
    if (trimmed === '' || phase === 'busy') return
    setPhase('busy')
    setFailure(null)
    try {
      const preview = await fetchWebEmbedPreview(trimmed)
      if (!aliveRef.current) return
      insertWebEmbedBlock(editor, trimmed, preview)
      onClose()
    } catch (error) {
      if (!aliveRef.current) return
      // 실패해도 삽입 자체는 막지 않는다(§4.30) — 다만 사유는 사용자가 보고 고르게 한다.
      setFailure(webEmbedFetchErrorMessage(error))
      setPhase('failed')
    }
  }, [editor, onClose, phase, url])

  const insertWithoutMeta = useCallback(() => {
    const trimmed = url.trim()
    if (trimmed === '') return
    insertWebEmbedBlock(editor, trimmed, null)
    onClose()
  }, [editor, onClose, url])

  return (
    <AnchoredPanel rect={rect} width={PANEL_WIDTH} onClose={onClose} label="웹 임베드 삽입">
      <div className="flex flex-col gap-2 p-3">
        <label className="block text-[11px] text-muted" htmlFor="editor2-web-embed-url">
          웹 페이지 URL
        </label>
        <input
          id="editor2-web-embed-url"
          autoFocus
          value={url}
          onChange={(event) => {
            setUrl(event.target.value)
            setPhase('idle')
            setFailure(null)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void attemptFetch()
            }
          }}
          placeholder="https://example.com/article"
          className="w-full rounded border border-border bg-surface px-2 py-1 text-sm text-primary placeholder:text-muted"
        />
        <p className="text-[11px] text-muted">
          제목·설명·썸네일을 한 번 조회해 카드로 저장합니다. 조회에 실패해도 URL 카드로 넣을 수
          있습니다.
        </p>
        {phase === 'failed' && failure && (
          <p className="text-[11px] text-wrong">조회 실패 — {failure}</p>
        )}
        <div className="mt-1 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-border px-2 py-1 text-xs text-muted hover:bg-bg"
          >
            취소
          </button>
          {phase === 'failed' ? (
            <>
              <button
                type="button"
                onClick={() => void attemptFetch()}
                className="rounded border border-border px-2 py-1 text-xs text-primary hover:bg-bg"
              >
                다시 시도
              </button>
              <button
                type="button"
                onClick={insertWithoutMeta}
                className="rounded border border-accent bg-accent px-3 py-1 text-xs text-on-accent"
              >
                URL 카드로 삽입
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={url.trim() === '' || phase === 'busy'}
              onClick={() => void attemptFetch()}
              className="rounded border border-accent bg-accent px-3 py-1 text-xs text-on-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {phase === 'busy' ? '조회 중…' : '삽입'}
            </button>
          )}
        </div>
      </div>
    </AnchoredPanel>
  )
}
