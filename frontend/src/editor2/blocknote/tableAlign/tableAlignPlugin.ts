// 표 **열 정렬** — ProseMirror 플러그인 계층(stage-36 F-6 · 규약 E).
//
// ---------------------------------------------------------------- 무엇을 어디에 두는가
// 정렬 값은 **문서에 없다**. 앱 블록 스키마의 `table.align`(GFM 구분행)에는 `left/center/right/null`
// 네 상태가 있는데, BlockNote 표 셀의 `textAlignment` prop은 기본값이 `"left"`라 **"정렬 없음"과
// "왼쪽 정렬"을 구분할 수 없다**(`---` ⇄ `:---`가 뭉개진다 = 프로젝션 회귀). 그래서 규약 E가 정한
// 대로 **편집 세션 동안 UI가 소유**하고, 저장 시 사이드카 `table:align` 규약으로 직렬화한다
// (`adapter/toBlockNote.ts` ⑦ · `fromBlockNote.ts` 표 분기 — 어댑터는 **손대지 않는다**).
//
// ---------------------------------------------------------------- 열 증감에서 인덱스가 어긋나지 않는 이유
// 이 플러그인은 열마다 **"첫 행 셀 안의 문서 위치 1개"**(probe = 셀 시작 + 1)를 함께 들고 있다가,
// 트랜잭션마다 `tr.mapping`으로 그 위치를 옮긴다. 그리고 새 문서에서 다시 센 열의 probe와
// **위치가 일치하는 것끼리** 정렬을 물려준다.
//   · 가운데에 열을 끼워 넣으면 → 뒤쪽 열들의 probe가 통째로 밀리므로 정렬도 함께 밀린다.
//     새 열의 probe는 어느 옛 probe와도 같지 않으므로 `null`(정렬 없음)로 태어난다.
//   · 열을 지우면 → 그 열의 probe는 삭제 지점으로 접히고 어느 새 열 probe와도 맞지 않아 버려진다.
//   · 셀 안에서 글자를 치는 것은 probe(셀 **시작** 바로 뒤)를 움직이지 않는다.
// 즉 "열 증감 시 인덱스 어긋남"은 **위치 매핑으로** 소멸한다 — 길이 비교 휴리스틱이 아니다.
//
// `prosemirror-*` 직접 import의 근거는 `find/findPlugin.ts` 머리말과 같다(이미 트리에 있는
// `@blocknote/core`의 직접 의존 · 설치 증가 0 · MIT).
import { Plugin, PluginKey } from 'prosemirror-state'
import type { EditorState, Transaction } from 'prosemirror-state'
import type { Node as PMNode } from 'prosemirror-model'
import { Decoration, DecorationSet } from 'prosemirror-view'

/** GFM 구분행이 표현할 수 있는 네 상태. `null` = 정렬 지정 없음(`---`). */
export type ColumnAlign = 'left' | 'center' | 'right' | null

export const TABLE_ALIGN_PLUGIN_KEY = new PluginKey<TableAlignState>('editor2-table-align')

export interface TableAlignEntry {
  /** BlockNote 블록 id — 사이드카 키와 같은 값이다(그래서 저장 왕복이 성립한다). */
  blockId: string
  /** 표 **내용 노드**의 문서 위치(장식 계산용). */
  tablePos: number
  /** 열마다 하나씩 — 첫 행 셀 시작 바로 뒤의 문서 위치. */
  probes: number[]
  align: ColumnAlign[]
}

export interface TableAlignState {
  entries: TableAlignEntry[]
}

/** 로드 시점에 사이드카에서 받아 오는 초기 정렬(블록 id → 열 정렬 배열). */
export type InitialTableAlign = Readonly<Record<string, readonly ColumnAlign[]>>

type TableAlignAction = { type: 'set'; blockId: string; colIndex: number; value: ColumnAlign }

function tableRoleOf(node: PMNode): string | undefined {
  return (node.type.spec as { tableRole?: string }).tableRole
}

/** 위치 `pos`를 감싸는 가장 가까운 **블록 id**(BlockNote `blockContainer`의 `id` 속성). */
function blockIdAt(doc: PMNode, pos: number): string | null {
  const $pos = doc.resolve(pos)
  for (let depth = $pos.depth; depth >= 0; depth -= 1) {
    const id = ($pos.node(depth).attrs as { id?: unknown } | undefined)?.id
    if (typeof id === 'string' && id !== '') return id
  }
  return null
}

interface TableShape {
  blockId: string
  tablePos: number
  probes: number[]
}

/** 문서 안 표를 전부 훑어 **열 수와 probe 위치**를 센다. */
function collectTables(doc: PMNode): TableShape[] {
  const shapes: TableShape[] = []
  doc.descendants((node, pos) => {
    if (tableRoleOf(node) !== 'table') return true
    const blockId = blockIdAt(doc, pos)
    if (blockId === null) return false
    const probes: number[] = []
    const firstRow = node.firstChild
    if (firstRow) {
      // 표 내용 노드 안쪽(+1) → 첫 행 안쪽(+1) = 첫 셀의 시작 위치.
      let cellPos = pos + 1 + 1
      firstRow.forEach((cell) => {
        probes.push(cellPos + 1)
        cellPos += cell.nodeSize
      })
    }
    shapes.push({ blockId, tablePos: pos, probes })
    // 표 안에 표가 들어가는 스키마가 아니다 — 더 내려가지 않는다.
    return false
  })
  return shapes
}

function entriesFromInitial(doc: PMNode, initial: InitialTableAlign): TableAlignEntry[] {
  return collectTables(doc).map((shape) => {
    const saved = initial[shape.blockId]
    // 어댑터(`fromBlockNote`)와 **같은 복원 조건**: 열 수가 그대로일 때만 되살린다.
    const usable = saved !== undefined && saved.length === shape.probes.length
    return {
      ...shape,
      align: usable ? [...saved] : new Array<ColumnAlign>(shape.probes.length).fill(null),
    }
  })
}

function remapEntries(prev: TableAlignEntry[], tr: Transaction, doc: PMNode): TableAlignEntry[] {
  const carried = new Map<number, ColumnAlign>()
  for (const entry of prev) {
    for (let i = 0; i < entry.probes.length; i += 1) {
      if (entry.align[i] === null) continue
      carried.set(tr.mapping.map(entry.probes[i], -1), entry.align[i])
    }
  }
  return collectTables(doc).map((shape) => ({
    ...shape,
    align: shape.probes.map((probe) => carried.get(probe) ?? null),
  }))
}

function alignDecorations(doc: PMNode, entries: TableAlignEntry[]): DecorationSet {
  const decorations: Decoration[] = []
  for (const entry of entries) {
    if (!entry.align.some((value) => value !== null)) continue
    const table = doc.nodeAt(entry.tablePos)
    if (!table || tableRoleOf(table) !== 'table') continue
    let rowPos = entry.tablePos + 1
    table.forEach((row) => {
      let cellPos = rowPos + 1
      row.forEach((cell, _offset, index) => {
        const align = entry.align[index]
        if (align !== null && align !== undefined) {
          decorations.push(
            Decoration.node(cellPos, cellPos + cell.nodeSize, { class: `editor2-col-align-${align}` }),
          )
        }
        cellPos += cell.nodeSize
      })
      rowPos += row.nodeSize
    })
  }
  return decorations.length === 0 ? DecorationSet.empty : DecorationSet.create(doc, decorations)
}

export function getTableAlignState(state: EditorState): TableAlignState {
  return TABLE_ALIGN_PLUGIN_KEY.getState(state) ?? { entries: [] }
}

/** 트랜잭션에 정렬 변경을 싣는다(문서는 바뀌지 않는다 — 세션 상태다). */
export function withTableAlignAction(tr: Transaction, action: TableAlignAction): Transaction {
  return tr.setMeta(TABLE_ALIGN_PLUGIN_KEY, action)
}

/** 커서가 들어 있는 표 열(없으면 `null`). 정렬 편집 UI가 "지금 어느 열인지"를 이걸로 안다. */
export function selectedTableColumn(state: EditorState): { blockId: string; colIndex: number } | null {
  const $pos = state.selection.$from
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const role = tableRoleOf($pos.node(depth))
    if (role !== 'cell' && role !== 'header_cell') continue
    const colIndex = $pos.index(depth - 1)
    for (let up = depth - 1; up >= 0; up -= 1) {
      const id = ($pos.node(up).attrs as { id?: unknown } | undefined)?.id
      if (typeof id === 'string' && id !== '') return { blockId: id, colIndex }
    }
    return null
  }
  return null
}

/** 저장 경로가 사이드카에 실을 값 — 블록 id → 열 정렬 배열(길이 = 실제 열 수). */
export function readTableAlign(state: EditorState): Record<string, ColumnAlign[]> {
  const out: Record<string, ColumnAlign[]> = {}
  for (const entry of getTableAlignState(state).entries) out[entry.blockId] = [...entry.align]
  return out
}

export function createTableAlignPlugin(initial: InitialTableAlign): Plugin<TableAlignState> {
  return new Plugin<TableAlignState>({
    key: TABLE_ALIGN_PLUGIN_KEY,
    state: {
      init: (_config, state) => ({ entries: entriesFromInitial(state.doc, initial) }),
      apply(tr, prev, _oldState, newState) {
        let entries = prev.entries
        if (tr.docChanged) entries = remapEntries(entries, tr, newState.doc)

        const action = tr.getMeta(TABLE_ALIGN_PLUGIN_KEY) as TableAlignAction | undefined
        if (action?.type === 'set') {
          entries = entries.map((entry) => {
            if (entry.blockId !== action.blockId) return entry
            if (action.colIndex < 0 || action.colIndex >= entry.align.length) return entry
            const align = [...entry.align]
            align[action.colIndex] = action.value
            return { ...entry, align }
          })
        }

        return entries === prev.entries ? prev : { entries }
      },
    },
    props: {
      decorations(state) {
        return alignDecorations(state.doc, getTableAlignState(state).entries)
      },
    },
  })
}
