// stage-41 2차(고정 열) — **편집 표면 계층 자동 검증**(묶음 B · 검토 중-3 "자동 검증 0건" 대응).
//
// 왕복 코퍼스(`s41-columns-roundtrip.mjs` — 변환기·어댑터·리더)와 겹치지 않는 **편집기 쪽**을 잡는다:
//   ① 정규화 계획/실행(`planColumnsNormalization`·`applyColumnsNormalization`)
//   ② **앱 계층(A `normalizeColumnsTree`)과의 동치** — 같은 픽스처를 앱 블록형·BN JSON형으로 각각
//      정규화해 텍스트 트리로 비교한다(두 계층이 갈라지면 저장·재열람에서 구조가 흔들린다)
//   ③ 조작 커맨드(삽입·감싸기·2↔3 토글·해제·중첩 차단)
//   ④ 단 경계 키 가드의 순수 판정(`shouldBlock*` + PM 상태 사실 추출 `readColumnEdgeFacts`)
//
// DOM 없이 **실제 `noteSchema`로 헤드리스 편집기**(`@blocknote/server-util` — 이미 devDependency)를
// 만들어 돌린다. 로더 배선(`Module._extensions['.css']` 스텁 · `.tsx` 트랜스파일)은 s33/s41 1차의
// 관례를 그대로 쓴다. **jiti 캐시는 켠다** — 끄면 `@blocknote/core`가 두 번 평가돼 ProseMirror
// `Duplicate use of selection JSON ID`로 죽는다(실측).
import Module, { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { ServerBlockNoteEditor } from '@blocknote/server-util'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FRONT = path.resolve(HERE, '..')
const SRC = path.join(FRONT, 'src')

Module._extensions['.css'] = (mod) => {
  mod.exports = {}
}
const require = createRequire(path.join(FRONT, 'package.json'))
const jitiBabelTransform = require('jiti/dist/babel')
const ts = require('typescript')
const jiti = require('jiti')(path.join(FRONT, 'scripts/_loader.cjs'), {
  interopDefault: true,
  esmResolve: true,
  cache: true,
  requireCache: true,
  extensions: ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.tsx', '.jsx', '.json'],
  transform(topts) {
    if (!/\.[cm]?tsx$/.test(topts.filename ?? '')) return jitiBabelTransform(topts)
    const out = ts.transpileModule(topts.source, {
      fileName: topts.filename,
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    })
    return { code: out.outputText }
  },
})

const { noteSchema } = jiti(path.join(SRC, 'editor2/blocknote/schema.ts'))
const normalize = jiti(path.join(SRC, 'editor2/blocknote/columnsNormalize.ts'))
const specs = jiti(path.join(SRC, 'editor2/blocknote/specs/blocks.tsx'))
const insert = jiti(path.join(SRC, 'editor2/blocknote/refPicker/insert.ts'))
const keymap = jiti(path.join(SRC, 'editor2/blocknote/columnsKeymap.ts'))
const appNormalize = jiti(path.join(SRC, 'editor2/schema/columnsNormalize.ts'))

let pass = 0
let fail = 0
const failures = []
function check(label, ok, detail) {
  if (ok) pass += 1
  else {
    fail += 1
    failures.push(`${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

// 헤드리스 편집기 1개(실제 스키마) — 모든 계열이 이 인스턴스를 갈아 끼우며 쓴다.
const server = ServerBlockNoteEditor.create({ schema: noteSchema })
const editor = server.editor
function load(blocks) {
  editor.replaceBlocks(editor.document, blocks)
  return editor.document
}
/** 정규화를 **고정점까지** 돌린다(런타임에서는 한 패스마다 onChange가 다시 돌아 같은 결과가 된다). */
function normalizeToFixpoint(max = 5) {
  for (let i = 0; i < max; i += 1) {
    if (normalize.planColumnsNormalization(editor.document).length === 0) return i
    specs.applyColumnsNormalization(editor)
  }
  return max
}

/** 텍스트 트리 — id를 뺀 구조 비교용(두 계층의 id 생성 규칙이 달라 id는 비교 대상이 아니다). */
function tree(blocks, depth = 0) {
  return blocks
    .map((b) => {
      const text = Array.isArray(b.content)
        ? b.content.map((c) => (typeof c?.text === 'string' ? c.text : '')).join('')
        : ''
      const head = `${'  '.repeat(depth)}${b.type}${text ? `[${text}]` : ''}`
      const kids = b.children?.length ? `\n${tree(b.children, depth + 1)}` : ''
      return head + kids
    })
    .join('\n')
}

// ── 픽스처: 중립 명세 → BN JSON / 앱 블록 두 형태로 각각 만든다 ─────────────────────────────
let idSeq = 0
const nextId = () => `f${(idSeq += 1)}`
function toBn(node) {
  if (node.t === 'p') return { id: nextId(), type: 'paragraph', content: node.text ? node.text : [] }
  if (node.t === 'columns') {
    return {
      id: nextId(),
      type: 'columns',
      props: { count: node.count === undefined ? 2 : node.count, meta: '' },
      children: (node.kids ?? []).map(toBn),
    }
  }
  return { id: nextId(), type: 'column', props: {}, children: (node.kids ?? []).map(toBn) }
}
function toApp(node) {
  if (node.t === 'p') {
    return {
      id: nextId(),
      type: 'paragraph',
      content: node.text ? [{ type: 'text', text: node.text }] : [],
    }
  }
  if (node.t === 'columns') {
    return {
      id: nextId(),
      type: 'columns',
      count: node.count === undefined ? 2 : node.count,
      children: (node.kids ?? []).map(toApp),
    }
  }
  return { id: nextId(), type: 'column', children: (node.kids ?? []).map(toApp) }
}
const p = (text) => ({ t: 'p', text })
const col = (...kids) => ({ t: 'column', kids })
const cols = (count, ...kids) => ({ t: 'columns', count, kids })

// ══════════════════════════════════════ 계열 ① 정규화 계획·실행
{
  load([cols(2, col(p('1단')), col(p('2단')))].map(toBn))
  check('①-1 정규 상태 = 계획 0', normalize.planColumnsNormalization(editor.document).length === 0)

  load([cols(2, col(p('a')), p('샌 줄'), col(p('c')))].map(toBn))
  normalizeToFixpoint()
  check(
    '①-2 비-column 자식 = 직전 단 끝',
    tree(editor.document) ===
      'columns\n  column\n    paragraph[a]\n    paragraph[샌 줄]\n  column\n    paragraph[c]',
    JSON.stringify(tree(editor.document)),
  )

  load([cols(2, col(), col(p('b')))].map(toBn))
  normalizeToFixpoint()
  check(
    '①-3 빈 단 = 빈 문단 1개',
    tree(editor.document) === 'columns\n  column\n    paragraph\n  column\n    paragraph[b]',
    JSON.stringify(tree(editor.document)),
  )

  load([cols(2, col(p('a')), col(p('b')), col(p('c')))].map(toBn))
  normalizeToFixpoint()
  check('①-4 count := 단 수', editor.document[0].props.count === 3, editor.document[0].props.count)

  load([col(p('외톨이')), p('뒤')].map(toBn))
  normalizeToFixpoint()
  check('①-5 stray 단 승격', tree(editor.document) === 'paragraph[외톨이]\nparagraph[뒤]', JSON.stringify(tree(editor.document)))

  load([col(), p('뒤')].map(toBn))
  normalizeToFixpoint()
  check('①-6 빈 stray 단 = 통째 제거', tree(editor.document) === 'paragraph[뒤]', JSON.stringify(tree(editor.document)))

  load([cols(2, col(cols(2, col(p('x')), col(p('y')))), col(p('z')))].map(toBn))
  check('①-7 중첩 columns 정규 = 계획 0', normalize.planColumnsNormalization(editor.document).length === 0)

  load([cols(2, col(p('a')), p('샌 줄'))].map(toBn))
  const passes = normalizeToFixpoint()
  check('①-8 고정점 도달(≤ 2패스)', passes <= 2, passes)
  check('①-9 멱등(재계획 0)', normalize.planColumnsNormalization(editor.document).length === 0)
}

// ══════════════════════════════════════ 계열 ② 앱 계층(A)과의 동치
{
  const FIXTURES = [
    ['정규 2단', [cols(2, col(p('1단')), col(p('2단')))]],
    ['비-column 자식 뒤섞임', [cols(2, col(p('a')), p('샌 줄'), col(p('c')), p('꼬리'))]],
    ['단 앞 평문(레거시 1차 형식)', [cols(2, p('머리'), col(p('a')), col(p('b')))]],
    ['단 0개 · count 2', [cols(2)]],
    ['단 0개 · count 미지정', [{ t: 'columns', kids: [] }]],
    ['단 0개 · count 3', [cols(3)]],
    ['빈 단 보충', [cols(2, col(), col(p('b')))]],
    ['count 불일치', [cols(2, col(p('a')), col(p('b')), col(p('c')))]],
    ['stray 단(최상위)', [col(p('외톨이')), p('뒤')]],
    ['빈 stray 단', [col(), p('뒤')]],
    ['단 안 단(중첩 변형)', [cols(2, col(col(p('n'))), col(p('b')))]],
    ['중첩 columns 보존', [cols(2, col(cols(2, col(p('x')), col(p('y')))), col(p('z')))]],
    ['4단 유입(값 보존)', [cols(4, col(p('a')), col(p('b')), col(p('c')), col(p('d')))]],
  ]
  for (const [label, spec] of FIXTURES) {
    idSeq = 0
    const bn = spec.map(toBn)
    idSeq = 0
    const app = spec.map(toApp)
    load(bn)
    normalizeToFixpoint()
    const editorSide = tree(editor.document)
    const appSide = tree(appNormalize.normalizeColumnsTree(app))
    check(`②-${label} A·B 동치`, editorSide === appSide, `\n--- 편집기\n${editorSide}\n--- 앱\n${appSide}`)
  }
  idSeq = 0
  load([cols(2, col(p('a')), col(p('b')), col(p('c')))].map(toBn))
  normalizeToFixpoint()
  idSeq = 0
  const appOut = appNormalize.normalizeColumnsTree(
    [cols(2, col(p('a')), col(p('b')), col(p('c')))].map(toApp),
  )
  check(
    '②-count 동치',
    editor.document[0].props.count === appOut[0].count,
    `${editor.document[0].props.count} vs ${appOut[0].count}`,
  )
}

// ══════════════════════════════════════ 계열 ③ 조작 커맨드
{
  load([
    { type: 'paragraph', content: '앞줄' },
    { type: 'paragraph', content: [] },
  ])
  editor.setTextCursorPosition(editor.document[1].id, 'start')
  insert.insertColumnsBlock(editor, 3)
  let container = editor.document.find((b) => b.type === 'columns')
  check(
    '③-1 삽입 = 빈 단 3개',
    container?.children?.length === 3 && container.children.every((c) => c.type === 'column'),
  )
  check(
    '③-2 각 단에 빈 문단 1개',
    container.children.every((c) => c.children.length === 1 && c.children[0].type === 'paragraph'),
  )
  check('③-3 커서 = 1단 첫 문단', editor.getTextCursorPosition().block.id === container.children[0].children[0].id)
  check('③-4 삽입 직후 정규화 계획 0', normalize.planColumnsNormalization(editor.document).length === 0)

  editor.updateBlock(container.children[1].children[0].id, { type: 'paragraph', content: '둘째단' })
  editor.insertBlocks(
    [
      { type: 'paragraph', content: [] },
      { type: 'paragraph', content: '셋째단 끝' },
    ],
    container.children[2].children[0].id,
    'after',
  )
  editor.updateBlock(container.children[2].children[0].id, { type: 'paragraph', content: '셋째단 머리' })
  insert.setColumnsCount(editor, container.id, 2)
  container = editor.document.find((b) => b.type === 'columns')
  check('③-5 3→2 단 2개', container.children.length === 2, container.children.length)
  check('③-6 3→2 count prop', container.props.count === 2, container.props.count)
  check(
    '③-7 3→2 병합 손실 0 + 내부 빈 문단 보존',
    tree(container.children[1].children) ===
      'paragraph[둘째단]\nparagraph[셋째단 머리]\nparagraph\nparagraph[셋째단 끝]',
    JSON.stringify(tree(container.children[1].children)),
  )

  insert.setColumnsCount(editor, container.id, 3)
  container = editor.document.find((b) => b.type === 'columns')
  check('③-8 2→3 단 3개', container.children.length === 3)
  check('③-9 2→3 기존 단 무변', tree(container.children[1].children).startsWith('paragraph[둘째단]'))
  check(
    '③-10 2→3 새 단 = 빈 문단',
    container.children[2].children.length === 1 && container.children[2].children[0].type === 'paragraph',
  )

  insert.setColumnsCount(editor, container.id, 2)
  container = editor.document.find((b) => b.type === 'columns')
  check(
    '③-11 빈 단 병합 = 빈 줄 누적 없음',
    tree(container.children[1].children) ===
      'paragraph[둘째단]\nparagraph[셋째단 머리]\nparagraph\nparagraph[셋째단 끝]',
    JSON.stringify(tree(container.children[1].children)),
  )

  insert.unwrapColumns(editor, container.id)
  check('③-12 해제 후 columns·column 0', !editor.document.some((b) => b.type === 'columns' || b.type === 'column'))
  check(
    '③-13 해제 순서 보존',
    tree(editor.document).includes('paragraph[둘째단]\nparagraph[셋째단 머리]'),
    JSON.stringify(tree(editor.document)),
  )

  load([
    { type: 'paragraph', content: '가' },
    { type: 'paragraph', content: '나' },
  ])
  insert.wrapInColumns(editor, editor.document.slice(0, 2), 2)
  const wrapped = editor.document.find((b) => b.type === 'columns')
  check(
    '③-14 감싸기 1단에 선택 2블록',
    tree(wrapped.children[0].children) === 'paragraph[가]\nparagraph[나]',
    JSON.stringify(tree(wrapped.children[0].children)),
  )
  check('③-15 감싸기 2단 = 빈 문단', wrapped.children[1].children.length === 1)
  check('③-16 감싸기 직후 계획 0', normalize.planColumnsNormalization(editor.document).length === 0)

  editor.setTextCursorPosition(wrapped.children[0].children[0].id, 'start')
  check('③-17 차단: 단 안', insert.columnsInsertBlocked(editor) === true)
  load([
    { type: 'paragraph', content: '밖' },
    {
      type: 'callout',
      props: { variant: 'note', title: '', attrs: '' },
      children: [{ type: 'paragraph', content: '콜아웃 안' }],
    },
  ])
  editor.setTextCursorPosition(editor.document[0].id, 'start')
  check('③-18 차단: 컨테이너 밖 = 허용', insert.columnsInsertBlocked(editor) === false)
  editor.setTextCursorPosition(editor.document[1].children[0].id, 'start')
  check('③-19 차단: 콜아웃 안', insert.columnsInsertBlocked(editor) === true)
}

// ══════════════════════════════════════ 계열 ④ 단 경계 키 가드
{
  const facts = (over) => ({
    collapsed: true,
    atBlockStart: false,
    atBlockEnd: false,
    parentIsColumn: false,
    isFirstTopChildOfColumn: false,
    isLastLeafOfColumn: false,
    isParagraph: true,
    ...over,
  })
  check(
    '④-1 Backspace: 단 첫 블록 시작 = 차단',
    keymap.shouldBlockBackspace(facts({ atBlockStart: true, parentIsColumn: true, isFirstTopChildOfColumn: true })) === true,
  )
  check(
    '④-2 Backspace: 블록 중간 = 통과',
    keymap.shouldBlockBackspace(facts({ parentIsColumn: true, isFirstTopChildOfColumn: true })) === false,
  )
  check(
    '④-3 Backspace: 선택 있음 = 통과',
    keymap.shouldBlockBackspace(facts({ collapsed: false, atBlockStart: true, isFirstTopChildOfColumn: true })) === false,
  )
  check(
    '④-3b Backspace: 비-문단(목록·헤딩·코드) 첫 블록 = 통과(유형 해제는 코어 몫)',
    keymap.shouldBlockBackspace(facts({ atBlockStart: true, parentIsColumn: true, isFirstTopChildOfColumn: true, isParagraph: false })) === false,
  )
  check('④-4 Backspace: 단 밖 = 통과', keymap.shouldBlockBackspace(facts({ atBlockStart: true })) === false)
  check('④-5 Delete: 단 마지막 잎 끝 = 차단', keymap.shouldBlockDelete(facts({ atBlockEnd: true, isLastLeafOfColumn: true })) === true)
  check('④-6 Delete: 중간 블록 = 통과', keymap.shouldBlockDelete(facts({ atBlockEnd: true })) === false)
  check('④-7 Shift-Tab: 단 최상위 = 차단', keymap.shouldBlockShiftTab(facts({ parentIsColumn: true })) === true)
  check('④-8 Shift-Tab: 단 안 중첩 = 통과', keymap.shouldBlockShiftTab(facts({})) === false)

  load([cols(2, col(p('a'), p('b')), col(p('c')))].map(toBn))
  const container = editor.document.find((b) => b.type === 'columns')
  const [cell1, cell2] = container.children
  const at = (id, place) => {
    editor.setTextCursorPosition(id, place)
    return keymap.readColumnEdgeFacts(editor.prosemirrorState)
  }
  const f1 = at(cell1.children[0].id, 'start')
  check(
    '④-9 사실: 1단 첫 블록 시작',
    f1.parentIsColumn && f1.isFirstTopChildOfColumn && f1.atBlockStart && !f1.isLastLeafOfColumn,
    JSON.stringify(f1),
  )
  const f2 = at(cell1.children[1].id, 'end')
  check(
    '④-10 사실: 1단 마지막 블록 끝',
    f2.isLastLeafOfColumn && f2.atBlockEnd && !f2.isFirstTopChildOfColumn,
    JSON.stringify(f2),
  )
  const f3 = at(cell2.children[0].id, 'start')
  check(
    '④-11 사실: 2단 첫=마지막 블록',
    f3.isFirstTopChildOfColumn && f3.isLastLeafOfColumn && f3.atBlockStart,
    JSON.stringify(f3),
  )

  editor.setTextCursorPosition(cell2.children[0].id, 'start')
  check('④-12 단축키: Backspace 차단', keymap.columnsEdgeShortcuts.Backspace({ editor }) === true)
  check('④-13 단축키: Shift-Tab 차단', keymap.columnsEdgeShortcuts['Shift-Tab']({ editor }) === true)
  editor.setTextCursorPosition(cell1.children[1].id, 'end')
  check('④-14 단축키: Delete 차단', keymap.columnsEdgeShortcuts.Delete({ editor }) === true)
  check('④-15 단축키: Backspace 통과(끝 위치)', keymap.columnsEdgeShortcuts.Backspace({ editor }) === false)

  load([{ type: 'paragraph', content: '보통 문단' }])
  editor.setTextCursorPosition(editor.document[0].id, 'start')
  check('④-16 단 밖 Backspace 통과', keymap.columnsEdgeShortcuts.Backspace({ editor }) === false)
  editor.setTextCursorPosition(editor.document[0].id, 'end')
  check('④-17 단 밖 Delete 통과', keymap.columnsEdgeShortcuts.Delete({ editor }) === false)
  check('④-18 단 밖 Shift-Tab 통과', keymap.columnsEdgeShortcuts['Shift-Tab']({ editor }) === false)

  load([
    {
      type: 'columns',
      props: { count: 2, meta: '' },
      children: [
        {
          type: 'column',
          props: {},
          children: [
            { type: 'paragraph', content: '머리', children: [{ type: 'paragraph', content: '중첩 끝' }] },
          ],
        },
        { type: 'column', props: {}, children: [{ type: 'paragraph', content: 'z' }] },
      ],
    },
  ])
  const nestedCell = editor.document[0].children[0]
  editor.setTextCursorPosition(nestedCell.children[0].id, 'end')
  const fParent = keymap.readColumnEdgeFacts(editor.prosemirrorState)
  check('④-19 자식 있는 최상위 블록 끝 = 마지막 잎 아님', fParent.isLastLeafOfColumn === false, JSON.stringify(fParent))
  editor.setTextCursorPosition(nestedCell.children[0].children[0].id, 'end')
  const fLeaf = keymap.readColumnEdgeFacts(editor.prosemirrorState)
  check(
    '④-20 중첩 마지막 잎 끝 = 차단 대상',
    fLeaf.isLastLeafOfColumn === true && keymap.shouldBlockDelete(fLeaf) === true,
    JSON.stringify(fLeaf),
  )
  check('④-21 중첩 잎 Shift-Tab 통과(부모가 단이 아님)', keymap.columnsEdgeShortcuts['Shift-Tab']({ editor }) === false)

  // 단 안의 **표** — 셀 이동(Tab/Shift+Tab)·셀 내부 편집을 막으면 회귀다(가드 제외 대상).
  const cell = (text) => [{ type: 'text', text, styles: {} }]
  load([
    {
      type: 'columns',
      props: { count: 2, meta: '' },
      children: [
        {
          type: 'column',
          props: {},
          children: [
            {
              type: 'table',
              content: {
                type: 'tableContent',
                rows: [{ cells: [cell('가'), cell('나')] }, { cells: [cell('다'), cell('라')] }],
              },
            },
          ],
        },
        { type: 'column', props: {}, children: [{ type: 'paragraph', content: 'z' }] },
      ],
    },
  ])
  const tableBlock = editor.document[0].children[0].children[0]
  editor.setTextCursorPosition(tableBlock.id, 'start')
  const fTable = keymap.readColumnEdgeFacts(editor.prosemirrorState)
  check(
    '④-22 표 안 = 가드 전부 해제',
    !fTable.parentIsColumn && !fTable.isFirstTopChildOfColumn && !fTable.isLastLeafOfColumn,
    JSON.stringify(fTable),
  )
  check('④-23 표 안 Shift-Tab 통과(셀 이동 보존)', keymap.columnsEdgeShortcuts['Shift-Tab']({ editor }) === false)
  check('④-24 표 안 Backspace 통과', keymap.columnsEdgeShortcuts.Backspace({ editor }) === false)
  check('④-25 표 안 Delete 통과', keymap.columnsEdgeShortcuts.Delete({ editor }) === false)

  // 신-1(검토 2026-08-30): 단 첫 블록이 문단이 아니면 Backspace 가드는 통과해야 한다 — 목록 불릿 벗기기·헤딩/코드 해제.
  load([cols(2, col(p('첫'), p('둘')), col(p('셋')))].map(toBn))
  const nCont = editor.document.find((b) => b.type === 'columns')
  const nFirst = nCont.children[0].children[0]
  for (const [i, type] of [['26', 'heading'], ['27', 'bulletListItem'], ['28', 'codeBlock']]) {
    editor.updateBlock(nFirst.id, { type })
    editor.setTextCursorPosition(nFirst.id, 'start')
    const f = keymap.readColumnEdgeFacts(editor.prosemirrorState)
    check(`④-${i} 단 첫 ${type} 시작 Backspace 통과`, keymap.columnsEdgeShortcuts.Backspace({ editor }) === false && f.isParagraph === false && f.isFirstTopChildOfColumn === true, JSON.stringify(f))
  }
  editor.updateBlock(nFirst.id, { type: 'paragraph' })
  editor.setTextCursorPosition(nFirst.id, 'start')
  check('④-29 문단으로 되돌리면 다시 차단', keymap.columnsEdgeShortcuts.Backspace({ editor }) === true)
}

console.log(`총 ${pass + fail}건 · 통과 ${pass} · 실패 ${fail}`)
if (failures.length > 0) {
  console.log('실패 목록:')
  for (const f of failures) console.log(`  - ${f}`)
}
process.exit(fail === 0 ? 0 : 1)
