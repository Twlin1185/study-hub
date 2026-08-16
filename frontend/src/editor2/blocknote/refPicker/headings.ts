// 앵커 칩(`[[#절 제목]]`) 후보 = **현재 노트의 heading 블록 목록** (규약 A ①).
//
// 자유 입력을 받지 않는 이유: 앵커 대상은 같은 문서 안의 제목과 **글자 그대로** 맞아야 하고,
// 라벨과 같은 문자 도메인 제약(`refDomain.ts`)을 받는다. 손으로 치게 하면 오타·도메인 위반이
// 곧바로 깨진 참조가 된다.
//
// **도메인 밖 제목은 숨기지 않는다** — 비활성 + 사유로 노출해야 사용자가 "제목을 고치면 쓸 수 있다"는
// 것을 안다(규약 A ①).
import { isSafeAnchorTarget, normalizeRefText, refTextRejection } from '../../schema/refDomain'
import type { NoteBlockNoteEditor } from '../schema'

export interface AnchorCandidate {
  /** 정규화(가장자리 공백 트림)된 제목 — 통과분은 이 값이 그대로 `target`이 된다. */
  text: string
  level: number
  usable: boolean
  /** 못 쓰는 사유(사용자에게 그대로 보여 준다). 통과면 `null`. */
  reason: string | null
}

/** 인라인 콘텐츠 배열에서 **글자만** 뽑는다(원자 인라인은 글자를 갖지 않으므로 건너뛴다). */
function inlineText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  let out = ''
  for (const node of content) {
    if (!node || typeof node !== 'object') continue
    const record = node as Record<string, unknown>
    if (record.type === 'text' && typeof record.text === 'string') out += record.text
    else if (record.type === 'link') out += inlineText(record.content)
  }
  return out
}

function walk(blocks: readonly unknown[], out: AnchorCandidate[]): void {
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue
    const record = block as Record<string, unknown>
    if (record.type === 'heading') {
      const raw = normalizeRefText(inlineText(record.content))
      if (raw !== '') {
        const props = (record.props ?? {}) as Record<string, unknown>
        const level = typeof props.level === 'number' ? props.level : 1
        const usable = isSafeAnchorTarget(raw)
        out.push({
          text: raw,
          level,
          usable,
          reason: usable
            ? null
            : raw.startsWith('#')
              ? '# 로 시작하는 제목은 앵커 대상으로 쓸 수 없습니다'
              : refTextRejection(raw),
        })
      }
    }
    if (Array.isArray(record.children)) walk(record.children, out)
  }
}

/** 현재 문서의 heading 후보 목록(문서 순서 · 중복 제목은 한 번만). */
export function collectAnchorCandidates(editor: NoteBlockNoteEditor): AnchorCandidate[] {
  const found: AnchorCandidate[] = []
  walk(editor.document as readonly unknown[], found)
  const seen = new Set<string>()
  return found.filter((item) => {
    if (seen.has(item.text)) return false
    seen.add(item.text)
    return true
  })
}
