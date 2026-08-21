// 이미지 크롭 제공 조건(stage-37 F-6, 규약 C) — **버튼 미노출**로 강제한다(에러 메시지 없이 조용히
// 숨는다: 두 조건 다 "기능이 이 이미지엔 성립하지 않는다"는 사실이라 UI 상에서 굳이 실패를 보여줄
// 이유가 없다).
//   ① 자체 호스팅 `/images/` 경로만 — 외부 URL은 canvas CORS 오염으로 내보내기(`toBlob`)가
//      기술적으로 불가하다.
//   ② GIF 제외 — canvas 내보내기는 정지 1프레임뿐이라 애니메이션이 조용히 사라진다(조용한 손실 금지).
//
// 이 판정은 툴바(초기 청크)와 크롭 다이얼로그(lazy 청크) 양쪽이 같이 쓰므로, 어느 쪽에도 무거운
// 의존을 끌고 오지 않는 순수 함수 하나로 둔다.
import type { NoteBlockNoteEditor } from '../schema'

export function isCroppableImageUrl(url: string | undefined | null): url is string {
  if (!url) return false
  if (!url.startsWith('/images/')) return false
  return !/\.gif$/i.test(url)
}

export interface CropTarget {
  id: string
  url: string
}

/**
 * 지금 선택(또는 커서 위치 블록)이 크롭 제공 조건을 만족하는 image 블록 1개인지 판정한다
 * (`FileReplaceButton` 등 BlockNote 기본 파일 버튼과 같은 방식 — `getSelection().blocks` 우선,
 * 없으면 커서 블록 1개).
 */
export function computeCropTarget(editor: NoteBlockNoteEditor): CropTarget | null {
  const blocks = editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block]
  if (blocks.length !== 1) return null
  const block = blocks[0]
  if (block.type !== 'image') return null
  const url = (block.props as { url?: string }).url
  return isCroppableImageUrl(url) ? { id: block.id, url } : null
}
