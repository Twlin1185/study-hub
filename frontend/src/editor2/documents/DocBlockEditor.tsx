// 문서 편집 — 새 편집기 표면(S35 · stage-35 F-2·F-3 · 규약 D·E·F).
//
// 진입점은 **문서 상세(`/docs/:id`)의 [편집] 1곳**뿐이며, 이 모듈은 그 자리에서 lazy 청크로
// 들어온다(R37 — 초기 청크 증가 ≤ 5KB). 골격은 노트 편집(§5.16)을 그대로 가져왔다:
//   · 본문·해설 **2표면**(BlockSurface) + 제목·보기·정답·난이도·문서 스타일은 **기존 폼 유지**
//     (표면 통합은 M35 — 별지 D7 대기)
//   · 자동 저장(유휴 1.5초·최대 대기 10초) · 저장 상태 4종 · IME 조합 중 보류 · Ctrl+S · beforeunload
//   · 저장 = `PATCH { content_blocks, content }` (+해설 편집 시 `{ explanation_blocks, explanation }`)
//     — **블록과 프로젝션은 항상 함께**(§4.29 ② 동반 규칙 2쌍)
//
// 지연 전환(규약 E): **열람·편집 진입은 DB를 쓰지 않는다**. 미전환 문서는 `content`를 메모리에서
// 블록으로 변환해 표면에 올리고, **블록 쌍을 처음 동반한 저장이 곧 전환**이다. 변환이 미지원
// 사유를 보고하면 이 표면을 열지 않고 **구 편집기(완전한 편집 경로)로 퇴로**를 잡는다.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import MarkdownView from '../../components/MarkdownView'
import type { DocumentDetail, DocumentType } from '../../api/types'
import { ApiError } from '../../api/client'
import { useEditorTheme } from '../blocknote/schema'
import BlockSurface, { type BlockSurfaceHandle } from './BlockSurface'
import { readBlockFields, useUpdateDocumentBlocks, type DocumentBlocksPatch } from '../api/documents'
// 로드 재료 계산은 stage-36 F-1에서 `surfaceSource`로 공용화했다(DocEditor 통합 분기와 같은 판정을
// 쓰기 위해서 — 계산 내용은 stage-35 원본 그대로다).
import { loadSurface, type SurfaceLoad, type SurfaceSource } from './surfaceSource'

/** 규약 C(노트) 계승 — 유휴 1.5초 · 최대 대기 10초 · 실패 후 재시도 5초. */
const IDLE_MS = 1500
const MAX_WAIT_MS = 10000
const RETRY_MS = 5000

type SaveState = 'clean' | 'dirty' | 'saving' | 'error'

function isQuestionLike(type: DocumentType): boolean {
  return type === 'question' || type === 'past_question'
}

interface PreparedDocument {
  /** **로드 시점의 문서 id** — 표면에 올라간 본문의 주인이다(검토 D-1 가드의 기준). */
  docId: number
  content: SurfaceLoad
  explanation: SurfaceLoad | null
  /** 로드 시점의 전환 여부 — 최초 전환 1회 안내(규약 E)의 기준. */
  converted: boolean
}

function prepareDocument(doc: DocumentDetail): PreparedDocument {
  const fields = readBlockFields(doc)
  return {
    docId: doc.id,
    content: loadSurface(fields.content_blocks, doc.content),
    // 해설 표면은 기존 폼과 같은 조건(문제·기출)에서만 연다 — 개념 문서의 해설은 종전대로
    // 편집 대상이 아니며, 보내지 않으므로 전환 해제(§4.29 ④)도 일어나지 않는다.
    explanation: isQuestionLike(doc.type)
      ? loadSurface(fields.explanation_blocks, doc.explanation)
      : null,
    converted: fields.blocks_version != null,
  }
}

interface DocBlockEditorProps {
  doc: DocumentDetail
  onClose: () => void
  /** 메모리 변환이 미지원 사유를 보고했다 — 부모가 구 편집기로 퇴로를 잡는다(규약 E). */
  onUnsupported: (reason: string) => void
}

export default function DocBlockEditor({ doc, onClose, onUnsupported }: DocBlockEditorProps) {
  // 로드 계산은 **마운트 1회로 고정**한다 — 저장 뒤 상세 쿼리가 갱신돼 `doc`이 새 객체로 와도
  // 편집 중인 표면을 다시 만들지 않는다(편집분 되감기 0).
  const [prepared] = useState(() => prepareDocument(doc))

  const contentFailed = !prepared.content.ok
  const explanationFailed = prepared.explanation != null && !prepared.explanation.ok

  useEffect(() => {
    if (!contentFailed && !explanationFailed) return
    const reasons = [
      !prepared.content.ok ? `본문: ${prepared.content.reason}` : null,
      prepared.explanation && !prepared.explanation.ok ? `해설: ${prepared.explanation.reason}` : null,
    ].filter(Boolean)
    onUnsupported(reasons.join(' · '))
    // 로드 1회 판정 — 재실행할 이유가 없다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentFailed, explanationFailed])

  if (!prepared.content.ok || (prepared.explanation != null && !prepared.explanation.ok)) {
    return <p className="p-4 text-sm text-muted">기존 편집기로 여는 중…</p>
  }

  return (
    <DocBlockEditorSurface
      doc={doc}
      loadedDocId={prepared.docId}
      content={prepared.content.source}
      explanation={prepared.explanation ? prepared.explanation.source : null}
      converted={prepared.converted}
      onClose={onClose}
    />
  )
}

interface SurfaceProps {
  doc: DocumentDetail
  /** 표면에 올라간 본문의 주인 문서 id(로드 시점 고정) — 저장 가드의 기준. */
  loadedDocId: number
  content: SurfaceSource
  explanation: SurfaceSource | null
  converted: boolean
  onClose: () => void
}

function DocBlockEditorSurface({ doc, loadedDocId, content, explanation, converted, onClose }: SurfaceProps) {
  const theme = useEditorTheme()
  const updateDocument = useUpdateDocumentBlocks()

  const contentRef = useRef<BlockSurfaceHandle | null>(null)
  const explanationRef = useRef<BlockSurfaceHandle | null>(null)

  // 나머지 필드는 **기존 폼 그대로**(DocEditor와 같은 표현 — 제목·보기·정답·난이도).
  // 문서 스타일(F53 ②)은 손대지 않는다 — 문서 상세에 이미 전용 카드(DocStyleSection)가 있어
  // 여기서 또 보내면 두 곳이 같은 필드를 두고 다툰다(자동 저장이 낡은 값을 되돌릴 위험).
  const [title, setTitle] = useState(doc.title)
  const [choices, setChoices] = useState((doc.choices ?? []).join('\n'))
  const [answer, setAnswer] = useState(doc.answer ?? '')
  const [difficulty, setDifficulty] = useState(doc.difficulty != null ? String(doc.difficulty) : '')

  const [state, setState] = useState<SaveState>('clean')
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [preview, setPreview] = useState(false)
  const [projection, setProjection] = useState(doc.content ?? '')
  // 최초 전환 1회 안내(규약 E) — 미전환으로 열린 문서가 처음 블록과 함께 저장된 순간에만.
  const [convertedNotice, setConvertedNotice] = useState(false)

  const questionLike = isQuestionLike(doc.type)

  const dirtyRef = useRef(false)
  const composingRef = useRef(false)
  const idleTimer = useRef<number | null>(null)
  const maxTimer = useRef<number | null>(null)
  const inFlight = useRef(false)
  const convertedRef = useRef(converted)

  // 최신 폼 값을 저장 시점에 읽는다(타이머 클로저가 낡은 값을 붙잡지 않게).
  const formRef = useRef({ title, choices, answer, difficulty })
  formRef.current = { title, choices, answer, difficulty }

  // **저장 가드(검토 D-1 이중 방어 ②)** — 이 표면에 올라간 본문은 `loadedDocId`의 것이다.
  // 호출부가 `key`를 잊어 같은 인스턴스가 **다른 문서**를 받게 되면(문서 상세는 라우트가 같아
  // 언마운트되지 않는다) 저장이 남의 문서를 덮어쓴다 — 그런 상태에서는 **아무 데도 쓰지 않는다**.
  const currentDocIdRef = useRef(doc.id)
  currentDocIdRef.current = doc.id
  const saveBlocked = useCallback(() => {
    if (currentDocIdRef.current === loadedDocId) return false
    console.warn(
      `[editor2] 편집 표면이 로드한 문서(id=${loadedDocId})와 화면의 문서(id=${currentDocIdRef.current})가 달라 저장을 중단합니다.`,
    )
    return true
  }, [loadedDocId])

  const clearTimers = useCallback(() => {
    if (idleTimer.current !== null) window.clearTimeout(idleTimer.current)
    if (maxTimer.current !== null) window.clearTimeout(maxTimer.current)
    idleTimer.current = null
    maxTimer.current = null
  }, [])

  /**
   * 저장 페이로드 — **블록과 프로젝션을 항상 함께**(§4.29 ② 동반 규칙 2쌍).
   * 본문 쌍은 언제나 싣고, 해설 쌍은 해설 표면이 열려 있을 때만 싣는다(두 쌍은 서로 독립).
   * 해설이 비면 `explanation_blocks: null` + `explanation: ''` = 해설 블록 제거(전환은 유지).
   *
   * **해설을 블록 없이 보내지 않는다** — 그렇게 보내면 서버가 전환 해제(3컬럼 NULL)를 수행한다.
   */
  const buildPatch = useCallback((): DocumentBlocksPatch => {
    const form = formRef.current
    const body = contentRef.current?.build()
    const patch: DocumentBlocksPatch = {
      // 저장 대상은 **로드한 문서**다(화면의 현재 doc이 아니라). 둘이 어긋난 상황은 위
      // `saveBlocked`가 이미 막지만, 대상 id도 로드 시점 값으로 고정해 둔다.
      id: loadedDocId,
      difficulty: form.difficulty ? Number(form.difficulty) : null,
    }
    // 제목은 서버 계약상 1자 이상이다 — 비어 있으면 **보내지 않는다**(422로 자동 저장이 계속
    // 실패하는 대신, 화면에 "저장되지 않습니다" 경고를 띄워 사용자가 알고 고치게 한다).
    if (form.title.trim()) patch.title = form.title.trim()
    if (body) {
      patch.content_blocks = body.blocks
      patch.content = body.markdown
    }
    if (questionLike) {
      patch.choices = form.choices.split('\n').map((c) => c.trim()).filter(Boolean)
      patch.answer = form.answer
      const expl = explanationRef.current?.build()
      if (expl) {
        if (expl.markdown.trim() === '') {
          patch.explanation_blocks = null
          patch.explanation = ''
        } else {
          patch.explanation_blocks = expl.blocks
          patch.explanation = expl.markdown
        }
      }
    }
    return patch
  }, [loadedDocId, questionLike])

  const saveNow = useCallback(() => {
    clearTimers()
    if (!dirtyRef.current) return
    // 표면과 화면의 문서가 어긋났으면 **어느 문서에도 쓰지 않는다**(D-1 가드). 편집분은 dirty로
    // 남겨 두어 화면이 원래 문서로 돌아오면 다음 주기에 정상 저장된다.
    if (saveBlocked()) return
    // IME 조합 중이거나 직전 저장이 비행 중이면 버리지 않고 뒤로 미룬다(규약 C).
    if (composingRef.current || inFlight.current) {
      idleTimer.current = window.setTimeout(saveNow, IDLE_MS)
      return
    }

    const patch = buildPatch()
    if (patch.content != null) setProjection(patch.content)
    dirtyRef.current = false
    inFlight.current = true
    setState('saving')
    updateDocument.mutate(patch, {
      onSuccess: () => {
        inFlight.current = false
        setSavedAt(new Date())
        setErrorMessage(null)
        setState(dirtyRef.current ? 'dirty' : 'clean')
        if (!convertedRef.current) {
          convertedRef.current = true
          setConvertedNotice(true)
        }
      },
      onError: (error) => {
        inFlight.current = false
        // 로컬 편집분을 버리지 않는다 — 다시 dirty로 돌리고 다음 주기에 재시도.
        dirtyRef.current = true
        setErrorMessage(
          error instanceof ApiError
            ? error.message
            : error instanceof Error
              ? error.message
              : '문서를 저장하지 못했습니다',
        )
        setState('error')
        maxTimer.current = window.setTimeout(saveNow, RETRY_MS)
      },
    })
  }, [buildPatch, clearTimers, saveBlocked, updateDocument])

  const scheduleSave = useCallback(() => {
    dirtyRef.current = true
    setState((prev) => (prev === 'saving' ? prev : 'dirty'))
    if (composingRef.current) return
    if (idleTimer.current !== null) window.clearTimeout(idleTimer.current)
    idleTimer.current = window.setTimeout(saveNow, IDLE_MS)
    if (maxTimer.current === null) maxTimer.current = window.setTimeout(saveNow, MAX_WAIT_MS)
  }, [saveNow])

  const handleComposition = useCallback(
    (active: boolean) => {
      composingRef.current = active
      if (!active && dirtyRef.current) scheduleSave()
    },
    [scheduleSave],
  )

  // Ctrl+S 명시 저장
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

  // 미저장 상태로 이탈하면 경고
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  // 표면을 떠날 때 남은 편집분을 흘려보내지 않는다(타이머가 죽기 전 마지막 저장 — 노트와 동일).
  //
  // **`useLayoutEffect`여야 한다(검토 D-8 — 실측)**: 이 flush는 자식 `BlockSurface`의
  // `useImperativeHandle` 핸들(`contentRef`/`explanationRef`)로 본문·해설을 꺼낸다. 그런데
  // **passive(useEffect) cleanup은 자식 ref가 이미 떨어진 뒤에 돈다** — 그 자리에서는 `build()`를
  // 부를 대상이 없어 PATCH에 `content_blocks/content` 쌍이 통째로 빠지고, 마지막 미저장 편집분이
  // 조용히 사라진다. 레이아웃 cleanup은 삭제 traversal(부모 → 자식) 안에서 돌기 때문에 자식 ref가
  // 아직 살아 있다. 노트 화면은 편집기를 **자기 컴포넌트 안에서** 만들어(editor.document 직접 접근)
  // 이 함정이 없었다 — 표면을 2개로 쪼개면서 새로 생긴 조건이다.
  const buildPatchRef = useRef(buildPatch)
  buildPatchRef.current = buildPatch
  const mutateRef = useRef(updateDocument.mutate)
  mutateRef.current = updateDocument.mutate
  const saveBlockedRef = useRef(saveBlocked)
  saveBlockedRef.current = saveBlocked
  useLayoutEffect(
    () => () => {
      clearTimers()
      // 마지막 저장에도 같은 가드를 건다(D-1) — 문서가 어긋난 채로는 흘려보내지 않는다.
      if (!dirtyRef.current || saveBlockedRef.current()) return
      const patch = buildPatchRef.current()
      // 본문 쌍이 비어 있으면(핸들이 이미 떨어진 예상 밖 상황) **부분 저장을 하지 않는다** —
      // content 키가 아예 없는 부분 PATCH는 서버 강등(§4.29 ④)을 부르지는 않지만(강등 조건 =
      // content 동반 · 블록 미동반), 제목·보기만 저장되고 본문 편집분은 소리 없이 빠지는
      // "성공처럼 보이는 절반짜리 저장"이 된다. 어느 쪽도 쓰지 않는 편이 안전하다.
      if (patch.content_blocks === undefined) {
        console.warn('[editor2] 편집 표면 핸들이 사라져 마지막 저장을 건너뜁니다(부분 저장 방지).')
        return
      }
      mutateRef.current(patch)
    },
    // 언마운트 1회만.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const openPreview = () => {
    const body = contentRef.current?.build()
    if (body) setProjection(body.markdown)
    setPreview(true)
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

  const titleEmpty = !title.trim()

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value)
            scheduleSave()
          }}
          onCompositionStart={() => handleComposition(true)}
          onCompositionEnd={() => handleComposition(false)}
          placeholder="제목"
          aria-label="제목"
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
            onClick={() => {
              saveNow()
              onClose()
            }}
            className="rounded border border-border px-2 py-1 text-sm text-primary hover:bg-bg"
          >
            편집 종료
          </button>
        </div>
      </div>

      {titleEmpty && (
        <p className="text-xs text-wrong">제목은 비워 둘 수 없습니다 — 비어 있는 동안 제목은 저장되지 않습니다.</p>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={state === 'error' ? 'text-wrong' : 'text-muted'}>{statusText}</span>
        {state === 'error' && errorMessage && <span className="text-wrong">{errorMessage}</span>}
        {state === 'error' && (
          <button type="button" onClick={saveNow} className="rounded border border-border px-2 py-0.5 text-primary">
            지금 저장
          </button>
        )}
        {convertedNotice && (
          <span className="text-muted">
            새 편집기 형식으로 전환했습니다 — 기존 Markdown 본문도 함께 저장되어 읽기·퀴즈·인쇄·검색은 그대로입니다.
          </span>
        )}
      </div>

      {notice && (
        <div className="flex items-center justify-between gap-2 rounded border border-border bg-surface px-3 py-2 text-xs text-muted">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="shrink-0 underline">
            닫기
          </button>
        </div>
      )}

      <BlockSurface
        ref={contentRef}
        label={questionLike ? '지문 (본문)' : '본문'}
        initialBlocks={content.blocks}
        sidecar={content.sidecar}
        theme={theme}
        onChange={scheduleSave}
        onNotice={setNotice}
        onComposition={handleComposition}
      />

      {questionLike && (
        <>
          <label className="flex flex-col gap-1 text-sm text-primary">
            보기 (줄바꿈으로 구분)
            <textarea
              value={choices}
              onChange={(e) => {
                setChoices(e.target.value)
                scheduleSave()
              }}
              onCompositionStart={() => handleComposition(true)}
              onCompositionEnd={() => handleComposition(false)}
              rows={4}
              className="rounded border border-border bg-surface px-3 py-2 text-sm text-primary outline-none focus:border-accent"
              placeholder={'보기1\n보기2'}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-primary">
            정답
            <input
              value={answer}
              onChange={(e) => {
                setAnswer(e.target.value)
                scheduleSave()
              }}
              onCompositionStart={() => handleComposition(true)}
              onCompositionEnd={() => handleComposition(false)}
              className="rounded border border-border bg-surface px-3 py-2 text-sm text-primary outline-none focus:border-accent"
            />
          </label>
        </>
      )}

      {explanation && (
        <BlockSurface
          ref={explanationRef}
          label="해설"
          initialBlocks={explanation.blocks}
          sidecar={explanation.sidecar}
          theme={theme}
          onChange={scheduleSave}
          onNotice={setNotice}
          onComposition={handleComposition}
        />
      )}

      <label className="flex flex-col gap-1 text-sm text-primary">
        난이도 (1~5, 선택)
        <input
          type="number"
          min={1}
          max={5}
          value={difficulty}
          onChange={(e) => {
            setDifficulty(e.target.value)
            scheduleSave()
          }}
          className="rounded border border-border bg-surface px-3 py-2 text-sm text-primary outline-none focus:border-accent"
        />
      </label>

      {preview && (
        <section className="rounded-lg border border-border bg-surface p-4">
          <h2 className="mb-2 text-xs font-semibold text-muted">Markdown 미리보기 (저장되는 프로젝션)</h2>
          <MarkdownView content={projection} docNo={doc.doc_no} />
        </section>
      )}
    </div>
  )
}
