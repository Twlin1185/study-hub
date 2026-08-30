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
// 편집 표면 스타일(BlockNote 색을 tokens.css 변수로 결선 — 불변 규칙 5). 스키마 모듈이 아니라
// 화면이 들고 있어야 스키마 모듈이 DOM 없이 로드된다(검증 스크립트 계열 ⑤ 재사용).
import '../blocknote/notes.css'
import MarkdownView from '../../components/MarkdownView'
import ConfirmDialog from '../../components/ConfirmDialog'
import Modal from '../../components/Modal'
import { blocksToMarkdown } from '../transform'
import {
  describeUnsupported,
  fromBlockNoteBlocks,
  fromBlockNoteResult,
  toBlockNoteBlocks,
  type AdapterSidecar,
  type BnBlock,
} from '../adapter'
import {
  asAdapterBlocks,
  asEditorBlocks,
  noteDictionary,
  noteSchema,
  useEditorTheme,
} from '../blocknote/schema'
import { createPasteHandler } from '../blocknote/paste'
import { createEditor2Extensions, tableAlignFromSidecar } from '../blocknote/extensions'
import { syncTableAlignIntoSidecar } from '../blocknote/tableAlign/sidecarSync'
import { NoteEditorDialectUI, RefUiProvider } from '../blocknote/ui'
import {
  describeSkippedNonImageFiles,
  insertUploadedImages,
  isImageFile,
  useImageUploadQueue,
} from '../blocknote/uploads'
import { useDeleteNote, useNote, useUpdateNote, type Note } from '../api/notes'
import { useNoteDocumentTitle } from '../lib/useNoteDocumentTitle'
import { useTitleHistory } from '../lib/useTitleHistory'
import {
  clearNoteSnapshot,
  noteSnapshotsEqual,
  readNoteSnapshot,
  writeNoteSnapshot,
  type NoteSnapshot,
} from '../lib/noteSessionSnapshot'

/** 규약 C — 유휴 1.5초 · 최대 대기 10초. */
const IDLE_MS = 1500
const MAX_WAIT_MS = 10000
/** 저장 실패 후 다음 재시도까지(로컬 편집분은 버리지 않는다 — 규약 C). */
const RETRY_MS = 5000
/** [취소] 복귀 대상 스냅샷이 빈 문서였을 때의 최소 문서(빈 배열은 편집기에 넘길 수 없다). */
const EMPTY_BLOCKS: BnBlock[] = [{ type: 'paragraph', content: [] }]

type SaveState = 'clean' | 'dirty' | 'saving' | 'error'

export default function NoteEditPage() {
  const params = useParams()
  const parsed = Number(params.id)
  const noteId = Number.isFinite(parsed) ? parsed : null
  const noteQuery = useNote(noteId)
  // 탭 제목 = `노트(베타) · <노트 제목>` — 기존 화면과 구분되고, 노트 창을 여러 개 열어도
  // 서로 구별된다. 제목은 **저장된 값**을 따른다(타이핑마다 탭이 깜빡이지 않게).
  useNoteDocumentTitle(noteQuery.data?.title)

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
  // 사이드카(규약 I 흡수분 — 링크 제목·블록 메타·표 정렬·느슨한 목록·목록 그룹 경계)는 편집 세션
  // 동안 들고 있다가 저장할 때 역변환에 돌려준다. 편집 표면에 자리가 없는 값이라 여기 말고는
  // 살아남을 곳이 없다. 붙여넣기로 들어온 흡수분도 이 세션 사이드카에 합류한다(`mergeSidecar`).
  return (
    <EditableNote
      note={note}
      initialBlocks={loaded.blocks}
      sidecar={loaded.sidecar}
      {...{ navigate, updateNote, deleteNote, theme }}
    />
  )
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
  sidecar: AdapterSidecar
  navigate: ReturnType<typeof useNavigate>
  updateNote: ReturnType<typeof useUpdateNote>
  deleteNote: ReturnType<typeof useDeleteNote>
  theme: 'light' | 'dark'
}

function EditableNote({
  note,
  initialBlocks,
  sidecar,
  navigate,
  updateNote,
  deleteNote,
  theme,
}: EditableNoteProps) {
  // 이미지 3진입점(규약 H) 공유 업로드 지점 — 드롭·붙여넣기·툴바가 전부 이 하나만 거친다.
  // `useCreateBlockNote`는 최초 렌더의 옵션만 영구히 캡처한다(deps=[] 고정 — 아래 훅 실측:
  // node_modules/@blocknote/react useCreateBlockNote.tsx `useMemo(..., deps)`)므로, 여기서
  // 넘기는 `uploadFile`·`pasteHandler` 클로저는 setState·상태 없는 API 호출만 참조해
  // "최초 렌더 이후로도 계속 정확히 동작"하도록 만든다(리렌더마다 새로 만들 필요가 없다).
  const uploadQueue = useImageUploadQueue()
  // "조용히 버리지 않는다" 공용 배너 — 붙여넣기 안내·드롭 안내·표 정렬 고지가 이 하나를 공유한다.
  const [pasteNotice, setPasteNotice] = useState<string | null>(null)

  // **세션 사이드카** — 로드 때 받은 흡수분에서 출발해, 붙여넣기로 들어온 흡수분이 여기 합류한다.
  // ref인 이유: `useCreateBlockNote`가 최초 렌더의 `pasteHandler` 클로저를 영구히 캡처하므로
  // (deps=[] 고정) 상태로 두면 붙여넣기 핸들러가 낡은 사본을 붙잡는다.
  const sidecarRef = useRef<AdapterSidecar>({ ...sidecar })
  const mergeSidecar = useCallback((entries: AdapterSidecar) => {
    // **기존 키를 덮어쓰지 않는다** — 사이드카 키는 블록 id이고, 같은 id가 이미 있다면 그것은
    // 문서에 살아 있는 다른 블록의 항목이다(그쪽이 정본). 붙여넣기 쪽 id는 `reassignPastedIds`가
    // 이미 세션 유일 값으로 갈아 끼우므로 정상 경로에서 이 분기는 서지 않는다 — 마지막 방어선이다.
    for (const [key, entry] of Object.entries(entries)) {
      if (!(key in sidecarRef.current)) sidecarRef.current[key] = entry
    }
  }, [])

  // stage-36 F-6 — 표 열 정렬 **1회성 예고는 없앴다**. 정렬 편집 UI(`TableAlignBar`)가 생겨
  // 커서를 표 안에 두면 현재 열의 정렬이 그대로 보이고, 열을 넣고 빼도 플러그인이 정렬 배열을
  // 함께 옮기므로 "모르는 새 사라진다"는 상황 자체가 없어졌다(사후 고지는 안전망으로 남긴다).

  const editor = useCreateBlockNote({
    schema: noteSchema,
    dictionary: noteDictionary,
    initialContent: initialBlocks.length > 0 ? asEditorBlocks(initialBlocks) : undefined,
    uploadFile: uploadQueue.uploadFile,
    pasteHandler: createPasteHandler({
      runUpload: uploadQueue.uploadFile,
      beginUploadBatch: uploadQueue.beginBatch,
      onNotice: setPasteNotice,
      mergeSidecar,
    }),
    // 찾기/바꾸기(F-7)·표 열 정렬(F-6) PM 플러그인. 정렬 초기값은 **로드 사이드카**에서 온다.
    extensions: createEditor2Extensions(tableAlignFromSidecar(sidecar)),
  })

  const [title, setTitle] = useState(note.title)
  const [state, setState] = useState<SaveState>('clean')
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [preview, setPreview] = useState(false)
  const [projection, setProjection] = useState(note.content)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // 세션 원본 스냅샷(규약 E) — [취소](규약 C)의 복귀 기준점과 동일 실체. `liveSnapshotRef`는
  // "지금 취소하면 무엇으로 돌아가는가"의 살아있는 값(체크포인트 — 진입 시점에서 시작해 매 명시
  // [저장]/[취소] 성공마다 그 시점으로 갱신된다), localStorage 사본은 크래시 감지 전용이다.
  const liveSnapshotRef = useRef<NoteSnapshot | null>(null)
  const [snapshotOk, setSnapshotOk] = useState(true)
  const [snapshotErrorMessage, setSnapshotErrorMessage] = useState<string | null>(null)
  // 체크포인트 이후 실제로 뭔가 바뀌었는지(저장 상태 4종의 dirty와는 별개 — 자동저장이 이미
  // 서버에 반영된 뒤에도 "체크포인트 대비 달라졌다"는 사실은 남아 있어야 [취소]가 의미가 있다).
  const [changedFromSnapshot, setChangedFromSnapshot] = useState(false)
  // 재진입에서 미폐기 스냅샷을 발견했을 때만 채워진다 — 복구 선택 다이얼로그(규약 E).
  const [recoveryPrompt, setRecoveryPrompt] = useState<NoteSnapshot | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)

  const titleRef = useRef(title)
  titleRef.current = title
  const dirtyRef = useRef(false)
  const composingRef = useRef(false)
  const idleTimer = useRef<number | null>(null)
  const maxTimer = useRef<number | null>(null)
  // 검토 경미 4 — [취소]가 IME 조합 중이라 재시도로 미룬 타이머. 추적하지 않으면 언마운트
  // 뒤에도 살아남아 죽은 편집기에 replaceBlocks·PATCH를 쏘는 경로가 열린다.
  const cancelRetryTimer = useRef<number | null>(null)
  const inFlight = useRef(false)
  // 검토 경미 3 — React StrictMode(dev) 이중 마운트 방어. 마운트 이펙트가 크래시 복구를
  // 감지해 다이얼로그를 띄운 직후 dev 전용 합성 언마운트가 스냅샷을 지우면(그리고 곧바로
  // 재마운트가 "부재"로 오판해 현재분으로 체크포인트를 덮어쓰면) "원본으로 되돌리기"가
  // no-op이 된다. 복구 결정이 나기 전에는 언마운트 정리가 스냅샷을 지우지 않게 이 ref로 막는다
  // (실제 이탈이든 StrictMode 합성 이탈이든 동일 — 결정 전 이탈은 "아직 미해결"이라 보존이 맞다).
  const recoveryPendingRef = useRef(false)

  // 검토 경미 B — `clearTimers()`는 자동저장(`saveNow` 서두)에서도 불린다. `cancelRetryTimer`를
  // 여기서 함께 지우면, 조합 중 [취소] 확인 후 재시도를 기다리는 동안 자동저장(특히 maxTimer
  // 10초 만기)이 발사돼 `saveNow`가 `clearTimers()`를 부르는 순간 재시도 타이머가 지워지고
  // 재무장되지 않아 "되돌리기"가 조용히 무시된다. **`cancelRetryTimer`는 이 함수가 건드리지
  // 않고 언마운트 cleanup에서만 정리한다**(죽은 편집기로의 발사만 막으면 충분 — 살아있는 동안은
  // 재시도가 스스로를 재무장한다).
  const clearTimers = useCallback(() => {
    if (idleTimer.current !== null) window.clearTimeout(idleTimer.current)
    if (maxTimer.current !== null) window.clearTimeout(maxTimer.current)
    idleTimer.current = null
    maxTimer.current = null
  }, [])

  /** 표 열 정렬 폐기를 이미 알린 블록 id — 자동 저장마다 같은 배너가 반복되지 않게 한다. */
  const alignNotifiedRef = useRef<Set<string>>(new Set())

  /**
   * 스냅샷 체크포인트를 (재)확보한다 — 진입 시점(생략 진입) · 명시 [저장] 성공 후 · [취소] 복귀
   * 성공 후 3곳에서만 부른다(규약 E "세션 갱신 시 대체" — 자동 저장은 이 체크포인트를 옮기지
   * 않는다. 그래야 자동저장이 서버에 이미 반영한 분과 체크포인트가 계속 달라 크래시 복구가
   * 의미 있게 동작한다). 기록 실패 시 `snapshotOk=false` — 호출부가 [취소]를 비활성한다.
   */
  const commitLiveSnapshot = useCallback(
    (nextTitle: string, blocks: BnBlock[], sidecar: AdapterSidecar) => {
      const snap: NoteSnapshot = { title: nextTitle, blocks, sidecar: { ...sidecar } }
      const ok = writeNoteSnapshot(note.id, snap)
      liveSnapshotRef.current = snap
      setSnapshotOk(ok)
      setSnapshotErrorMessage(
        ok ? null : '이 브라우저에 편집 내용을 기록하지 못했습니다 — 취소를 쓸 수 없습니다.',
      )
      setChangedFromSnapshot(false)
    },
    [note.id],
  )

  // 진입 시점 스냅샷 확보(마운트 1회) — 미폐기 스냅샷을 발견하면 크래시 복구 다이얼로그로,
  // 없거나 손상됐으면(또는 정상 종결 직후 그대로면) 조용히 새 체크포인트를 확보한다.
  useEffect(() => {
    const found = readNoteSnapshot(note.id)
    if (found && !noteSnapshotsEqual(found, { title: note.title, blocks: initialBlocks })) {
      liveSnapshotRef.current = found
      setSnapshotOk(true)
      setSnapshotErrorMessage(null)
      // 이미 로드된 내용(자동저장분)이 스냅샷과 다르다는 뜻 — [취소]가 곧바로 유효하다.
      setChangedFromSnapshot(true)
      // 결정 전 이탈(StrictMode 합성 언마운트 포함)로부터 스냅샷을 지킨다(경미 3).
      recoveryPendingRef.current = true
      setRecoveryPrompt(found)
    } else {
      commitLiveSnapshot(note.title, initialBlocks, sidecarRef.current)
    }
    // 마운트 1회만 — note.id별로 컴포넌트가 새로 마운트된다(NoteEditPage의 key=note.id).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 편집기 문서 → 앱 블록 → Markdown 프로젝션(규약 A: 저장 요청에 함께 싣는다). */
  const buildBody = useCallback(() => {
    // F-6 — 편집 세션이 들고 있던 표 열 정렬을 **역변환 직전에** 사이드카로 옮겨 적는다.
    syncTableAlignIntoSidecar(editor, sidecarRef.current)
    const result = fromBlockNoteResult(asAdapterBlocks(editor.document), sidecarRef.current)
    // 정렬 폐기 고지는 **안전망**으로 남긴다. 정상 경로에서는 플러그인이 열 증감 때마다 정렬 배열을
    // 함께 옮겨 길이가 늘 맞으므로 0건이어야 한다 — 뜨면 그 자체가 결함 신호다.
    const fresh = result.tableAlignDrops.filter((id) => !alignNotifiedRef.current.has(id))
    if (fresh.length > 0) {
      for (const id of fresh) alignNotifiedRef.current.add(id)
      setPasteNotice(`표 ${fresh.length}개의 열 정렬을 복원하지 못했습니다.`)
    }
    const doc = result.document
    return { content_blocks: doc, content: blocksToMarkdown(doc) }
  }, [editor])

  /**
   * `explicit` = 사용자가 명시적으로 명한 저장(상시 [저장] 버튼·Ctrl+S — 규약 B: 같은 flush
   * 경로). 자동 저장(디바운스·최대 대기·실패 재시도)은 항상 `explicit=false`. 성공한 명시
   * 저장만 스냅샷 체크포인트를 그 시점으로 옮긴다(규약 E — 자동 저장은 체크포인트를 옮기지
   * 않아야 크래시 복구가 의미 있다).
   */
  const saveNow = useCallback(
    (opts?: { explicit?: boolean }) => {
      clearTimers()
      if (!dirtyRef.current) return
      // IME 조합 중(규약 C)이거나 직전 저장이 비행 중이면 **버리지 않고 뒤로 미룬다**
      // — 타이머를 지운 채 그냥 돌아가면 그 편집분이 다음 입력 때까지 저장되지 않는다.
      if (composingRef.current || inFlight.current) {
        idleTimer.current = window.setTimeout(() => saveNow(opts), IDLE_MS)
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
            if (opts?.explicit) {
              // 검토 중요 2 — 여기서 `asAdapterBlocks(editor.document)`(실 편집기 스키마 산출물)를
              // 그대로 체크포인트에 쓰면 재진입 로드분(`toBlockNoteBlocks`)과 구조가 달라(모든
              // 블록의 `children`/`props` 유무 차이·표 셀 표현 차이·경성 줄바꿈 런 분할 차이 등
              // — 실측: scratchpad 검증 스크립트) `noteSnapshotsEqual`이 내용이 같아도 항상
              // false를 낸다. **방금 저장한 그 앱 블록(`body.content_blocks`)을 다시
              // `toBlockNoteBlocks`로 되읽어** 재진입과 완전히 같은 함수·같은 형태를 만든다
              // (정규화로 흉내 내는 대신 "같은 경로를 태운다"가 더 강한 보장).
              const reloaded = toBlockNoteBlocks(body.content_blocks)
              if (reloaded.unsupported.length === 0) {
                commitLiveSnapshot(titleRef.current, reloaded.blocks, reloaded.sidecar)
              }
              // unsupported면(이론상 발생하지 않는다 — 방금 편집기에서 나온 데이터다) 재커밋을
              // 건너뛴다 — 이전 체크포인트가 남는 편이 형태를 모르는 값을 쓰는 것보다 안전하다.
            }
          },
          onError: (error) => {
            inFlight.current = false
            // 로컬 편집분을 버리지 않는다 — 다시 dirty로 돌리고 다음 주기에 재시도한다.
            dirtyRef.current = true
            setErrorMessage(error instanceof Error ? error.message : '노트를 저장하지 못했습니다')
            setState('error')
            // 검토 경미 ⑥ — `opts`(명시 저장 여부)를 재시도에도 그대로 넘긴다. `saveNow`만 넘기면
            // 재시도가 성공해도 `opts?.explicit`가 사라져 명시 저장의 재시도 성공이 체크포인트를
            // 옮기지 못한다.
            maxTimer.current = window.setTimeout(() => saveNow(opts), RETRY_MS)
          },
        },
      )
    },
    [buildBody, clearTimers, note.id, updateNote, commitLiveSnapshot],
  )

  /** 규약 C — 디바운스(유휴 1.5초) + 최대 대기 10초. */
  const scheduleSave = useCallback(() => {
    dirtyRef.current = true
    setState((prev) => (prev === 'saving' ? prev : 'dirty'))
    // 체크포인트(스냅샷) 대비 달라졌다 — [취소](규약 C)가 이제 의미를 갖는다. 자동 저장이
    // 성공해도(저장 상태는 clean으로 돌아가도) 이 값은 되돌리지 않는다: [취소]는 "자동저장이
    // 이미 서버에 쓴 분까지" 물려야 하기 때문이다.
    setChangedFromSnapshot(true)
    if (composingRef.current) return
    if (idleTimer.current !== null) window.clearTimeout(idleTimer.current)
    idleTimer.current = window.setTimeout(saveNow, IDLE_MS)
    if (maxTimer.current === null) maxTimer.current = window.setTimeout(saveNow, MAX_WAIT_MS)
  }, [saveNow])

  // 제목 입력란 전용 undo 스택(결함 U-2) — 제목에서 난 Ctrl+Z가 **본문**을 되돌리던 경로를 끊고
  // 묶음 단위 되돌리기를 제공한다. 되돌린 값도 편집이므로 저장 파이프라인(규약 C)에 그대로 태운다.
  const titleHistory = useTitleHistory({
    value: title,
    apply: (next) => {
      setTitle(next)
      scheduleSave()
    },
  })

  // Ctrl+S 명시 저장(규약 C)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        // 규약 B — Ctrl+S는 상시 [저장] 버튼과 **같은 명시 저장**이다(체크포인트도 함께 갱신).
        saveNow({ explicit: true })
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
      // 검토 경미 B — `cancelRetryTimer`는 `clearTimers()`가 건드리지 않으므로(자동저장이 진행
      // 중인 [취소] 재시도를 지워버리지 않게) 진짜 이탈인 여기서만 명시적으로 정리한다.
      if (cancelRetryTimer.current !== null) {
        window.clearTimeout(cancelRetryTimer.current)
        cancelRetryTimer.current = null
      }
      if (dirtyRef.current) {
        syncTableAlignIntoSidecar(editor, sidecarRef.current)
        const doc = fromBlockNoteBlocks(asAdapterBlocks(editor.document), sidecarRef.current)
        updateNote.mutate({
          id: note.id,
          title: titleRef.current,
          content_blocks: doc,
          content: blocksToMarkdown(doc),
        })
      }
      // 규약 E — 명시 버튼 없는 정상 이탈(목록 이동 등)도 "유지 확정"으로 간주해 스냅샷을
      // 지운다(자동 저장이 이미 서버에 반영했다). 지우지 않으면 다음 진입에서 거짓 복구
      // 다이얼로그가 뜬다(DoD 4·5 — 거짓 다이얼로그 0). **단, 크래시 복구 결정이 아직 나지
      // 않은 동안은 지우지 않는다**(경미 3) — StrictMode(dev) 합성 언마운트가 이 폐기를
      // 밟으면 재마운트가 "부재"로 오판해 체크포인트를 현재분으로 덮어써 복구 다이얼로그가
      // no-op이 된다. 결정이 안 난 이탈(진짜든 합성이든)은 "아직 미해결"이라 보존이 맞다 —
      // 다음 진입에 같은 다이얼로그가 다시 뜨는 것은 거짓이 아니라 정확한 재고지다.
      if (!recoveryPendingRef.current) clearNoteSnapshot(note.id)
    },
    // 언마운트 1회만 — 의존성으로 재실행되면 매 렌더 저장이 돈다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const openPreview = () => {
    syncTableAlignIntoSidecar(editor, sidecarRef.current)
    setProjection(blocksToMarkdown(fromBlockNoteBlocks(asAdapterBlocks(editor.document), sidecarRef.current)))
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

  /**
   * [취소](규약 C — ② 확정: 편집 세션 진입 시점 원본 스냅샷 복귀) — 체크포인트로 편집기
   * 문서·제목·사이드카를 되돌린 뒤 **저장**한다(자동저장이 이미 서버에 쓴 분까지 물린다).
   * IME 조합 중이면 본문이 다치지 않게 조합이 끝난 뒤로 미룬다(규약 B의 조합 중 보류 계승).
   *
   * 되돌리기는 `editor.replaceBlocks`로 이뤄지며, BlockNote는 `editor.transact`로 감싼 변경을
   * **단일 undo 스텝**으로 묶는다(엔진 실측 — `@blocknote/core` `BlockManager.replaceBlocks`가
   * `editor.transact(...)`를 거치고, `transact`의 JSDoc이 "그룹 변경 = 단일 undo step"임을
   * 명시). 즉 [취소] 복귀 직후 Ctrl+Z를 누르면 되돌리기 이전 내용이 그대로 돌아오며, 그 상태는
   * dirty이므로 다시 자동저장된다(취소의 취소 — 조용한 손실 경로 없음). **⑧ undo 범위 정정** —
   * 노트 표면의 [취소]는 문서 표면과 달리 항상 편집을 유지한다(닫기 변형이 없다 — 별도 이탈은
   * 상단 [목록으로]/뒤로가기 몫). 이 "취소의 취소" 경로는 언제나 성립하되, undo 대상은 **본문
   * BlockNote 인스턴스의 블록뿐**이다 — 제목은 별도의 `titleHistory`(전용 undo 스택, 위 U-2
   * 주석 참조)를 쓰므로 본문 Ctrl+Z가 제목을 되돌리지 않는다.
   */
  const performCancel = useCallback(() => {
    if (composingRef.current) {
      // 검토 경미 4 — 추적 가능한 ref에 재시도 타이머를 담아 언마운트 cleanup이 정리할 수
      // 있게 한다(추적 안 하면 죽은 편집기에 뒤늦게 replaceBlocks·PATCH가 발사된다). **경미
      // B** — `clearTimers()`는 건드리지 않는다(자동저장이 이 재시도를 조용히 지우면 [취소]가
      // 무시된다) — 이 ref는 여기(재무장)와 언마운트 cleanup(정리)에서만 손댄다.
      cancelRetryTimer.current = window.setTimeout(performCancel, IDLE_MS)
      return
    }
    cancelRetryTimer.current = null
    const snap = liveSnapshotRef.current
    if (!snap) return
    editor.replaceBlocks(editor.document, asEditorBlocks(snap.blocks.length > 0 ? snap.blocks : EMPTY_BLOCKS))
    sidecarRef.current = { ...snap.sidecar }
    setTitle(snap.title)
    titleRef.current = snap.title
    dirtyRef.current = true
    setState('dirty')
    setChangedFromSnapshot(true)
    // 명시 저장(규약 B — 상시 [저장]과 같은 flush)으로 복귀분을 즉시 서버에 반영하고,
    // 성공하면 체크포인트도 이 복귀 시점으로 다시 잡는다(commitLiveSnapshot).
    saveNow({ explicit: true })
  }, [editor, saveNow])

  const saveDisabled = state === 'clean' || state === 'saving'
  // 규약 C — 변경분(체크포인트 대비)이 없으면 비활성. 규약 E 상한 — 스냅샷 확보 실패 시 비활성.
  const cancelDisabled = !snapshotOk || !changedFromSnapshot

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
          ref={titleHistory.inputRef}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value)
            // 히스토리(U-2)와 저장 디바운스(규약 C)는 서로 다른 판정을 쓴다 — 각각 통지한다.
            titleHistory.recordChange(e.target.value)
            scheduleSave()
          }}
          onCompositionStart={() => {
            composingRef.current = true
            titleHistory.beginComposition()
          }}
          onCompositionEnd={() => {
            composingRef.current = false
            titleHistory.endComposition()
            if (dirtyRef.current) scheduleSave()
          }}
          // 포커스를 잃는 지점도 되돌림 경계로 삼는다(다시 돌아와 친 글자와 섞이지 않게).
          onBlur={titleHistory.commit}
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
        {/* FB-2(stage-39 규약 A·B) — 상시 [저장]/[취소]. 종전 "실패 시에만 지금 저장" 조건부
            버튼은 이 상시 [저장]으로 흡수됐다(문구·의미는 위 저장 상태 4종 그대로 병존). */}
        <button
          type="button"
          onClick={() => saveNow({ explicit: true })}
          disabled={saveDisabled}
          className="min-h-[36px] rounded bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          저장
        </button>
        <button
          type="button"
          onClick={() => setConfirmCancel(true)}
          disabled={cancelDisabled}
          className="min-h-[36px] rounded border border-border px-3 py-1.5 text-sm text-primary hover:bg-bg disabled:cursor-not-allowed disabled:text-muted"
        >
          취소
        </button>
        {!snapshotOk && snapshotErrorMessage && <span className="text-wrong">{snapshotErrorMessage}</span>}
      </div>

      {(uploadQueue.status.active || uploadQueue.status.failures.length > 0) && (
        <div
          role="status"
          className="flex flex-col gap-1 rounded border border-border bg-surface px-3 py-2 text-xs"
        >
          {uploadQueue.status.active && (
            <span className="text-muted">
              이미지 올리는 중 ({Math.min(uploadQueue.status.completed + 1, uploadQueue.status.total)}/
              {uploadQueue.status.total})…
            </span>
          )}
          {uploadQueue.status.failures.map((failure, idx) => (
            <span key={`${failure.name}-${idx}`} className="text-wrong">
              {failure.name}: {failure.message}
            </span>
          ))}
          {uploadQueue.status.failures.length > 0 && (
            <button
              type="button"
              onClick={uploadQueue.dismissFailures}
              className="self-start text-muted underline"
            >
              닫기
            </button>
          )}
        </div>
      )}

      {pasteNotice && (
        <div className="flex items-center justify-between gap-2 rounded border border-border bg-surface px-3 py-2 text-xs text-muted">
          <span>{pasteNotice}</span>
          <button type="button" onClick={() => setPasteNotice(null)} className="shrink-0 underline">
            닫기
          </button>
        </div>
      )}

      <div
        className="note-editor-frame"
        onCompositionStartCapture={() => {
          composingRef.current = true
        }}
        onCompositionEndCapture={() => {
          composingRef.current = false
          if (dirtyRef.current) scheduleSave()
        }}
        onDropCapture={(e) => {
          // 드래그앤드롭(규약 H 3진입점 중 하나) — 실제 OS 파일이 있을 때만 가로챈다. 내부
          // 블록 재배열 드래그는 File 객체를 싣지 않으므로 그대로 BlockNote 기본 동작에 맡긴다
          // (files.length === 0이면 preventDefault를 호출하지 않고 그냥 돌아간다).
          const files = Array.from(e.dataTransfer?.files ?? [])
          if (files.length === 0) return
          e.preventDefault()
          e.stopPropagation()
          const imageFiles = files.filter(isImageFile)
          if (imageFiles.length > 0) {
            uploadQueue.beginBatch(imageFiles.length)
            void insertUploadedImages(editor, imageFiles, uploadQueue.uploadFile)
          }
          // 비이미지 파일이 섞여 있으면 조용히 버리지 않는다 — 붙여넣기(paste.ts)와 같은 문구·
          // 같은 배너 경로(pasteNotice)를 공유한다(DoD 4·6).
          const skipped = files.length - imageFiles.length
          if (skipped > 0) setPasteNotice(describeSkippedNonImageFiles(skipped))
        }}
      >
        {/* 방언 툴바·참조 칩 피커(G-2 강제 지점 ① · G-4). `RefUiProvider`는 **BlockNoteView
            바깥**이어야 한다 — 칩 노드 뷰가 이 컨텍스트를 구독하고, 툴바가 닫혀도 피커는 살아
            있어야 하기 때문이다. 끄는 기본 UI는 서식 툴바·슬래시 메뉴·**사이드 메뉴** 3개이며
            셋 다 `NoteEditorDialectUI`가 방언 판을 다시 건다(사이드 메뉴는 stage-41 2차에서
            단(`column`)에서만 감추려고 되건 것 — 다른 블록은 코어와 동일하다). 링크 툴바·표
            핸들 등 나머지 기본 UI는 그대로 켜 둔다. */}
        <RefUiProvider editor={editor}>
          <BlockNoteView
            editor={editor}
            theme={theme}
            onChange={scheduleSave}
            formattingToolbar={false}
            slashMenu={false}
            // 사이드 메뉴는 `NoteEditorDialectUI`가 되건다(stage-41 2차 — 단에서만 감춤).
            sideMenu={false}
          >
            <NoteEditorDialectUI />
          </BlockNoteView>
        </RefUiProvider>
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

      {/* 규약 C — [취소]는 확인 없이 폐기하지 않는다(파괴적 조작 관례). */}
      {confirmCancel && (
        <ConfirmDialog
          title="편집 되돌리기"
          message="편집 내용을 되돌릴까요? 이 노트를 열었을 때의 상태로 복원되고, 그 사이 자동 저장된 내용도 함께 되돌아갑니다."
          confirmLabel="되돌리기"
          danger
          onConfirm={() => {
            setConfirmCancel(false)
            performCancel()
          }}
          onClose={() => setConfirmCancel(false)}
        />
      )}

      {/* 규약 E — 재진입에서 미폐기 스냅샷을 발견했을 때만(예기치 못한 종료). 조용한 자동
          선택은 없다 — 사용자가 둘 중 하나를 직접 고른다. */}
      {recoveryPrompt && (
        <Modal
          title="이전 편집 복구"
          onClose={() => {
            // 경미 3 — 결정 없이 닫아도(X·Esc·오버레이) "이어서 편집"과 동일하게 결정 완료로
            // 간주한다(비파괴 기본값). 이제부터는 정상 이탈에서 스냅샷을 지워도 된다.
            recoveryPendingRef.current = false
            setRecoveryPrompt(null)
          }}
        >
          <div className="flex flex-col gap-3">
            <p className="text-sm text-primary">
              이전 편집이 정상적으로 종료되지 않았습니다. 자동 저장된 내용을 이어서 편집할까요,
              편집을 시작하기 전 상태로 되돌릴까요?
            </p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => {
                  recoveryPendingRef.current = false
                  performCancel()
                  setRecoveryPrompt(null)
                }}
                className="rounded border border-border px-3 py-1.5 text-sm text-primary hover:bg-bg"
              >
                원본으로 되돌리기
              </button>
              <button
                type="button"
                onClick={() => {
                  recoveryPendingRef.current = false
                  setRecoveryPrompt(null)
                }}
                className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90"
              >
                이어서 편집
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
