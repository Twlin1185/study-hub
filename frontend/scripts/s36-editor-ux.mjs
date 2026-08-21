// S36(stage-36) 프론트 UX 마감 묶음 **기계 검증** — F-5 · F-6 · F-7.
//
// 실행: node frontend/scripts/s36-editor-ux.mjs
//   (s33/s34 관례 계승 — jiti + `@blocknote/server-util` + `.tsx` 트랜스파일 + `.css` 스텁. 신규 설치 0.)
//
// 검사 5계열:
//   ① 슬래시 전수표(F-5) — `buildSlashItems`가 ⓐ 기본 항목을 하나도 잃지 않고 ⓑ 그룹이 연속으로
//      모이며 ⓒ 수식·콜아웃·참조 경로가 실제로 있고 ⓓ 한/영 별칭으로 검색되는가.
//   ② 드래그 재배열 ↔ 사이드카(F-5) — 블록 **순서를 뒤집어도** 사이드카(블록 id 키)가 그대로
//      붙어 오는가. 드래그는 id를 옮길 뿐 바꾸지 않으므로 이것이 성립해야 계약이다.
//   ③ 표 열 정렬(F-6) — 사이드카 초기값 적재 → **열 삽입/삭제 시 정렬이 함께 이동** → 저장 왕복
//      (플러그인 → 사이드카 → 어댑터 → 앱 블록 `align`)까지 한 줄로.
//   ④ 찾기(F-7) — 원자(참조 칩·인라인 수식) 내부/가로지르기 제외 · 마크로 쪼개진 텍스트 가로지르기
//      성립 · 표 셀 검색 · 수식 블록 제외 · 대소문자 구분.
//   ⑤ 확장 결선(F-6·F-7) — 사이드카 → 초기 정렬 추출 · `extensions` 옵션으로 확장 2종이 실제로 등록.
//
// `--list`를 붙이면 슬래시 **전수표를 Markdown 표로** 출력한다(완료 기록용 — 문서/코드 표류 방지).
import Module, { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { ServerBlockNoteEditor } from '@blocknote/server-util'
import { EditorState, TextSelection } from 'prosemirror-state'
import { addColumnAfter, deleteColumn } from 'prosemirror-tables'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FRONT = path.resolve(HERE, '..')
const SRC = path.join(FRONT, 'src')

// `@blocknote/math-block`은 CJS 엔트리에서 katex CSS를 require한다(s33과 같은 스텁).
Module._extensions['.css'] = (mod) => {
  mod.exports = {}
}

const require = createRequire(path.join(FRONT, 'package.json'))
const jitiBabelTransform = require('jiti/dist/babel')
const ts = require('typescript')
const jiti = require('jiti')(path.join(FRONT, 'scripts/_loader.cjs'), {
  interopDefault: true,
  esmResolve: true,
  cache: false,
  // s33/s34와 달리 **`requireCache: true`**다. 이 스크립트는 `@blocknote/react`(→ core)를 타는
  // 모듈(slashItems)과 `blocknote/schema.ts`를 함께 부르는데, 캐시를 끄면 `@blocknote/core`가
  // 두 번 평가되면서 ProseMirror 선택 jsonID("multiple-node")를 두 번 등록해 터진다(실측).
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

const { markdownToBlocks } = jiti(path.join(SRC, 'editor2/transform/index.ts'))
const { toBlockNoteBlocks, fromBlockNoteResult } = jiti(path.join(SRC, 'editor2/adapter/index.ts'))
const { noteSchema, noteDictionary, asEditorBlocks, asAdapterBlocks } = jiti(
  path.join(SRC, 'editor2/blocknote/schema.ts'),
)
const { composeSlashItems } = jiti(path.join(SRC, 'editor2/blocknote/slash/slashTable.ts'))
const { collectMatches } = jiti(path.join(SRC, 'editor2/blocknote/find/matches.ts'))
const tableAlign = jiti(path.join(SRC, 'editor2/blocknote/tableAlign/tableAlignPlugin.ts'))
const { createTableAlignPlugin, getTableAlignState, readTableAlign } = tableAlign

let pass = 0
let fail = 0
const failures = []

function check(label, ok, detail) {
  if (ok) pass += 1
  else {
    fail += 1
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function eq(label, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  check(label, a === b, a === b ? undefined : `기대 ${b} / 실제 ${a}`)
}

const server = ServerBlockNoteEditor.create({ schema: noteSchema, dictionary: noteDictionary })
const docOf = (blocks) => server._blocksToProsemirrorNode(asEditorBlocks(blocks))

// ---------------------------------------------------------------- ① 슬래시 전수표 (F-5)

{
  // 기본 항목은 **코어**(`@blocknote/core/extensions`)에서 가져온다. react 래퍼
  // (`getDefaultReactSlashMenuItems`)는 같은 배열에 아이콘만 얹을 뿐이고(실측: `{...item, icon}`),
  // 전수표가 다루는 값(key·title·aliases·group)은 코어 쪽이 전부 정한다. 아이콘을 위해 편집기
  // React 패키지를 Node에서 들이면 CJS interop이 깨진다(실측) — 검사 대상도 아니라 코어로 간다.
  const { getDefaultSlashMenuItems } = jiti('@blocknote/core/extensions')
  const { getMathSlashMenuItems } = jiti('@blocknote/math-block')
  const defaults = getDefaultSlashMenuItems(server.editor)
  const mathItems = getMathSlashMenuItems(server.editor)
  // stage-37 F-3·F-4 — 웹 임베드 항목은 커맨드로 열리는 URL 패널을 부른다(삽입은 패널이 한다).
  let webEmbedPanelOpened = false
  const items = composeSlashItems(defaults, mathItems, server.editor, () => {}, () => {
    webEmbedPanelOpened = true
  })

  // `--list`로 부르면 **완료 기록에 실을 전수표**를 그대로 뽑는다(문서와 코드의 표류 방지).
  if (process.argv.includes('--list')) {
    console.log('| # | key | 라벨 | 그룹 | 검색 별칭 |')
    console.log('|---|---|---|---|---|')
    items.forEach((item, index) => {
      console.log(
        `| ${index + 1} | \`${item.key}\` | ${item.title} | ${item.group} | ${(item.aliases ?? []).join(' · ')} |`,
      )
    })
    console.log('')
  }

  const defaultKeys = defaults.map((item) => item.key)
  const builtKeys = new Set(items.map((item) => item.key))
  const missing = defaultKeys.filter((key) => !builtKeys.has(key))
  check('①-a 기본 항목 유실 0', missing.length === 0, missing.join(','))

  // 그룹이 연속으로 모여야 메뉴가 그룹 머리를 두 번 그리지 않는다.
  const groups = []
  for (const item of items) {
    if (groups[groups.length - 1] !== item.group) groups.push(item.group)
  }
  eq('①-b 그룹 순서(중복 없음)', groups, ['기본 블록', '제목', '고급', '콜아웃', '미디어', '참조', '기타'])

  const has = (key) => items.some((item) => item.key === key)
  check('①-c 수식 2종 경로', has('math_block') && has('inline_math'))
  check(
    '①-d 콜아웃 5종 경로',
    ['note', 'warn', 'tip', 'fold', 'hide'].every((variant) => has(`callout_${variant}`)),
  )
  check('①-e 참조 3종 경로', has('ref_doc') && has('ref_anchor') && has('ref_embed'))
  // stage-37 F-3·F-4 — 목차·웹 임베드 슬래시 항목(전수표 2종 가산).
  check('①-e2 목차 항목 경로', has('toc'))
  check('①-e3 웹 임베드 항목 경로', has('web_embed'))
  items.find((item) => item.key === 'web_embed')?.onItemClick?.()
  check('①-e4 웹 임베드 항목이 URL 패널을 연다', webEmbedPanelOpened)

  // 한/영 양방향 검색(필터는 title·aliases 부분 일치 — BlockNote 기본 동작과 같은 판정).
  const matches = (query) =>
    items.filter(
      (item) =>
        item.title.toLowerCase().includes(query.toLowerCase()) ||
        (item.aliases ?? []).some((alias) => alias.toLowerCase().includes(query.toLowerCase())),
    )
  check('①-f "table"로 표 검색', matches('table').some((item) => item.key === 'table'))
  check('①-g "표"로 표 검색', matches('표').some((item) => item.key === 'table'))
  check('①-h "수식"으로 수식 검색', matches('수식').some((item) => item.key === 'math_block'))
  check('①-i "콜아웃"으로 콜아웃 검색', matches('콜아웃').length === 5)
  check('①-j "구분선"으로 구분선 검색', matches('구분선').some((item) => item.key === 'divider'))
  check('①-j2 "목차"로 목차 검색', matches('목차').some((item) => item.key === 'toc'))
  check('①-j3 "웹"으로 웹 임베드 검색', matches('웹').some((item) => item.key === 'web_embed'))
  // 수식 라벨이 한국어 사전을 탄다(= dictionary.math 결선 확인).
  check(
    '①-k 수식 라벨 한국어',
    items.find((item) => item.key === 'math_block')?.title === '수식 블록',
    items.find((item) => item.key === 'math_block')?.title,
  )
}

// ---------------------------------------------------------------- ② 드래그 재배열 ↔ 사이드카 (F-5)

{
  const md = [
    '문단 하나',
    '',
    '[링크](DOC-0001 "제목 있음")',
    '',
    '| a | b |',
    '| :-- | --: |',
    '| 1 | 2 |',
    '',
    '마지막 문단',
    '',
  ].join('\n')

  const app = markdownToBlocks(md)
  const { blocks, sidecar } = toBlockNoteBlocks(app)

  const straight = fromBlockNoteResult(asAdapterBlocks(blocks), sidecar)
  // 드래그 재배열 = **블록 순서만** 바뀌고 id는 그대로. 뒤집어서 같은 사이드카로 되돌린다.
  const reordered = fromBlockNoteResult(asAdapterBlocks([...blocks].reverse()), sidecar)

  const byId = (doc) => Object.fromEntries(doc.blocks.map((block) => [block.id, block]))
  const before = byId(straight.document)
  const after = byId(reordered.document)

  const ids = Object.keys(before)
  check('②-a 재배열 후에도 블록 집합 동일', ids.every((id) => id in after) && ids.length === Object.keys(after).length)
  const same = ids.every((id) => JSON.stringify(before[id]) === JSON.stringify(after[id]))
  check('②-b 재배열 후 블록별 흡수분(링크 제목·표 정렬) 동일', same)
  check('②-c 재배열이 정렬 폐기를 만들지 않는다', reordered.tableAlignDrops.length === 0, reordered.tableAlignDrops.join(','))
}

// ---------------------------------------------------------------- ③ 표 열 정렬 (F-6)

function cell(text) {
  return [{ type: 'text', text, styles: {} }]
}

function tableBlocks(cols, rows) {
  return [
    { id: 'p1', type: 'paragraph', content: [{ type: 'text', text: '앞 문단', styles: {} }] },
    {
      id: 't1',
      type: 'table',
      content: {
        type: 'tableContent',
        columnWidths: new Array(cols).fill(undefined),
        headerRows: 1,
        rows: Array.from({ length: rows }, (_, r) => ({
          cells: Array.from({ length: cols }, (_, c) => cell(`${r}-${c}`)),
        })),
      },
    },
  ]
}

/** 첫 행 `index`번 셀 안쪽의 문서 위치(선택을 놓을 자리). */
function firstRowCellInside(doc, index) {
  let found = null
  doc.descendants((node, pos) => {
    if (found !== null) return false
    if (node.type.spec.tableRole !== 'table') return true
    const row = node.firstChild
    let cellPos = pos + 2
    row.forEach((child, _offset, i) => {
      if (i === index) found = cellPos + 2
      cellPos += child.nodeSize
    })
    return false
  })
  return found
}

function alignOf(state) {
  return getTableAlignState(state).entries[0].align
}

{
  const blocks = tableBlocks(3, 2)
  const doc = docOf(blocks)
  const plugin = createTableAlignPlugin({ t1: ['left', 'center', 'right'] })
  let state = EditorState.create({ doc, plugins: [plugin] })

  eq('③-a 사이드카 초기 정렬 적재', alignOf(state), ['left', 'center', 'right'])

  // 열 수가 어긋난 사이드카는 되살리지 않는다(어댑터 복원 조건과 같은 판정).
  const mismatched = EditorState.create({ doc, plugins: [createTableAlignPlugin({ t1: ['left', 'right'] })] })
  eq('③-b 열 수 불일치 사이드카는 버린다', alignOf(mismatched), [null, null, null])

  // (1) 2번째 열 뒤에 열 추가 → 새 열은 정렬 없음으로 태어나고 뒤 열 정렬은 밀린다.
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, firstRowCellInside(state.doc, 1))))
  addColumnAfter(state, (tr) => {
    state = state.apply(tr)
  })
  eq('③-c 가운데 열 삽입 후 정렬 동반 이동', alignOf(state), ['left', 'center', null, 'right'])

  // (2) 첫 열 삭제 → 그 열의 정렬만 사라지고 나머지는 그대로 당겨진다.
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, firstRowCellInside(state.doc, 0))))
  deleteColumn(state, (tr) => {
    state = state.apply(tr)
  })
  eq('③-d 열 삭제 후 정렬 동반 이동', alignOf(state), ['center', null, 'right'])

  // (3) 셀 안 글자 입력은 정렬을 건드리지 않는다.
  state = state.apply(state.tr.insertText('가나다', firstRowCellInside(state.doc, 0)))
  eq('③-e 셀 편집은 정렬 불변', alignOf(state), ['center', null, 'right'])

  // (4) 사용자가 UI로 가운데 정렬을 고른다 → 그 열만 바뀐다.
  state = state.apply(
    tableAlign.withTableAlignAction(state.tr, { type: 'set', blockId: 't1', colIndex: 1, value: 'center' }),
  )
  eq('③-f 정렬 편집 반영', alignOf(state), ['center', 'center', 'right'])

  // (5) 저장 왕복 — 플러그인 → 사이드카 → 어댑터 → 앱 블록 `align`.
  const sidecar = {}
  for (const [blockId, align] of Object.entries(readTableAlign(state))) {
    if (align.some((value) => value !== null)) sidecar[blockId] = { tableAlign: align }
  }
  const bnBlocks = server._prosemirrorNodeToBlocks(state.doc)
  const result = fromBlockNoteResult(asAdapterBlocks(bnBlocks), sidecar)
  const appTable = result.document.blocks.find((block) => block.type === 'table')
  eq('③-g 저장 왕복 후 앱 블록 align', appTable.align, ['center', 'center', 'right'])
  check('③-h 저장 왕복에 정렬 폐기 0건', result.tableAlignDrops.length === 0, result.tableAlignDrops.join(','))
}

// ---------------------------------------------------------------- ④ 찾기 (F-7)

{
  const blocks = [
    {
      id: 'f1',
      type: 'paragraph',
      content: [
        { type: 'text', text: '가나', styles: {} },
        { type: 'text', text: '다라', styles: { bold: true } },
        { type: 'text', text: '마바', styles: {} },
      ],
    },
    {
      id: 'f2',
      type: 'paragraph',
      content: [
        { type: 'text', text: '앞', styles: {} },
        { type: 'refChip', props: { refType: 'doc', target: 'DOC-0001', label: '뒤앞', styles: '' } },
        { type: 'text', text: '뒤', styles: {} },
      ],
    },
    { id: 'f3', type: 'mathBlock', content: [{ type: 'text', text: 'alpha beta', styles: {} }] },
    {
      id: 'f4',
      type: 'paragraph',
      content: [
        { type: 'text', text: 'x', styles: {} },
        { type: 'math', content: 'alpha' },
        { type: 'text', text: 'y', styles: {} },
      ],
    },
    {
      id: 'f5',
      type: 'table',
      content: {
        type: 'tableContent',
        columnWidths: [undefined, undefined],
        headerRows: 1,
        rows: [{ cells: [cell('셀알파'), cell('b')] }, { cells: [cell('c'), cell('d')] }],
      },
    },
    { id: 'f6', type: 'paragraph', content: [{ type: 'text', text: 'Alpha alpha ALPHA', styles: {} }] },
  ]
  const doc = docOf(blocks)

  check('④-a 마크로 쪼개진 텍스트 가로지르기', collectMatches(doc, '나다', false).length === 1)
  check('④-b 원자(참조 칩)를 가로지르는 일치 없음', collectMatches(doc, '앞뒤', false).length === 0)
  check('④-c 원자 내부 라벨은 검색 대상 아님', collectMatches(doc, '뒤앞', false).length === 0)
  check('④-d 수식 블록 내부 제외', collectMatches(doc, 'beta', false).length === 0)
  check('④-e 인라인 수식 내부 제외 + 가로지르기 없음', collectMatches(doc, 'xy', false).length === 0)
  check('④-f 표 셀은 검색 대상', collectMatches(doc, '셀알파', false).length === 1)
  eq('④-g 대소문자 무시', collectMatches(doc, 'alpha', false).length, 3)
  eq('④-h 대소문자 구분', collectMatches(doc, 'alpha', true).length, 1)

  // 위치가 실제 글자를 가리키는가(치환이 엉뚱한 자리를 자르지 않는다는 계약).
  const hit = collectMatches(doc, '나다', false)[0]
  eq('④-i 일치 위치 = 실제 글자', doc.textBetween(hit.from, hit.to), '나다')
  const alphaHits = collectMatches(doc, 'alpha', true)
  eq('④-j 대소문자 구분 일치 위치', doc.textBetween(alphaHits[0].from, alphaHits[0].to), 'alpha')
}

// ---------------------------------------------------------------- ⑤ 확장 결선 (F-6·F-7)
//
// 두 플러그인은 `useCreateBlockNote({ extensions })`로 실린다. 옵션 이름·팩토리 형태가 어긋나면
// 화면에서만 조용히 죽으므로(플러그인이 없으면 상태 조회가 기본값을 돌려준다) 여기서 못 박는다.
// (PM 플러그인이 **실제 state에 실리는지**는 headless 편집기로 볼 수 없다 — 마운트 전에는
//  `prosemirrorState.plugins`가 비어 있다(실측). 확장 등록까지가 기계로 확인 가능한 경계다.)

{
  const { createEditor2Extensions, tableAlignFromSidecar } = jiti(
    path.join(SRC, 'editor2/blocknote/extensions.ts'),
  )
  const initial = tableAlignFromSidecar({ t9: { tableAlign: ['left', null] }, other: { linkTitles: {} } })
  eq('⑤-a 사이드카 → 초기 정렬 추출', initial, { t9: ['left', null] })

  const wired = ServerBlockNoteEditor.create({
    schema: noteSchema,
    dictionary: noteDictionary,
    extensions: createEditor2Extensions(initial),
  })
  const keys = [...wired.editor.extensions.keys()]
  check('⑤-b 찾기 확장 등록', keys.includes('editor2Find'), keys.join(','))
  check('⑤-c 표 정렬 확장 등록', keys.includes('editor2TableAlign'), keys.join(','))
}

// ----------------------------------------------------------------

console.log(`s36 editor UX: ${pass} passed, ${fail} failed`)
for (const line of failures) console.log(`  FAIL ${line}`)
if (fail > 0) process.exitCode = 1
