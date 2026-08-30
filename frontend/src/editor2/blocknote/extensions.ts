// 편집 표면 **공용 BlockNote 확장 묶음**(stage-36 F-6·F-7).
//
// 표면(노트 `NoteEditPage` · 문서 `BlockSurface`)은 이 한 줄만 `useCreateBlockNote({ extensions })`에
// 넘긴다 — 두 표면이 서로 다른 확장을 갖게 되는 표류를 원천 차단한다.
//
// `createExtension`은 BlockNote 0.54의 **공식 확장 API**다(`editor/BlockNoteExtension.d.ts`:
// `prosemirrorPlugins`·`keyboardShortcuts`·`store`). 내부 tiptap 옵션(`_tiptapOptions`, @internal)을
// 건드리지 않는 경로라 업그레이드 내성이 낫다.
import { createExtension } from '@blocknote/core'
import type { AdapterSidecar } from '../adapter'
import { createColumnsEdgeKeymapExtension } from './columnsKeymap'
import { createFindPlugin } from './find/findPlugin'
import { createTableAlignPlugin, type ColumnAlign, type InitialTableAlign } from './tableAlign/tableAlignPlugin'

/** 사이드카(로드 시 어댑터가 흡수해 둔 값) → 표 열 정렬 플러그인의 초기 상태. */
export function tableAlignFromSidecar(sidecar: AdapterSidecar): InitialTableAlign {
  const initial: Record<string, ColumnAlign[]> = {}
  for (const [blockId, entry] of Object.entries(sidecar)) {
    const align = entry?.tableAlign
    if (align) initial[blockId] = align.map((value) => value ?? null)
  }
  return initial
}

export function createEditor2Extensions(initialTableAlign: InitialTableAlign) {
  return [
    createExtension({
      key: 'editor2Find',
      prosemirrorPlugins: [createFindPlugin()],
    }),
    createExtension({
      key: 'editor2TableAlign',
      prosemirrorPlugins: [createTableAlignPlugin(initialTableAlign)],
    }),
    // 단 경계 키 가드(stage-41 2차 규약 E 강등) — 두 표면 모두 이 함수로 확장을 받으므로
    // 노트 편집기(`NoteEditPage`)·문서 블록 표면(`BlockSurface`) 양쪽에 같이 걸린다.
    createColumnsEdgeKeymapExtension(),
  ]
}
