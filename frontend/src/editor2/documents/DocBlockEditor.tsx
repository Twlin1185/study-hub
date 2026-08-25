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
import ConfirmDialog from '../../components/ConfirmDialog'
import Modal from '../../components/Modal'
import type { DocumentDetail, DocumentType } from '../../api/types'
import { ApiError } from '../../api/client'
import { useEditorTheme } from '../blocknote/schema'
import BlockSurface, { type BlockSurfaceHandle } from './BlockSurface'
import { readBlockFields, useUpdateDocumentBlocks, type DocumentBlocksPatch } from '../api/documents'
import { toBlockNoteBlocks } from '../adapter'
import { emptyDocument } from '../schema/blocks'
// 로드 재료 계산은 stage-36 F-1에서 `surfaceSource`로 공용화했다(DocEditor 통합 분기와 같은 판정을
// 쓰기 위해서 — 계산 내용은 stage-35 원본 그대로다).
import { loadSurface, type SurfaceLoad, type SurfaceSource } from './surfaceSource'
// stage-39 F-1 실측 편입분(2026-08-23 지시서 정정 — 규약 D·E) — 노트 편집(§5.16)과 동일 계약의
// 문서 표면 적용. 스냅샷 저장소는 노트 표면과 공유(`sessionSnapshotStorage`), 형태만 다르다.
import {
  clearDocBlockSnapshot,
  docBlockSnapshotsEqual,
  readDocBlockSnapshot,
  writeDocBlockSnapshot,
  type DocBlockSnapshot,
} from './docBlockSnapshot'

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

  // FB-2(stage-39 F-1 편입분) — 세션 원본 스냅샷(규약 E) · [취소](규약 C)의 복귀 기준점과
  // 동일 실체. `liveSnapshotRef`는 "지금 취소하면 무엇으로 돌아가는가"의 살아있는 값(체크포인트
  // — 진입 시점에서 시작해 명시 [저장]/[취소] 성공마다 그 시점으로 갱신), localStorage 사본은
  // 크래시 감지 전용이다(노트 표면과 동일 구조 — `NoteEditPage.tsx` 참조).
  const liveSnapshotRef = useRef<DocBlockSnapshot | null>(null)
  const [snapshotOk, setSnapshotOk] = useState(true)
  const [snapshotErrorMessage, setSnapshotErrorMessage] = useState<string | null>(null)
  // 체크포인트 이후 실제로 뭔가 바뀌었는지(저장 상태 4종의 dirty와는 별개).
  const [changedFromSnapshot, setChangedFromSnapshot] = useState(false)
  // 재진입에서 미폐기 스냅샷을 발견했을 때만 채워진다 — 복구 선택 다이얼로그(규약 E).
  const [recoveryPrompt, setRecoveryPrompt] = useState<DocBlockSnapshot | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)

  const questionLike = isQuestionLike(doc.type)

  const dirtyRef = useRef(false)
  const composingRef = useRef(false)
  const idleTimer = useRef<number | null>(null)
  const maxTimer = useRef<number | null>(null)
  // 검토 경미 4 — [취소]가 IME 조합 중이라 재시도로 미룬 타이머. 추적하지 않으면 언마운트
  // 뒤에도 살아남아 죽은 편집기에 restore·PATCH를 뒤늦게 쏘는 경로가 열린다.
  const cancelRetryTimer = useRef<number | null>(null)
  const inFlight = useRef(false)
  const convertedRef = useRef(converted)
  // 검토 경미 3 — React StrictMode(dev) 이중 마운트 방어(노트 표면과 동일 — `NoteEditPage.tsx`
  // 참조). 크래시 복구 결정이 나기 전에는 언마운트 정리가 스냅샷을 지우지 않게 막는다.
  const recoveryPendingRef = useRef(false)

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

  /**
   * 스냅샷 체크포인트를 (재)확보한다 — 진입 시점(생략 진입) · 명시 [저장] 성공 후 · [취소] 복귀
   * 성공 후에만 부른다(규약 E "세션 갱신 시 대체" — 자동 저장은 체크포인트를 옮기지 않는다. 그래야
   * 자동저장이 서버에 이미 반영한 분과 체크포인트가 계속 달라 크래시 복구가 의미 있게 동작한다).
   * 기록 실패 시 `snapshotOk=false` — 호출부가 [취소]를 비활성한다.
   */
  const commitLiveSnapshot = useCallback(
    (snap: DocBlockSnapshot) => {
      const ok = writeDocBlockSnapshot(loadedDocId, snap)
      liveSnapshotRef.current = snap
      setSnapshotOk(ok)
      setSnapshotErrorMessage(
        ok ? null : '이 브라우저에 편집 내용을 기록하지 못했습니다 — 취소를 쓸 수 없습니다.',
      )
      setChangedFromSnapshot(false)
    },
    [loadedDocId],
  )

  // 진입 시점 스냅샷 확보(마운트 1회) — 미폐기 스냅샷을 발견하면 크래시 복구 다이얼로그로,
  // 없거나 손상됐으면(또는 정상 종결 직후 그대로면) 조용히 새 체크포인트를 확보한다. 노트
  // 표면(`NoteEditPage.tsx`)과 동일 판정 — 여기서는 문서 표면의 편집 대상 필드 전체(제목·보기·
  // 정답·난이도·본문·해설)가 스냅샷 범위다(규약 E "블록 상태(제목 포함)"의 문서 표면 준용).
  useEffect(() => {
    const found = readDocBlockSnapshot(loadedDocId)
    const currentCompare = {
      title: doc.title,
      choices: (doc.choices ?? []).join('\n'),
      answer: doc.answer ?? '',
      difficulty: doc.difficulty != null ? String(doc.difficulty) : '',
      content: content.blocks,
      explanation: explanation ? explanation.blocks : null,
    }
    if (found && !docBlockSnapshotsEqual(found, currentCompare)) {
      liveSnapshotRef.current = found
      setSnapshotOk(true)
      setSnapshotErrorMessage(null)
      // 이미 로드된 내용(자동저장분)이 스냅샷과 다르다는 뜻 — [취소]가 곧바로 유효하다.
      setChangedFromSnapshot(true)
      // 결정 전 이탈(StrictMode 합성 언마운트 포함)로부터 스냅샷을 지킨다(경미 3).
      recoveryPendingRef.current = true
      setRecoveryPrompt(found)
    } else {
      commitLiveSnapshot({
        title: doc.title,
        choices: (doc.choices ?? []).join('\n'),
        answer: doc.answer ?? '',
        difficulty: doc.difficulty != null ? String(doc.difficulty) : '',
        content: { blocks: content.blocks, sidecar: content.sidecar },
        explanation: explanation ? { blocks: explanation.blocks, sidecar: explanation.sidecar } : null,
      })
    }
    // 마운트 1회만 — 호출부가 `key={doc.id}`로 문서별 새 인스턴스를 만든다(DocumentDetail.tsx).
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  /**
   * `explicit` = 사용자가 명시적으로 명한 저장(상시 [저장] 버튼·Ctrl+S — 규약 B: 같은 flush
   * 경로). 자동 저장(디바운스·최대 대기·실패 재시도)은 항상 `explicit=false`. 성공한 명시
   * 저장·[취소] 복귀만 스냅샷 체크포인트를 그 시점으로 옮긴다(규약 E).
   *
   * `onSaved` = 검토 중요 1 — 문서 표면 상단 [취소] 버튼(`performCancel({close:true})`)의
   * 닫기를 **저장 성공 후**로 미루기 위한 콜백. 정상 경로는 `onSuccess` 안(체크포인트 commit
   * 뒤)에서 부른다. 미뤄진 경로(IME 조합 중·직전 저장 비행 중)와 실패 재시도 경로는 `opts`를
   * 그대로 다음 `saveNow` 호출에 넘기므로 `onSaved`도 자연히 전파된다 — 재시도가 성공하는 순간
   * 그제서야 닫힌다. 실패 상태로 남아 있는 동안은 편집기가 열린 채 "저장 실패" 표시를 보여준다
   * (조용한 손실 경로 없음).
   */
  const saveNow = useCallback(
    (opts?: { explicit?: boolean; onSaved?: () => void }) => {
      clearTimers()
      if (!dirtyRef.current) {
        // 변경분이 없다 = 이미 저장된 상태(직전 저장이 방금 반영했거나 애초에 dirty가 아니었던
        // 경우) — 새로 보낼 것이 없으므로 이 자리에서 바로 완료로 취급한다(닫기가 무기한 보류될
        // 이유가 없다).
        opts?.onSaved?.()
        return
      }
      // 표면과 화면의 문서가 어긋났으면 **어느 문서에도 쓰지 않는다**(D-1 가드). 편집분은 dirty로
      // 남겨 두어 화면이 원래 문서로 돌아오면 다음 주기에 정상 저장된다. 이 경우 저장이 되지
      // 않았으므로 `onSaved`는 부르지 않는다(닫기를 유예 — 드문 인스턴스 재사용 상황).
      if (saveBlocked()) return
      // IME 조합 중이거나 직전 저장이 비행 중이면 버리지 않고 뒤로 미룬다(규약 C).
      if (composingRef.current || inFlight.current) {
        idleTimer.current = window.setTimeout(() => saveNow(opts), IDLE_MS)
        return
      }

      const patch = buildPatch()
      // 검토 경미 ⑤ — 체크포인트는 **이 저장이 실제로 실어 보낸 폼 값**이어야 한다.
      // `formRef.current`를 `onSuccess`(응답 도착 시점)에서 다시 읽으면, 요청이 비행 중인 동안
      // 사용자가 폼(제목·보기·정답·난이도)을 더 고친 경우 그 나중 값 — 즉 **이 요청으로 저장된
      // 적 없는 값** — 이 체크포인트가 되어 버린다. `mutate` 호출 **전**에 지역 상수로 캡처해
      // 클로저에 담아 둔다.
      const form = formRef.current
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
          if (opts?.explicit) {
            // 검토 중요 2 — `BlockSurface.snapshot()`(실 편집기 스키마 산출물)을 그대로 체크포인트에
            // 쓰면 재진입 로드분(`toBlockNoteBlocks`)과 구조가 달라(모든 블록의 `children`/`props`
            // 유무 차이·표 셀 표현 차이·경성 줄바꿈 런 분할 차이 등 — 실측: scratchpad 검증
            // 스크립트) `docBlockSnapshotsEqual`이 내용이 같아도 항상 false를 낸다. **방금 저장한
            // 그 앱 블록(`patch.content_blocks`/`patch.explanation_blocks`)을 다시
            // `toBlockNoteBlocks`로 되읽어** 재진입과 완전히 같은 함수·같은 형태를 만든다(노트
            // 표면과 동일 수정 — `NoteEditPage.tsx` 참조).
            if (patch.content_blocks !== undefined) {
              const reloadedContent = toBlockNoteBlocks(patch.content_blocks)
              // 해설: 이 저장에 해설 쌍이 없었으면(질문형이 아니거나 애초에 안 보냈으면) `undefined`
              // — 스냅샷에도 해설이 없다. `null`(해설을 비워 제거)은 빈 문서로 재읽는다.
              const reloadedExplanation =
                patch.explanation_blocks === undefined
                  ? undefined
                  : toBlockNoteBlocks(patch.explanation_blocks ?? emptyDocument())
              const contentOk = reloadedContent.unsupported.length === 0
              const explanationOk =
                reloadedExplanation === undefined || reloadedExplanation.unsupported.length === 0
              // unsupported면(이론상 발생하지 않는다 — 방금 편집기에서 나온 데이터다) 재커밋을
              // 건너뛴다 — 이전 체크포인트가 남는 편이 형태를 모르는 값을 쓰는 것보다 안전하다.
              if (contentOk && explanationOk) {
                commitLiveSnapshot({
                  // 검토 경미 A — 폼 필드도 블록과 같은 "같은 경로를 태운다" 원칙: raw form 값이
                  // 아니라 **실제로 보낸(정규화된) 값**을 체크포인트에 쓴다. 그래야 재진입 로드분
                  // (서버가 정규화해 돌려준 값)과 항등이 성립한다(보기 끝 빈 줄·제목 끝 공백 등
                  // 좁은 잔여 거짓 다이얼로그 재현 — patch.title/choices/difficulty는 이미
                  // trim·split·filter·Number 정규화를 거쳤다).
                  title: patch.title ?? '',
                  choices: (patch.choices ?? []).join('\n'),
                  answer: form.answer,
                  difficulty: patch.difficulty != null ? String(patch.difficulty) : '',
                  content: { blocks: reloadedContent.blocks, sidecar: reloadedContent.sidecar },
                  explanation: reloadedExplanation
                    ? { blocks: reloadedExplanation.blocks, sidecar: reloadedExplanation.sidecar }
                    : null,
                })
              }
            }
          }
          // 검토 중요 1 — 체크포인트 commit까지 끝난 뒤에만 완료를 알린다(닫기는 저장 성공 후).
          opts?.onSaved?.()
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
          // 검토 경미 ⑥ — `opts`(명시 저장 여부)를 재시도에도 그대로 넘긴다. `saveNow`만 넘기면
          // 재시도가 성공해도 `opts?.explicit`가 사라져 명시 저장의 재시도 성공이 체크포인트를
          // 옮기지 못한다.
          maxTimer.current = window.setTimeout(() => saveNow(opts), RETRY_MS)
        },
      })
    },
    [buildPatch, clearTimers, saveBlocked, updateDocument, commitLiveSnapshot],
  )

  const scheduleSave = useCallback(() => {
    dirtyRef.current = true
    setState((prev) => (prev === 'saving' ? prev : 'dirty'))
    // 체크포인트(스냅샷) 대비 달라졌다 — [취소](규약 C)가 이제 의미를 갖는다. 자동 저장이
    // 성공해도(저장 상태는 clean으로 돌아가도) 이 값은 되돌리지 않는다.
    setChangedFromSnapshot(true)
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
        // 규약 B — Ctrl+S는 상시 [저장] 버튼과 **같은 명시 저장**이다(체크포인트도 함께 갱신).
        saveNow({ explicit: true })
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
      // 검토 경미 B — `cancelRetryTimer`는 `clearTimers()`가 건드리지 않으므로(자동저장이
      // 진행 중인 [취소] 재시도를 지워버리지 않게) 진짜 이탈인 여기서만 명시적으로 정리한다.
      if (cancelRetryTimer.current !== null) {
        window.clearTimeout(cancelRetryTimer.current)
        cancelRetryTimer.current = null
      }
      // 규약 E — 명시 버튼 없는 정상 이탈(목록 이동·"편집 종료" 등)도 유지 확정으로 간주해
      // 스냅샷을 지운다(자동 저장이 이미 서버에 반영). 지우지 않으면 다음 진입에서 거짓 복구
      // 다이얼로그가 뜬다(DoD 4·5 — 거짓 다이얼로그 0). **단, 크래시 복구 결정이 아직 나지
      // 않은 동안은 지우지 않는다**(경미 3 — StrictMode(dev) 합성 언마운트 방어. 노트 표면과
      // 동일 사유 — `NoteEditPage.tsx` 참조).
      if (!recoveryPendingRef.current) clearDocBlockSnapshot(loadedDocId)
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

  /**
   * [취소](규약 C — ② 확정: 편집 세션 진입 시점 원본 스냅샷 복귀) — 체크포인트로 편집기
   * 문서(본문·해설)·제목·보기·정답·난이도를 되돌린 뒤 **저장**한다(자동저장이 이미 서버에
   * 쓴 분까지 물린다). IME 조합 중이면 본문이 다치지 않게 조합이 끝난 뒤로 미룬다.
   *
   * FB-12 — `opts.close`가 true면(문서 표면 상단 [취소] 버튼) 되돌리기가 **저장까지 성공한
   * 뒤에만**(`saveNow`의 `onSaved` 콜백) `onClose()`를 불러 편집을 종료한다("취소했는데 편집이
   * 안 끝난다"는 사용자 피드백 — 문서 표면에는 별도의 [편집 종료]가 있어 [취소]는 종전에
   * 되돌리기만 하고 계속 편집 상태였다). **검토 중요 1** — 종전에는 `saveNow` 디스패치 직후
   * 동기 `onClose()`를 불러 편집기가 곧바로 언마운트됐다. 이러면 저장이 실패해도(네트워크 오류
   * 등) `useMutation`의 `hasListeners()` 게이트로 `onError`가 조용히 무시되고(TanStack Query
   * 계약 — 구독자 없는 뮤테이션의 콜백은 호출되지 않는다), 언마운트 cleanup은
   * `clearDocBlockSnapshot`으로 스냅샷까지 지워 재진입 [취소]로도 원본 복귀가 불가능했다(조용한
   * 손실 경로). 지금은 저장이 실패하면 편집기가 열린 채 기존 "저장 실패" 표시 + 자동 재시도가
   * 돌고, 재시도가 성공하는 순간에만 `onSaved`(=`onClose`)가 불린다 — 스냅샷은 그동안 보존된다.
   * **복구 다이얼로그의 "원본으로 되돌리기"는 `close` 없이(`performCancel()`) 부른다** — 그쪽은
   * 편집을 계속하는 게 맞다(재진입 직후라 아직 아무것도 손대지 않았고, 사용자가 이어서 작업할
   * 자리다).
   *
   * 되돌리기는 `BlockSurface.restore`(→ `editor.replaceBlocks`)로 이뤄지며, BlockNote는
   * `editor.transact`로 감싼 변경을 **단일 undo 스텝**으로 묶는다(엔진 실측 —
   * `@blocknote/core` `BlockManager.replaceBlocks`가 `editor.transact(...)`를 거치고,
   * `transact`의 JSDoc이 "그룹 변경 = 단일 undo step"임을 명시). **⑧ undo 범위 정정** — 이
   * "취소의 취소"는 **복구 다이얼로그의 "원본으로 되돌리기" 경로(편집 유지·`close` 없음)에
   * 한해서만** 성립한다. 문서 표면 상단 [취소] 버튼(`close: true`) 경로는 저장 성공 후 곧바로
   * 편집기가 언마운트되므로(닫힘) Ctrl+Z를 받을 표면 자체가 사라져 이 경로에는 해당하지 않는다.
   * 성립하는 경로에서도 undo 대상은 **포커스된 본문 표면(BlockSurface)의 블록뿐**이다 — 해설
   * 표면은 별도의 BlockNote 인스턴스라 독립된 히스토리를 가지고, 제목·보기·정답·난이도는 React
   * state라 애초에 BlockNote undo 스택 밖이다.
   */
  const performCancel = useCallback(
    (opts?: { close?: boolean }) => {
      if (composingRef.current) {
        // 검토 경미 4 — 추적 가능한 ref에 재시도 타이머를 담아 언마운트 cleanup이 정리할 수
        // 있게 한다(추적 안 하면 죽은 편집기에 뒤늦게 restore·PATCH가 발사된다). **경미 B** —
        // `clearTimers()`는 건드리지 않는다(자동저장이 이 재시도를 조용히 지우면 [취소]가
        // 무시된다) — 이 ref는 여기(재무장)와 언마운트 cleanup(정리)에서만 손댄다.
        // FB-12 — `opts`(close 여부)를 재시도에도 그대로 넘긴다. **여기(early return)에서는
        // 절대 닫지 않는다** — 닫으면 언마운트 cleanup이 이 재시도 타이머를 지워 되돌리기가
        // 영영 일어나지 않는다.
        cancelRetryTimer.current = window.setTimeout(() => performCancel(opts), IDLE_MS)
        return
      }
      cancelRetryTimer.current = null
      const snap = liveSnapshotRef.current
      if (!snap) return
      contentRef.current?.restore(snap.content)
      if (snap.explanation) explanationRef.current?.restore(snap.explanation)
      setTitle(snap.title)
      setChoices(snap.choices)
      setAnswer(snap.answer)
      setDifficulty(snap.difficulty)
      // 검토 치명 1 — `formRef.current`는 렌더 중에만 갱신되므로, 위 setState 직후 같은
      // 이벤트 핸들러 안에서 곧바로 `saveNow`(→ `buildPatch`)를 부르면 아직 **편집분(되돌리기
      // 이전) 값**을 읽는다. 화면은 복귀돼 보여도 서버엔 편집분이 남고, 그 값으로
      // commitLiveSnapshot이 체크포인트를 잡아 [취소]가 비활성되며 재진입 시 편집분이 부활한다.
      // `saveNow` 호출 **전에** formRef를 직접 스냅샷 값으로 맞춘다(노트 표면의
      // `titleRef.current = snap.title` 패턴과 동일).
      formRef.current = {
        title: snap.title,
        choices: snap.choices,
        answer: snap.answer,
        difficulty: snap.difficulty,
      }
      dirtyRef.current = true
      setState('dirty')
      setChangedFromSnapshot(true)
      // 명시 저장(규약 B — 상시 [저장]과 같은 flush)으로 복귀분을 즉시 서버에 반영하고,
      // 성공하면 체크포인트도 이 복귀 시점으로 다시 잡는다(commitLiveSnapshot).
      // 검토 중요 1 — `opts.close`가 true면 **저장이 실제로 성공한 뒤에만**(`onSaved` 콜백)
      // `onClose()`를 부른다. 종전에는 이 호출 직후 동기적으로 닫아 실패를 무음 처리하고
      // 스냅샷까지 지워 버렸다(위 JSDoc 참조) — 이제는 `saveNow`가 미룸(IME/inFlight)·재시도
      // (onError)에도 `opts`를 그대로 넘기므로, 재시도가 성공하는 순간까지 편집기가 열려 있고
      // 그동안 스냅샷도 보존된다. `dirtyRef.current`가 false라 `saveNow`가 조기 return 하는
      // 경우도 있는데(예: 되돌린 값이 이미 서버 상태와 같아 위에서 다시 dirty=true로 세팅하지
      // 않았다면) — 바로 위에서 `dirtyRef.current = true`를 항상 세팅하므로 이 표면 상단 [취소]
      // 경로에서는 그 조기 return이 발생하지 않는다(확인됨). 그래도 `saveNow` 쪽에 방어적으로
      // 조기 return 시 `onSaved`를 호출하는 처리를 남겨 뒀다(이미 저장된 상태로 취급).
      saveNow({ explicit: true, onSaved: opts?.close ? onClose : undefined })
    },
    [saveNow, onClose],
  )

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
            className={`min-h-[36px] rounded border px-2 py-1 text-sm ${
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
            className="min-h-[36px] rounded border border-border px-2 py-1 text-sm text-primary hover:bg-bg"
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
        {/* FB-2(stage-39 규약 A·B — F-1 실측 편입분) — 상시 [저장]/[취소]. 종전 "실패 시에만
            지금 저장" 조건부 버튼은 이 상시 [저장]으로 흡수됐다(문구·의미는 저장 상태 4종 그대로
            병존). "편집 종료"(저장+닫기)는 별개 성격으로 위 제목 행에 그대로 둔다. */}
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

      {/* 규약 C — [취소]는 확인 없이 폐기하지 않는다(파괴적 조작 관례). */}
      {confirmCancel && (
        <ConfirmDialog
          title="편집 되돌리기"
          message="편집 내용을 되돌리고 편집을 종료합니다. 이 문서를 열었을 때의 상태로 복원되고, 그 사이 자동 저장된 내용도 함께 되돌아갑니다."
          confirmLabel="되돌리기"
          danger
          onConfirm={() => {
            setConfirmCancel(false)
            // FB-12 — 문서 표면의 [취소]는 되돌리기 + 편집 종료다(별도 [편집 종료]가 있으므로
            // [취소]는 되돌린 뒤 계속 편집할 이유가 없다).
            performCancel({ close: true })
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
