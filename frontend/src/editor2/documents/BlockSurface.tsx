// 블록 편집 표면 1개 — 노트 편집(§5.16)의 편집기 골격을 **본문·해설 2표면**이 공유하도록
// 뽑아낸 재사용 조각(stage-35 F-2 · 규약 D·F).
//
// 이 조각이 책임지는 것(노트 화면과 같은 규약 그대로):
//   ① BlockNote 인스턴스 생성(같은 `noteSchema`·한국어 사전·붙여넣기 핸들러·이미지 업로드)
//   ② **세션 사이드카** 보관 — 로드 때 받은 흡수분 + 붙여넣기로 합류한 흡수분
//   ③ 저장용 본문 만들기 = **`fromBlockNoteResult` 경유**(사이드카 동반 — 규약 D. 사이드카 없이
//      역변환하면 흡수 7종(경성 줄바꿈·link title·image title/height·block meta·느슨한 목록·
//      목록 그룹 경계·표 열 정렬)이 **조용히** 사라진다)
//   ④ 조용히 버리지 않는다 = 표 정렬 폐기·마이크로 마크 접힘·붙여넣기/드롭 안내를 부모 배너로 보고
//   ⑤ IME 조합 상태를 부모에 통지(조합 중 저장 보류 — 규약 C 계승)
//
// **사이드카는 표면마다 따로다**: 본문·해설은 각각 `markdownToBlocks`가 `b1,b2,…`를 결정적으로
// 발급하므로 두 표면의 블록 id는 서로 겹친다. 사이드카를 공유하면 본문의 링크 제목이 해설의
// 같은 번호 블록에 붙는 오염이 생긴다 — 인스턴스마다 자기 것만 들고 있게 해서 원천 차단한다(F-4).
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react'
import { BlockNoteView } from '@blocknote/mantine'
import { useCreateBlockNote } from '@blocknote/react'
import '@blocknote/mantine/style.css'
// 편집 표면 스타일(BlockNote 색을 tokens.css 변수로 결선 — 불변 규칙 5). 노트 화면과 같은 파일을
// 그대로 쓴다(문서용 색 토큰 신설 0).
import '../blocknote/notes.css'
import { blocksToMarkdown } from '../transform'
import { fromBlockNoteResult, type AdapterSidecar, type BnBlock, type MicroMark } from '../adapter'
import type { BlockDocument } from '../schema/blocks'
import { asAdapterBlocks, asEditorBlocks, noteDictionary, noteSchema } from '../blocknote/schema'
import { createPasteHandler } from '../blocknote/paste'
import { NoteEditorDialectUI, RefUiProvider } from '../blocknote/ui'
import {
  describeSkippedNonImageFiles,
  insertUploadedImages,
  isImageFile,
  useImageUploadQueue,
} from '../blocknote/uploads'

/** 저장 파이프라인이 이 표면에서 꺼내 가는 것 = 블록 + 그 블록의 Markdown 프로젝션(항상 한 쌍). */
export interface SurfaceBody {
  blocks: BlockDocument
  markdown: string
}

export interface BlockSurfaceHandle {
  /** 편집기 문서 → (사이드카 경유) 앱 블록 → Markdown 프로젝션. 저장 요청에 **함께** 실린다. */
  build: () => SurfaceBody
}

interface BlockSurfaceProps {
  label: string
  initialBlocks: BnBlock[]
  sidecar: AdapterSidecar
  theme: 'light' | 'dark'
  /** 편집이 일어났다 — 부모의 자동 저장 스케줄러로 보낸다. */
  onChange: () => void
  /** 조용히 버리지 않는다 — 부모의 단일 배너로 보낸다. */
  onNotice: (message: string) => void
  /** IME 조합 시작/끝 — 조합 중에는 저장을 트리거하지 않는다(규약 C). */
  onComposition: (active: boolean) => void
}

const MICRO_MARK_LABEL: Record<MicroMark, string> = {
  underline: '밑줄',
  highlight: '형광펜',
  spoiler: '스포일러',
}

const BlockSurface = forwardRef<BlockSurfaceHandle, BlockSurfaceProps>(function BlockSurface(
  { label, initialBlocks, sidecar, theme, onChange, onNotice, onComposition },
  ref,
) {
  const uploadQueue = useImageUploadQueue()

  // 세션 사이드카 — ref인 이유는 노트 화면과 같다: `useCreateBlockNote`는 최초 렌더의 옵션
  // 클로저를 영구히 캡처하므로(deps=[] 고정) 상태로 두면 붙여넣기 핸들러가 낡은 사본을 잡는다.
  const sidecarRef = useRef<AdapterSidecar>({ ...sidecar })
  const mergeSidecar = useCallback((entries: AdapterSidecar) => {
    // 기존 키를 덮어쓰지 않는다(노트와 동일 — 붙여넣기 id는 이미 세션 유일 값으로 갈린 뒤다).
    for (const [key, entry] of Object.entries(entries)) {
      if (!(key in sidecarRef.current)) sidecarRef.current[key] = entry
    }
  }, [])

  // 콜백 identity가 매 렌더 바뀌어도 편집기가 캡처한 클로저는 최신 동작을 부르도록 ref 경유.
  const noticeRef = useRef(onNotice)
  noticeRef.current = onNotice
  const notify = useCallback((message: string) => noticeRef.current(message), [])

  const editor = useCreateBlockNote({
    schema: noteSchema,
    dictionary: noteDictionary,
    initialContent: initialBlocks.length > 0 ? asEditorBlocks(initialBlocks) : undefined,
    uploadFile: uploadQueue.uploadFile,
    pasteHandler: createPasteHandler({
      runUpload: uploadQueue.uploadFile,
      beginUploadBatch: uploadQueue.beginBatch,
      onNotice: notify,
      mergeSidecar,
    }),
  })

  // 표 열 정렬 1회성 예고(노트와 동일 — 정렬 편집 UI는 M35라 화면만 봐서는 정렬의 존재를 모른다).
  useEffect(() => {
    const tables = Object.values(sidecarRef.current).filter((entry) =>
      entry.tableAlign?.some((value) => value !== null),
    ).length
    if (tables > 0) {
      notify(
        `${label}에 표 열 정렬이 있습니다 — 값은 그대로 보존되지만, 열을 추가·삭제하면 정렬이 복원되지 않습니다(정렬 편집은 이후 단계).`,
      )
    }
    // 로드 1회만.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 이미 알린 표 정렬 폐기 블록 id — 자동 저장마다 같은 배너가 반복되지 않게. */
  const alignNotifiedRef = useRef<Set<string>>(new Set())
  /** 이미 알린 마이크로 마크 종류 — 같은 사유를 매 저장마다 다시 띄우지 않게. */
  const microNotifiedRef = useRef<Set<MicroMark>>(new Set())

  const build = useCallback((): SurfaceBody => {
    // **규약 D의 강제 지점** — 저장 경로는 반드시 사이드카를 동반한 `fromBlockNoteResult`다.
    const result = fromBlockNoteResult(asAdapterBlocks(editor.document), sidecarRef.current)

    // ① 표 열 정렬이 실제로 폐기된 시점(열 증감) 고지
    const freshAligns = result.tableAlignDrops.filter((id) => !alignNotifiedRef.current.has(id))
    if (freshAligns.length > 0) {
      for (const id of freshAligns) alignNotifiedRef.current.add(id)
      notify(
        `${label}의 표 ${freshAligns.length}개에서 열 정렬을 복원하지 못했습니다 — 열을 추가·삭제하면 정렬이 사라집니다(정렬 편집은 이후 단계).`,
      )
    }

    // ② 마이크로 마크 접힘 고지(인계 6) — documents는 **편집기 밖에서 만들어진 본문**이 들어오는
    //    첫 표면이라, 규약 C(밑줄·형광펜·스포일러는 같은 구간에 1개)를 벗어난 서식이 실제로 들어올
    //    수 있다. 방어적 정규화로 접었다는 사실을 조용히 넘기지 않는다.
    const freshMarks = [...new Set(result.microMarkCollapses)].filter(
      (mark) => !microNotifiedRef.current.has(mark),
    )
    if (freshMarks.length > 0) {
      for (const mark of freshMarks) microNotifiedRef.current.add(mark)
      notify(
        `${label}에서 겹쳐 있던 서식을 정리했습니다 — ${freshMarks
          .map((mark) => MICRO_MARK_LABEL[mark])
          .join('·')}은(는) 같은 구간에 하나만 적용됩니다(Markdown 표기 제약).`,
      )
    }

    const blocks = result.document
    return { blocks, markdown: blocksToMarkdown(blocks) }
  }, [editor, label, notify])

  useImperativeHandle(ref, () => ({ build }), [build])

  const uploadStatus = uploadQueue.status
  const showUploadBox = uploadStatus.active || uploadStatus.failures.length > 0

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-primary">{label}</h2>

      {showUploadBox && (
        <div role="status" className="flex flex-col gap-1 rounded border border-border bg-surface px-3 py-2 text-xs">
          {uploadStatus.active && (
            <span className="text-muted">
              이미지 올리는 중 ({Math.min(uploadStatus.completed + 1, uploadStatus.total)}/{uploadStatus.total})…
            </span>
          )}
          {uploadStatus.failures.map((failure, idx) => (
            <span key={`${failure.name}-${idx}`} className="text-wrong">
              {failure.name}: {failure.message}
            </span>
          ))}
          {uploadStatus.failures.length > 0 && (
            <button type="button" onClick={uploadQueue.dismissFailures} className="self-start text-muted underline">
              닫기
            </button>
          )}
        </div>
      )}

      <div
        className="note-editor-frame"
        onCompositionStartCapture={() => onComposition(true)}
        onCompositionEndCapture={() => onComposition(false)}
        onDropCapture={(e) => {
          // 이미지 3진입점 중 드롭(노트와 동일) — 실제 OS 파일이 있을 때만 가로챈다.
          const files = Array.from(e.dataTransfer?.files ?? [])
          if (files.length === 0) return
          e.preventDefault()
          e.stopPropagation()
          const imageFiles = files.filter(isImageFile)
          if (imageFiles.length > 0) {
            uploadQueue.beginBatch(imageFiles.length)
            void insertUploadedImages(editor, imageFiles, uploadQueue.uploadFile)
          }
          const skipped = files.length - imageFiles.length
          if (skipped > 0) notify(describeSkippedNonImageFiles(skipped))
        }}
      >
        <RefUiProvider editor={editor}>
          <BlockNoteView
            editor={editor}
            theme={theme}
            onChange={onChange}
            formattingToolbar={false}
            slashMenu={false}
          >
            <NoteEditorDialectUI />
          </BlockNoteView>
        </RefUiProvider>
      </div>
    </div>
  )
})

export default BlockSurface
