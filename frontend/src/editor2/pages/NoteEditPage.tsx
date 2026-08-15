// 노트(베타) 편집 — `/notes/:id` (설계 §5.16 "편집", API §4.28 · stage-33 규약 A·C·D)
//
// 저장 파이프라인(§5.16 "저장 파이프라인"):
//   BlockNote 문서 → 어댑터(fromBlockNoteBlocks) → 앱 블록 → blocksToMarkdown 프로젝션
//   → PATCH { content_blocks, content }  (**둘은 항상 함께** — 규약 A)
// 로드는 역방향이며, 어댑터가 **미지원 서식**을 보고하면 편집 표면에 올리지 않고 읽기 전용
// 폴백으로 간다(덮어쓰기 사고 0 — F-3·F-8).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { BlockNoteView } from '@blocknote/mantine'
import { useCreateBlockNote } from '@blocknote/react'
import '@blocknote/mantine/style.css'
import MarkdownView from '../../components/MarkdownView'
import ConfirmDialog from '../../components/ConfirmDialog'
import { blocksToMarkdown } from '../transform'
import { describeUnsupported, fromBlockNoteBlocks, toBlockNoteBlocks, type BnBlock } from '../adapter'
import {
  asAdapterBlocks,
  asEditorBlocks,
  noteDictionary,
  noteSchema,
  useEditorTheme,
} from '../blocknote/schema'
import { useDeleteNote, useNote, useUpdateNote, type Note } from '../api/notes'

/** 규약 C — 유휴 1.5초 · 최대 대기 10초. */
const IDLE_MS = 1500
const MAX_WAIT_MS = 10000
/** 저장 실패 후 다음 재시도까지(로컬 편집분은 버리지 않는다 — 규약 C). */
const RETRY_MS = 5000

type SaveState = 'clean' | 'dirty' | 'saving' | 'error'

export default function NoteEditPage() {
  const params = useParams()
  const parsed = Number(params.id)
  const noteId = Number.isFinite(parsed) ? parsed : null
  const noteQuery = useNote(noteId)

  if (noteQuery.isLoading) {
    return <p className="p-4 text-sm text-muted">불러오는 중…</p>
  }
  if (noteQuery.isError || !noteQuery.data) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-3 p-4">
        <p className="text-sm text-wrong">
          {noteQuery.error instanceof Error ? noteQuery.error.message : '노트를 불러오지 못했습니다'}
        </p>
        <Link to="/notes" className="text-sm text-accent">
          ← 목록으로
        </Link>
      </div>
    )
  }
  // key = 노트 id — 다른 노트로 이동하면 편집기를 새로 만든다(초기 콘텐츠는 1회만 주입된다).
  return <NoteEditor key={noteQuery.data.id} note={noteQuery.data} />
}

function NoteEditor({ note }: { note: Note }) {
  const navigate = useNavigate()
  const updateNote = useUpdateNote()
  const deleteNote = useDeleteNote()
  const theme = useEditorTheme()

  // 로드: content_blocks → 어댑터 → 초기 콘텐츠. 미지원 서식이 있으면 편집 표면에 올리지 않는다.
  const loaded = useMemo(() => toBlockNoteBlocks(note.content_blocks), [note.content_blocks])
  const readOnly = loaded.unsupported.length > 0

  if (readOnly) {
    return <UnsupportedFallback note={note} reason={describeUnsupported(loaded.unsupported)} />
  }
  return <EditableNote note={note} initialBlocks={loaded.blocks} {...{ navigate, updateNote, deleteNote, theme }} />
}

function UnsupportedFallback({ note, reason }: { note: Note; reason: string }) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 p-4">
      <TopBarShell title={note.title} />
      <div className="rounded-lg border border-warning bg-surface p-3 text-sm text-primary">
        이 노트에는 아직 지원하지 않는 서식이 있습니다 — 읽기 전용으로 표시합니다.
        <p className="mt-1 text-xs text-muted">{reason}</p>
      </div>
      <div className="rounded-lg border border-border bg-surface p-4">
        <MarkdownView content={note.content} />
      </div>
    </div>
  )
}

function TopBarShell({ title }: { title: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h1 className="truncate text-lg font-bold text-primary">{title.trim() || '제목 없음'}</h1>
      <Link to="/notes" className="shrink-0 rounded border border-border px-2 py-1 text-sm text-primary hover:bg-bg">
        목록
      </Link>
    </div>
  )
}

interface EditableNoteProps {
  note: Note
  initialBlocks: BnBlock[]
  navigate: ReturnType<typeof useNavigate>
  updateNote: ReturnType<typeof useUpdateNote>
  deleteNote: ReturnType<typeof useDeleteNote>
  theme: 'light' | 'dark'
}

function EditableNote({ note, initialBlocks, navigate, updateNote, deleteNote, theme }: EditableNoteProps) {
  const editor = useCreateBlockNote({
    schema: noteSchema,
    dictionary: noteDictionary,
    initialContent: initialBlocks.length > 0 ? asEditorBlocks(initialBlocks) : undefined,
  })

  const [title, setTitle] = useState(note.title)
  const [state, setState] = useState<SaveState>('clean')
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [preview, setPreview] = useState(false)
  const [projection, setProjection] = useState(note.content)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const titleRef = useRef(title)
  titleRef.current = title
  const dirtyRef = useRef(false)
  const composingRef = useRef(false)
  const idleTimer = useRef<number | null>(null)
  const maxTimer = useRef<number | null>(null)
  const inFlight = useRef(false)

  const clearTimers = useCallback(() => {
    if (idleTimer.current !== null) window.clearTimeout(idleTimer.current)
    if (maxTimer.current !== null) window.clearTimeout(maxTimer.current)
    idleTimer.current = null
    maxTimer.current = null
  }, [])

  /** 편집기 문서 → 앱 블록 → Markdown 프로젝션(규약 A: 저장 요청에 함께 싣는다). */
  const buildBody = useCallback(() => {
    const doc = fromBlockNoteBlocks(asAdapterBlocks(editor.document))
    return { content_blocks: doc, content: blocksToMarkdown(doc) }
  }, [editor])

  const saveNow = useCallback(() => {
    clearTimers()
    if (!dirtyRef.current) return
    // IME 조합 중(규약 C)이거나 직전 저장이 비행 중이면 **버리지 않고 뒤로 미룬다**
    // — 타이머를 지운 채 그냥 돌아가면 그 편집분이 다음 입력 때까지 저장되지 않는다.
    if (composingRef.current || inFlight.current) {
      idleTimer.current = window.setTimeout(saveNow, IDLE_MS)
      return
    }

    const body = buildBody()
    setProjection(body.content)
    dirtyRef.current = false
    inFlight.current = true
    setState('saving')
    updateNote.mutate(
      { id: note.id, title: titleRef.current, ...body },
      {
        onSuccess: () => {
          inFlight.current = false
          setSavedAt(new Date())
          setErrorMessage(null)
          setState(dirtyRef.current ? 'dirty' : 'clean')
        },
        onError: (error) => {
          inFlight.current = false
          // 로컬 편집분을 버리지 않는다 — 다시 dirty로 돌리고 다음 주기에 재시도한다.
          dirtyRef.current = true
          setErrorMessage(error instanceof Error ? error.message : '노트를 저장하지 못했습니다')
          setState('error')
          maxTimer.current = window.setTimeout(saveNow, RETRY_MS)
        },
      },
    )
  }, [buildBody, clearTimers, note.id, updateNote])

  /** 규약 C — 디바운스(유휴 1.5초) + 최대 대기 10초. */
  const scheduleSave = useCallback(() => {
    dirtyRef.current = true
    setState((prev) => (prev === 'saving' ? prev : 'dirty'))
    if (composingRef.current) return
    if (idleTimer.current !== null) window.clearTimeout(idleTimer.current)
    idleTimer.current = window.setTimeout(saveNow, IDLE_MS)
    if (maxTimer.current === null) maxTimer.current = window.setTimeout(saveNow, MAX_WAIT_MS)
  }, [saveNow])

  // Ctrl+S 명시 저장(규약 C)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        saveNow()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [saveNow])

  // 미저장 상태로 이탈하면 경고(규약 C)
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  // 화면을 떠날 때 남은 편집분을 흘려보내지 않는다(타이머가 죽기 전에 마지막 저장).
  useEffect(
    () => () => {
      clearTimers()
      if (dirtyRef.current) {
        const doc = fromBlockNoteBlocks(asAdapterBlocks(editor.document))
        updateNote.mutate({
          id: note.id,
          title: titleRef.current,
          content_blocks: doc,
          content: blocksToMarkdown(doc),
        })
      }
    },
    // 언마운트 1회만 — 의존성으로 재실행되면 매 렌더 저장이 돈다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const openPreview = () => {
    setProjection(blocksToMarkdown(fromBlockNoteBlocks(asAdapterBlocks(editor.document))))
    setPreview(true)
  }

  const onDelete = () => {
    deleteNote.mutate(note.id, {
      onSuccess: () => {
        dirtyRef.current = false
        navigate('/notes')
      },
    })
  }

  const statusText =
    state === 'saving'
      ? '저장 중…'
      : state === 'error'
        ? '저장 실패 — 다시 시도'
        : state === 'dirty'
          ? '저장 대기…'
          : savedAt
            ? `저장됨 (${savedAt.toLocaleTimeString()})`
            : '저장됨'

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value)
            scheduleSave()
          }}
          onCompositionStart={() => {
            composingRef.current = true
          }}
          onCompositionEnd={() => {
            composingRef.current = false
            if (dirtyRef.current) scheduleSave()
          }}
          placeholder="제목 없음"
          className="min-w-0 flex-1 rounded border border-border bg-surface px-3 py-2 text-base font-semibold text-primary placeholder:font-normal placeholder:text-muted"
        />
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => (preview ? setPreview(false) : openPreview())}
            className={`rounded border px-2 py-1 text-sm ${
              preview ? 'border-accent bg-accent-soft text-accent' : 'border-border text-primary hover:bg-bg'
            }`}
          >
            미리보기
          </button>
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="rounded border border-border px-2 py-1 text-sm text-muted hover:bg-bg hover:text-wrong"
          >
            삭제
          </button>
          <Link
            to="/notes"
            className="rounded border border-border px-2 py-1 text-sm text-primary hover:bg-bg"
          >
            목록
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={state === 'error' ? 'text-wrong' : 'text-muted'}>{statusText}</span>
        {state === 'error' && errorMessage && <span className="text-wrong">{errorMessage}</span>}
        {state === 'error' && (
          <button type="button" onClick={saveNow} className="rounded border border-border px-2 py-0.5 text-primary">
            지금 저장
          </button>
        )}
      </div>

      <div
        className="note-editor-frame"
        onCompositionStartCapture={() => {
          composingRef.current = true
        }}
        onCompositionEndCapture={() => {
          composingRef.current = false
          if (dirtyRef.current) scheduleSave()
        }}
      >
        <BlockNoteView editor={editor} theme={theme} onChange={scheduleSave} />
      </div>

      {preview && (
        <section className="rounded-lg border border-border bg-surface p-4">
          <h2 className="mb-2 text-xs font-semibold text-muted">Markdown 미리보기 (저장되는 프로젝션)</h2>
          <MarkdownView content={projection} />
        </section>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="노트 삭제"
          message="노트를 삭제할까요? 목록에서 사라집니다."
          confirmLabel="삭제"
          danger
          submitting={deleteNote.isPending}
          onConfirm={onDelete}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </div>
  )
}
