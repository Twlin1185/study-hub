// 에디터 v2 — 이미지 3진입점 공유 업로드 지점(stage-34 G-11, 규약 H · §4.27 [S29] 재사용).
//
// `useCreateBlockNote({ uploadFile })`에 이 모듈의 `uploadFile` 하나만 꽂는다:
//   · 드래그앤드롭·툴바/슬래시 이미지 삽입 — BlockNote 기본 이미지 블록·드롭 처리가 이 훅을
//     그대로 호출한다(별도 배선 불필요 — 실측: `@blocknote/core` 내부 `fileDropExtension.ts`·
//     이미지 블록 업로드 패널이 전부 `editor.uploadFile`을 통한다).
//   · 붙여넣기의 이미지 분기(`paste.ts`)는 `insertUploadedImages`로 이 훅을 재사용한다(별도
//     업로드 경로를 새로 만들지 않는다).
//
// 서버 계약은 **요청당 파일 1개**(§4.27 — 무변경)이므로, 실제 네트워크 호출은 프라미스 체인으로
// 직렬화한다(`chain`) — 호출 경로가 무엇이든(붙여넣기·드롭이 겹쳐도) 동시 요청을 만들지 않는다.
// 진행/실패는 `status`로 노출한다(`role="status"` 렌더는 NoteEditPage 담당).
import { useCallback, useRef, useState } from 'react'
import { useUploadImage } from '../../api/uploads'
import type { NoteBlockNoteEditor, NotePartialBlock } from './schema'

export interface ImageUploadFailure {
  name: string
  message: string
}

export interface ImageUploadStatus {
  active: boolean
  completed: number
  total: number
  failures: ImageUploadFailure[]
}

const IDLE_STATUS: ImageUploadStatus = { active: false, completed: 0, total: 0, failures: [] }

export interface ImageUploadQueue {
  /** `useCreateBlockNote({ uploadFile })`에 그대로 꽂는 함수. */
  uploadFile: (file: File) => Promise<string>
  /** 붙여넣기·드롭처럼 파일 개수를 미리 아는 호출부가 "N/M" 표시를 정확히 맞추려고 부른다. */
  beginBatch: (count: number) => void
  status: ImageUploadStatus
  dismissFailures: () => void
}

export function useImageUploadQueue(): ImageUploadQueue {
  const uploadImage = useUploadImage()
  const [status, setStatus] = useState<ImageUploadStatus>(IDLE_STATUS)
  const chain = useRef<Promise<unknown>>(Promise.resolve())
  const fixedTotal = useRef<number | null>(null)

  const beginBatch = useCallback((count: number) => {
    if (count <= 0) return
    fixedTotal.current = count
    setStatus({ active: true, completed: 0, total: count, failures: [] })
  }, [])

  const dismissFailures = useCallback(() => {
    setStatus((prev) => ({ ...prev, failures: [] }))
  }, [])

  const uploadFile = useCallback(
    (file: File): Promise<string> => {
      const task = chain.current.then(async () => {
        setStatus((prev) => ({
          active: true,
          completed: prev.completed,
          total: fixedTotal.current ?? Math.max(prev.total, prev.completed + 1),
          failures: prev.failures,
        }))
        try {
          const result = await uploadImage.mutateAsync(file)
          setStatus((prev) => {
            const completed = prev.completed + 1
            const finished = completed >= prev.total
            if (finished) fixedTotal.current = null
            return { active: !finished, completed, total: prev.total, failures: prev.failures }
          })
          return result.url
        } catch (error) {
          const message = error instanceof Error ? error.message : '이미지를 올리지 못했습니다'
          setStatus((prev) => {
            const completed = prev.completed + 1
            const finished = completed >= prev.total
            if (finished) fixedTotal.current = null
            return {
              active: !finished,
              completed,
              total: prev.total,
              failures: [...prev.failures, { name: file.name, message }],
            }
          })
          throw error
        }
      })
      // 실패해도 체인은 끊지 않는다 — 다음 파일이 계속 처리된다(규약 H "나머지는 계속 진행").
      chain.current = task.catch(() => undefined)
      return task
    },
    [uploadImage],
  )

  return { uploadFile, beginBatch, status, dismissFailures }
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/')
}

/**
 * 비이미지 파일이 섞여 들어왔을 때(§4.27 ③ 서버 화이트리스트 — PNG·JPG·GIF·WebP 4종 밖)
 * **조용히 무시하지 않는다**(DoD 4·6 "조용한 손실 0"). 붙여넣기(`paste.ts`)·드래그앤드롭
 * (`NoteEditPage.tsx`)이 이 한 문구를 공유해 같은 경로(`pasteNotice` 배너)로 안내한다 —
 * 이미지가 함께 있으면 그 이미지들은 그대로 업로드하고, 건너뛴 개수만 알린다.
 */
export function describeSkippedNonImageFiles(count: number): string {
  return `이미지 파일만 지원합니다(PNG·JPG·GIF·WebP) — 파일 ${count}개를 건너뛰었습니다`
}

function isEmptyParagraphAnchor(block: { type: string; content?: unknown }): boolean {
  return block.type === 'paragraph' && Array.isArray(block.content) && block.content.length === 0
}

/**
 * 커서 위치부터 이미지 파일들을 **순차로**(요청당 1개) 업로드해 삽입한다 — 붙여넣기·드래그앤드롭이
 * 공유하는 루프(규약 H). 파일 하나가 실패해도 예외를 밖으로 던지지 않고 다음 파일로 넘어간다
 * (실패 표시는 `runUpload`가 갱신하는 `status`가 이미 맡는다 — 빈 이미지 블록은 자리 표시로 남긴다).
 */
export async function insertUploadedImages(
  editor: NoteBlockNoteEditor,
  files: File[],
  runUpload: (file: File) => Promise<string>,
): Promise<void> {
  let anchor = editor.getTextCursorPosition().block

  for (const file of files) {
    const placeholder = { type: 'image', props: {} } as NotePartialBlock
    const insertedId = isEmptyParagraphAnchor(anchor)
      ? editor.replaceBlocks([anchor.id], [placeholder]).insertedBlocks[0]?.id
      : editor.insertBlocks([placeholder], anchor, 'after')[0]?.id

    if (!insertedId) continue

    try {
      const url = await runUpload(file)
      editor.updateBlock(insertedId, { type: 'image', props: { url } } as NotePartialBlock)
    } catch {
      // 실패는 role="status" 배너가 파일명 + 서버 message로 이미 보고한다.
    }

    const next = editor.getBlock(insertedId)
    if (next) anchor = next
  }
}
