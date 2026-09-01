// 표면 1개의 **로드 재료**를 만드는 공용 조각 (stage-35 규약 D·E → stage-36 F-1에서 공용화).
//
// stage-35에서는 이 계산이 `DocBlockEditor` 안에만 있었다. stage-36에서 공용 `DocEditor`도 같은
// 판정으로 블록 표면을 열기 때문에(규약 A — 분기 조건은 stage-35 규약 F 그대로) **두 곳이 같은
// 함수를 부르도록** 뽑아냈다(복붙 금지). 계산 내용은 stage-35 원본과 1:1 동일하다.
import { markdownToBlocks } from '../transform'
import { describeUnsupported, toBlockNoteBlocks, type AdapterSidecar, type BnBlock } from '../adapter'
import type { BlockDocument } from '../schema/blocks'

export interface SurfaceSource {
  blocks: BnBlock[]
  sidecar: AdapterSidecar
}

export type SurfaceLoad = { ok: true; source: SurfaceSource } | { ok: false; reason: string }

/**
 * 한 표면의 로드 재료를 만든다.
 * - 전환 문서: 저장된 블록(`*_blocks`)이 소스 오브 트루스다 — Markdown은 쳐다보지 않는다(규약 D).
 * - 미전환 문서·신규 작성: `content`/`explanation`(또는 이월 초안 Markdown)을 **메모리에서만**
 *   블록으로 변환한다(DB 무기록 — 규약 E).
 * - 변환이 미지원 사유를 내면 `ok:false` — 호출부는 본문·해설 편집 잠김 + 안내로 전환한다(stage-43 규약 D).
 */
export function loadSurface(
  blocks: BlockDocument | null,
  markdown: string | null | undefined,
): SurfaceLoad {
  const document = blocks ?? markdownToBlocks(markdown ?? '')
  const result = toBlockNoteBlocks(document)
  if (result.unsupported.length > 0) {
    return { ok: false, reason: describeUnsupported(result.unsupported) }
  }
  return { ok: true, source: { blocks: result.blocks, sidecar: result.sidecar } }
}
