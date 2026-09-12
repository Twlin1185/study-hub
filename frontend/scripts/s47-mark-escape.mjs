// stage-47 — **마크 탈출 제스처 자동 검증**(FB-20 · V-2). 실행: `node scripts/s47-mark-escape.mjs`(frontend/).
//
// `s41-columns-editor.mjs` 관례 그대로 — DOM 없이 **실제 `noteSchema`로 헤드리스 편집기**
// (`@blocknote/server-util`)를 만들어 돌린다. jiti 캐시는 켠다(끄면 `@blocknote/core`가 두 번 평가돼
// PM `Duplicate use of selection JSON ID`로 죽는다 — s41 실측).
//
//   ⓐ 순수 판정 전수표 — `shouldEscapeOn{ArrowRight,Space}` × (구간 끝/중간/대기 마크만/빈 pending/
//      직전 공백 마크 유무)
//   ⓑ 커맨드 결과 — 실제 편집기에서 →(커서 불변 + 대기 스타일 마크 0) · Space 2회(공백 1개 + 그 공백
//      마크 0 + 뒤 입력 무마크 + 3회째 정상) · 링크 마크 보존 · bold+spoiler 동시 pending 전부 해제
//   ⓒ columns 상호작용 — **실제 `createEditor2Extensions` 배열**로 만든 편집기의 PM 플러그인 체인에
//      keydown(ArrowRight)을 흘려 단 마지막 블록 끝 + 대기 마크에서 **탈출이 먼저**인지 실측
//   ⓓ 비발동 경로 — `pending = ∅`에서 2키 전부 `false`
//   ⓔ 키 이름 `Space` — prosemirror-keymap 정규화(`" "`)로 실제 keydown이 잡히는지 실측 ·
//      Tab 제거 확인(FB-20 후속 2026-09-12) — 단축키 표에 `Tab` 키 없음 + 실제 체인에서 코어
//      `nestBlock`이 그대로 도는지(문단이 앞 블록 자식으로 중첩)
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
const { keymap: pmKeymap } = require('@tiptap/pm/keymap')
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
const me = jiti(path.join(SRC, 'editor2/blocknote/toolbar/markEscape.ts'))
const extensionsMod = jiti(path.join(SRC, 'editor2/blocknote/extensions.ts'))
const columnsKeymap = jiti(path.join(SRC, 'editor2/blocknote/columnsKeymap.ts'))

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

// ── 편집기: **실제 확장 배열**(`createEditor2Extensions`)을 그대로 꽂는다 — ⓒ가 배열 순서를 실측한다.
// 확장 팩토리는 같은 객체를 돌려주므로(`createExtension(obj)` 실측) 편집기 생성 **전에** 단축키 표를
// 스파이로 감싸 두면 플러그인이 그 스파이를 캡처한다(핸들러 체인 순서 기록용).
const calls = []
const extFactories = extensionsMod.createEditor2Extensions({})
for (const factory of extFactories) {
  const ext = factory()
  if (ext.key === 'editor2ColumnsEdge' || ext.key === 'editor2MarkEscape') {
    const original = ext.keyboardShortcuts.ArrowRight
    ext.keyboardShortcuts.ArrowRight = (ctx) => {
      const handled = original(ctx)
      calls.push(`${ext.key}:${handled}`)
      return handled
    }
  }
}
const server = ServerBlockNoteEditor.create({ schema: noteSchema, extensions: extFactories })
const editor = server.editor
const pmSchema = editor.prosemirrorState.schema
const STYLE_NAMES = me.styleMarkNamesOf(editor)

function load(blocks) {
  editor.replaceBlocks(editor.document, blocks)
  return editor.document
}
const facts = () => me.readMarkEscapeFacts(editor.prosemirrorState, STYLE_NAMES)
const storedStyleNames = () =>
  (editor.prosemirrorState.storedMarks ?? []).map((m) => m.type.name).filter((n) => STYLE_NAMES.has(n)).sort()
const storedNames = () => (editor.prosemirrorState.storedMarks ?? []).map((m) => m.type.name).sort()
const cursorPos = () => editor.prosemirrorState.selection.from
/** 커서 블록(텍스트블록)의 문자별 [문자, 마크 이름 목록] — 마크 검증용. */
function charsOfCursorBlock() {
  const $from = editor.prosemirrorState.selection.$from
  const out = []
  $from.parent.forEach((node) => {
    if (!node.isText) return
    const names = node.marks.map((m) => m.type.name).sort()
    for (const ch of node.text) out.push([ch, names])
  })
  return out
}
const textOfCursorBlock = () => charsOfCursorBlock().map(([ch]) => ch).join('')
function typeText(text) {
  editor.transact((tr) => tr.insertText(text))
}
function setStored(marks) {
  editor.transact((tr) => tr.setStoredMarks(marks))
}
/**
 * PM 키맵 체인 실측 — 플러그인 순서대로 `handleKeyDown`을 돌려 첫 `true`까지(뷰의 `someProp` 순서와 같다).
 *
 * **헤드리스 한계(실측)**: tiptap은 플러그인을 **mount 시점**(`createView` → `state.reconfigure({ plugins })`)
 * 에 상태에 넣으므로 헤드리스 `prosemirrorState.plugins`는 빈 배열이다. 그래서 mount가 쓰는 것과 같은
 * 정렬 목록(`extensionManager.plugins` — 우선순위 정렬 + 배열 뒤집기)을 **검증 스크립트에서만** 내부
 * 참조로 읽는다(제품 코드는 R33대로 `_tiptapEditor` 무접촉 — 여기는 순서 실측용 계측이다).
 */
function orderedPlugins() {
  return editor._tiptapEditor.extensionManager.plugins
}
function fireKey(key, keyCode) {
  const view = editor.prosemirrorView
  const event = { key, keyCode, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, preventDefault() {} }
  for (const plugin of orderedPlugins()) {
    const handler = plugin.props?.handleKeyDown
    if (!handler) continue
    let handled = false
    try {
      handled = handler.call(plugin, view, event) === true
    } catch {
      handled = false
    }
    if (handled) return true
  }
  return false
}

// ══════════════════════════════════════ ⓐ 순수 판정 전수표
{
  const F = (over) => ({ collapsed: true, pending: ['bold'], nextInherits: false, prevIsMarkedSpace: false, ...over })
  const rows = [
    ['구간 끝', F({}), [true, false]],
    ['구간 끝 + 직전 마크 공백', F({ prevIsMarkedSpace: true }), [true, true]],
    ['구간 중간', F({ nextInherits: true }), [false, false]],
    ['구간 중간 + 직전 마크 공백', F({ nextInherits: true, prevIsMarkedSpace: true }), [false, false]],
    ['대기 마크만(버튼 직후 · 글자 0)', F({}), [true, false]],
    ['빈 pending', F({ pending: [] }), [false, false]],
    ['빈 pending + 직전 마크 공백', F({ pending: [], prevIsMarkedSpace: true }), [false, false]],
    ['선택 범위 있음', F({ collapsed: false }), [false, false]],
    ['복수 pending(bold+spoiler) 구간 끝', F({ pending: ['bold', 'spoiler'] }), [true, false]],
  ]
  let i = 0
  for (const [label, f, [r, s]] of rows) {
    i += 1
    check(`ⓐ-${i} ${label}: →=${r}`, me.shouldEscapeOnArrowRight(f) === r)
    check(`ⓐ-${i} ${label}: Space=${s}`, me.shouldEscapeOnSpace(f) === s)
  }
}

// ══════════════════════════════════════ ⓑ 커맨드 결과(실제 편집기)
{
  // ⓑ-1 사실 추출: 굵게 구간 끝
  load([{ type: 'paragraph', content: [{ type: 'text', text: 'abc', styles: { bold: true } }] }])
  editor.setTextCursorPosition(editor.document[0].id, 'end')
  let f = facts()
  check('ⓑ-1 사실: 굵게 끝 = collapsed·pending[bold]·!nextInherits', f.collapsed && f.pending.join() === 'bold' && !f.nextInherits, JSON.stringify(f))

  // ⓑ-2 사실 추출: 굵게 구간 중간
  editor.setTextCursorPosition(editor.document[0].id, 'start')
  editor.transact((tr) => tr.setSelection(tr.selection.constructor.create(tr.doc, tr.selection.from + 1)))
  f = facts()
  check('ⓑ-2 사실: 굵게 중간 = nextInherits', f.pending.join() === 'bold' && f.nextInherits === true, JSON.stringify(f))
  check('ⓑ-2b 중간에서 → = 통과(코어 이동)', me.markEscapeShortcuts.ArrowRight({ editor }) === false)

  // ⓑ-3 →: 커서 불변 + 대기 스타일 마크 0
  editor.setTextCursorPosition(editor.document[0].id, 'end')
  const posBefore = cursorPos()
  check('ⓑ-3 → 발동', me.markEscapeShortcuts.ArrowRight({ editor }) === true)
  check('ⓑ-3a → 커서 위치 불변', cursorPos() === posBefore, `${posBefore} → ${cursorPos()}`)
  check('ⓑ-3b → 대기 스타일 마크 0(storedMarks=[])', editor.prosemirrorState.storedMarks !== null && storedStyleNames().length === 0, JSON.stringify(storedNames()))
  check('ⓑ-3c 탈출 뒤 두 번째 → = 통과(정상 이동)', me.markEscapeShortcuts.ArrowRight({ editor }) === false)
  typeText('x')
  check('ⓑ-3d 탈출 뒤 입력 = 무마크', JSON.stringify(charsOfCursorBlock()) === JSON.stringify([['a', ['bold']], ['b', ['bold']], ['c', ['bold']], ['x', []]]), JSON.stringify(charsOfCursorBlock()))

  // ⓑ-4 구간 끝 + 대기 마크 + Tab(FB-20 후속 2026-09-12): 우리 확장은 Tab 핸들러를 등록하지
  // 않는다 — 전용 판정 함수가 없으므로 단축키 표 키 목록만 단언.
  load([{ type: 'paragraph', content: [{ type: 'text', text: 'abc', styles: { italic: true } }] }])
  editor.setTextCursorPosition(editor.document[0].id, 'end')
  check('ⓑ-4 구간 끝(대기 마크 있음)에서도 핸들러 목록에 Tab 없음', facts().pending.join() === 'italic' && Object.keys(me.markEscapeShortcuts).indexOf('Tab') === -1, JSON.stringify(Object.keys(me.markEscapeShortcuts)))

  // ⓑ-5 Space 2회: 1회째는 코어(상속 마크 붙은 공백) · 2회째 = 치환
  load([{ type: 'paragraph', content: [{ type: 'text', text: 'abc', styles: { bold: true } }] }])
  editor.setTextCursorPosition(editor.document[0].id, 'end')
  check('ⓑ-5 1회째 Space = 통과(코어 삽입)', me.markEscapeShortcuts.Space({ editor }) === false)
  typeText(' ')
  check('ⓑ-5a 1회째 공백은 굵게 상속', JSON.stringify(charsOfCursorBlock()[3]) === JSON.stringify([' ', ['bold']]), JSON.stringify(charsOfCursorBlock()))
  f = facts()
  check('ⓑ-5b 사실: prevIsMarkedSpace', f.prevIsMarkedSpace === true && f.pending.join() === 'bold', JSON.stringify(f))
  const posSpace = cursorPos()
  check('ⓑ-5c 2회째 Space 발동', me.markEscapeShortcuts.Space({ editor }) === true)
  check('ⓑ-5d 문서 텍스트 = "abc "(공백 1개)', textOfCursorBlock() === 'abc ', JSON.stringify(textOfCursorBlock()))
  check('ⓑ-5e 그 공백 마크 0', JSON.stringify(charsOfCursorBlock()[3]) === JSON.stringify([' ', []]), JSON.stringify(charsOfCursorBlock()))
  check('ⓑ-5f 커서는 공백 뒤 그대로', cursorPos() === posSpace)
  check('ⓑ-5g 대기 스타일 마크 0', storedStyleNames().length === 0)
  check('ⓑ-5h 3회째 Space = 통과(정상 삽입 · 폭주 없음)', me.markEscapeShortcuts.Space({ editor }) === false)
  typeText('x')
  check('ⓑ-5i 뒤 입력 무마크', JSON.stringify(charsOfCursorBlock()[4]) === JSON.stringify(['x', []]), JSON.stringify(charsOfCursorBlock()))

  // ⓑ-6 링크 마크 보존 — 굵게+링크 "abc" 뒤에 링크만 "def"(구간 끝 · 링크 위)
  load([
    {
      type: 'paragraph',
      content: [
        {
          type: 'link',
          href: 'https://example.test/',
          content: [
            { type: 'text', text: 'abc', styles: { bold: true } },
            { type: 'text', text: 'def', styles: {} },
          ],
        },
      ],
    },
  ])
  editor.setTextCursorPosition(editor.document[0].id, 'start')
  editor.transact((tr) => tr.setSelection(tr.selection.constructor.create(tr.doc, tr.selection.from + 3)))
  f = facts()
  check('ⓑ-6 사실: 링크 위 굵게 끝 = pending[bold]만(link 제외)·!nextInherits', f.pending.join() === 'bold' && f.nextInherits === false, JSON.stringify(f))
  check('ⓑ-6a → 발동', me.markEscapeShortcuts.ArrowRight({ editor }) === true)
  check('ⓑ-6b 대기 마크 = [link]만(링크 보존)', JSON.stringify(storedNames()) === JSON.stringify(['link']), JSON.stringify(storedNames()))
  typeText('x')
  check('ⓑ-6c 뒤 입력 = 링크만', JSON.stringify(charsOfCursorBlock()[3]) === JSON.stringify(['x', ['link']]), JSON.stringify(charsOfCursorBlock()))

  // ⓑ-6d 링크+굵게 공백 치환에서도 링크 보존
  load([
    {
      type: 'paragraph',
      content: [{ type: 'link', href: 'https://example.test/', content: [{ type: 'text', text: 'abc', styles: { bold: true } }] }],
    },
  ])
  editor.setTextCursorPosition(editor.document[0].id, 'end')
  setStored([pmSchema.marks.bold.create(), pmSchema.marks.link.create({ href: 'https://example.test/' })])
  typeText(' ')
  check('ⓑ-6d 링크+굵게 공백', JSON.stringify(charsOfCursorBlock()[3]) === JSON.stringify([' ', ['bold', 'link']]), JSON.stringify(charsOfCursorBlock()))
  check('ⓑ-6e 2회째 Space 발동', me.markEscapeShortcuts.Space({ editor }) === true)
  // 링크 끝에서는 PM이 `link`(non-inclusive)를 `$cursor.marks()`에서 이미 뺀다(코어 exitable) — 그래서
  // 대기 마크는 `[]`가 정상이고, 검증 대상은 "문서의 공백에서 **링크 마크가 살아남는가**"다.
  check('ⓑ-6f 공백 = 링크만 남음(링크 무접촉) · 대기 스타일 0', JSON.stringify(charsOfCursorBlock()[3]) === JSON.stringify([' ', ['link']]) && storedStyleNames().length === 0, JSON.stringify(charsOfCursorBlock()) + JSON.stringify(storedNames()))

  // ⓑ-7 bold+spoiler 동시 pending → 전부 해제
  load([{ type: 'paragraph', content: [{ type: 'text', text: 'abc', styles: { bold: true, spoiler: true } }] }])
  editor.setTextCursorPosition(editor.document[0].id, 'end')
  f = facts()
  check('ⓑ-7 사실: pending = [bold, spoiler]', [...f.pending].sort().join() === 'bold,spoiler', JSON.stringify(f))
  check('ⓑ-7a → 발동', me.markEscapeShortcuts.ArrowRight({ editor }) === true)
  check('ⓑ-7b 대기 스타일 마크 0', storedStyleNames().length === 0, JSON.stringify(storedNames()))
  // 같은 조합의 Space 2회
  load([{ type: 'paragraph', content: [{ type: 'text', text: 'abc', styles: { bold: true, spoiler: true } }] }])
  editor.setTextCursorPosition(editor.document[0].id, 'end')
  typeText(' ')
  check('ⓑ-7c Space 2회째 발동', me.markEscapeShortcuts.Space({ editor }) === true)
  check('ⓑ-7d 공백 마크 0 · 텍스트 "abc "', JSON.stringify(charsOfCursorBlock()[3]) === JSON.stringify([' ', []]) && textOfCursorBlock() === 'abc ', JSON.stringify(charsOfCursorBlock()))

  // ⓑ-8 `t`(글자색) 문자열 스타일도 대상
  load([{ type: 'paragraph', content: [{ type: 'text', text: 'abc', styles: { t: '[["c","red"]]' } }] }])
  editor.setTextCursorPosition(editor.document[0].id, 'end')
  f = facts()
  check('ⓑ-8 사실: pending = [t]', f.pending.join() === 't', JSON.stringify(f))
  check('ⓑ-8a → 발동 + 대기 스타일 0', me.markEscapeShortcuts.ArrowRight({ editor }) === true && storedStyleNames().length === 0)

  // ⓑ-9 버튼 직후(글자 0) — 대기 마크만 걸린 상태도 구간 끝
  load([{ type: 'paragraph', content: 'plain' }])
  editor.setTextCursorPosition(editor.document[0].id, 'end')
  setStored([pmSchema.marks.bold.create()])
  f = facts()
  check('ⓑ-9 사실: 대기 마크만 = 구간 끝', f.pending.join() === 'bold' && !f.nextInherits && !f.prevIsMarkedSpace, JSON.stringify(f))
  check('ⓑ-9a Space = 통과(직전 공백 없음)', me.markEscapeShortcuts.Space({ editor }) === false)
  check('ⓑ-9b → 발동 + 대기 스타일 0', me.markEscapeShortcuts.ArrowRight({ editor }) === true && storedStyleNames().length === 0)

  // ⓑ-10 무마크 공백 뒤 버튼(대기 굵게) — 직전 공백에 마크가 없으니 Space는 정상
  load([{ type: 'paragraph', content: 'plain ' }])
  editor.setTextCursorPosition(editor.document[0].id, 'end')
  setStored([pmSchema.marks.bold.create()])
  check('ⓑ-10 무마크 공백 뒤 대기 굵게: Space = 통과', me.markEscapeShortcuts.Space({ editor }) === false)

  // ⓑ-11 표 안: →·Space는 동작(Tab 제거 후에도 무회귀)
  const cell = (text, styles = {}) => [{ type: 'text', text, styles }]
  load([
    {
      type: 'table',
      content: {
        type: 'tableContent',
        rows: [{ cells: [cell('가', { bold: true }), cell('나')] }, { cells: [cell('다'), cell('라')] }],
      },
    },
  ])
  editor.setTextCursorPosition(editor.document[0].id, 'start')
  // 첫 셀 텍스트 끝으로 (셀 문단 시작 + 1글자)
  editor.transact((tr) => tr.setSelection(tr.selection.constructor.create(tr.doc, tr.selection.from + 1)))
  f = facts()
  check('ⓑ-11 사실: 표 안 굵게 끝 = pending[bold]·!nextInherits', f.pending.join() === 'bold' && !f.nextInherits, JSON.stringify(f))
  check('ⓑ-11b 표 안 → 발동', me.markEscapeShortcuts.ArrowRight({ editor }) === true && storedStyleNames().length === 0)
  editor.transact((tr) => tr.setStoredMarks(null))
  typeText(' ')
  check('ⓑ-11c 표 안 Space 2회째 발동', me.markEscapeShortcuts.Space({ editor }) === true && textOfCursorBlock() === '가 ', JSON.stringify(charsOfCursorBlock()))
}

// ══════════════════════════════════════ ⓒ columns 상호작용 — 실제 플러그인 체인 순서 실측
{
  load([
    {
      type: 'columns',
      props: { count: 2, meta: '' },
      children: [
        { type: 'column', props: {}, children: [{ type: 'paragraph', content: [{ type: 'text', text: 'ab', styles: { bold: true } }] }] },
        { type: 'column', props: {}, children: [{ type: 'paragraph', content: 'cd' }] },
      ],
    },
  ])
  const cols = editor.document[0]
  const firstLeaf = cols.children[0].children[0]
  editor.setTextCursorPosition(firstLeaf.id, 'end')
  const cf = columnsKeymap.readColumnEdgeFacts(editor.prosemirrorState)
  check('ⓒ-0 전제: 단 마지막 블록 끝 + 대기 굵게', cf.inColumn && cf.atBlockEnd && facts().pending.join() === 'bold', JSON.stringify(cf))
  calls.length = 0
  const pos1 = cursorPos()
  const handled1 = fireKey('ArrowRight', 39)
  check('ⓒ-1 첫 → = 처리됨', handled1 === true)
  check('ⓒ-1a 첫 → = 탈출이 먼저(markEscape가 먼저 호출·true · columns 미호출)', calls[0] === 'editor2MarkEscape:true' && !calls.some((c) => c.startsWith('editor2ColumnsEdge')), JSON.stringify(calls))
  check('ⓒ-1b 커서 이동 없음 + 대기 스타일 0', cursorPos() === pos1 && storedStyleNames().length === 0 && editor.getTextCursorPosition().block.id === firstLeaf.id)
  calls.length = 0
  const handled2 = fireKey('ArrowRight', 39)
  check('ⓒ-2 두 번째 → = 처리됨(단 이동)', handled2 === true)
  check('ⓒ-2a 체인: markEscape false → columns true', JSON.stringify(calls) === JSON.stringify(['editor2MarkEscape:false', 'editor2ColumnsEdge:true']), JSON.stringify(calls))
  check('ⓒ-2b 커서 = 2단 첫 블록', editor.getTextCursorPosition().block.id === cols.children[1].children[0].id)
  // 확장 배열 순서 명시 확인(columns 앞 · markEscape 뒤)
  const keys = extFactories.map((f) => f().key)
  check('ⓒ-3 확장 배열: columns 앞 · markEscape 뒤', keys.indexOf('editor2ColumnsEdge') < keys.indexOf('editor2MarkEscape'), JSON.stringify(keys))
}

// ══════════════════════════════════════ ⓓ 비발동 경로 — pending = ∅
{
  load([{ type: 'paragraph', content: 'plain text' }])
  editor.setTextCursorPosition(editor.document[0].id, 'end')
  const f = facts()
  check('ⓓ-0 사실: pending ∅', f.pending.length === 0, JSON.stringify(f))
  check('ⓓ-1 → false', me.markEscapeShortcuts.ArrowRight({ editor }) === false)
  check('ⓓ-3 Space false', me.markEscapeShortcuts.Space({ editor }) === false)
  check('ⓓ-4 storedMarks 무접촉(null 유지)', editor.prosemirrorState.storedMarks === null)
  // 무마크 공백 2개 연속도 무발동
  typeText(' ')
  check('ⓓ-5 무마크 공백 뒤 Space false', me.markEscapeShortcuts.Space({ editor }) === false)
  // 노드 선택(범위)에서도 무발동
  load([{ type: 'paragraph', content: [{ type: 'text', text: 'abc', styles: { bold: true } }] }])
  editor.setTextCursorPosition(editor.document[0].id, 'start')
  editor.transact((tr) => tr.setSelection(tr.selection.constructor.create(tr.doc, tr.selection.from, tr.selection.from + 3)))
  check('ⓓ-6 범위 선택: 2키 false', me.markEscapeShortcuts.ArrowRight({ editor }) === false && me.markEscapeShortcuts.Space({ editor }) === false)
}

// ══════════════════════════════════════ ⓔ 키 이름 `Space` — prosemirror-keymap 정규화 실측
{
  let hits = 0
  const plugin = pmKeymap({ Space: () => (hits += 1, true) })
  const view = { state: editor.prosemirrorState, dispatch() {} }
  const spaceEvent = { key: ' ', keyCode: 32, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false }
  check('ⓔ-1 `Space` 바인딩이 key=" " keydown을 잡는다', plugin.props.handleKeyDown(view, spaceEvent) === true && hits === 1)
  // 실제 편집기 체인에서도: 굵게 공백 뒤 Space keydown → 우리 핸들러가 치환 처리
  load([{ type: 'paragraph', content: [{ type: 'text', text: 'abc', styles: { bold: true } }] }])
  editor.setTextCursorPosition(editor.document[0].id, 'end')
  typeText(' ')
  const handled = fireKey(' ', 32)
  check('ⓔ-2 실제 체인: 2회째 Space keydown 처리 + 공백 무마크', handled === true && JSON.stringify(charsOfCursorBlock()[3]) === JSON.stringify([' ', []]), JSON.stringify(charsOfCursorBlock()))
  // Tab 제거 실측(FB-20 후속 2026-09-12) — 단축키 표에 Tab 핸들러가 없고, 구간 끝(대기 마크
  // 있음)에서도 실제 keydown 체인이 **1회째부터** 코어 `nestBlock`을 그대로 실행한다(우리 확장
  // 미개입 · 탈출 없음).
  check('ⓔ-3 단축키 표에 Tab 없음(핸들러 미등록)', JSON.stringify(Object.keys(me.markEscapeShortcuts)) === JSON.stringify(['ArrowRight', 'Space']), JSON.stringify(Object.keys(me.markEscapeShortcuts)))
  load([{ type: 'paragraph', content: 'x' }, { type: 'paragraph', content: [{ type: 'text', text: 'abc', styles: { bold: true } }] }])
  editor.setTextCursorPosition(editor.document[1].id, 'end')
  const preTabFacts = facts()
  check('ⓔ-3a 전제: 구간 끝(대기 굵게)', preTabFacts.pending.join() === 'bold' && !preTabFacts.nextInherits, JSON.stringify(preTabFacts))
  const tabHandled = fireKey('Tab', 9)
  check(
    'ⓔ-4 실제 체인: 1회째 Tab부터 코어 nestBlock 그대로(문단이 앞 블록 자식으로 · 대기 마크 무접촉)',
    tabHandled === true && editor.document.length === 1 && editor.document[0].children.length === 1 && facts().pending.join() === 'bold',
    JSON.stringify(editor.document.map((b) => [b.type, b.children.length])) + ' ' + JSON.stringify(facts()),
  )
}

console.log(`총 ${pass + fail}건 · 통과 ${pass} · 실패 ${fail}`)
if (fail > 0) {
  console.log('실패 목록:')
  for (const f of failures) console.log(`  - ${f}`)
}
process.exit(fail === 0 ? 0 : 1)
