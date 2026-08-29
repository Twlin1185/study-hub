// S41(stage-41) 흐름형 다단 검증 — F-1(스키마·어댑터·변환기) · F-5(왕복 코퍼스·실문서).
//
// 실행: node frontend/scripts/s41-columns-roundtrip.mjs [db경로]
//   (프론트 유틸이라 pytest 대상이 아니다 — 불변 규칙 7의 "실행 스모크". TS 모듈은 s30 이후
//    관례 그대로 jiti로 불러온다 — 신규 설치 0. DB는 **읽기 전용 임시 복사본**으로만 만진다.)
//
// 검사 5계열(stage-41 규약 A·C):
//   ① 정규형        : `:::columns{n=…}` 표본이 md→블록→md에서 **바이트 동일**(정규형 = 직렬화
//                     고정점)이고 블록 왕복이 동형인가. 펜스 길이 산정이 콜아웃과 **같은 단일
//                     출처**라 자식에 콜아웃/columns가 있으면 바깥 펜스가 자동으로 길어지는가.
//   ② 정규화 수용   : `n` 결손·속성 순서·정수 표기 흔들림(`n=03`) 같은 비정규 **표기**는 파싱이
//                     수용하고 직렬화가 정규형으로 수렴시키되 방언 의미가 안 바뀌는가.
//   ③ 값 보존·폴백  : 범위 밖 `n=4`·비정수 `n=abc`·미지 속성이 **손실 0**으로 왕복하는가
//                     (강등은 렌더 몫 — 데이터는 손대지 않는다) + 라벨 동반 `:::columns[제목]`은
//                     스키마에 흡수되지 않고 **원문 보존**(sourceFallback)으로 가는가.
//   ④ 어댑터        : 블록 ↔ BlockNote JSON 왕복 — `count`(number)·`meta`(attrs+provenance 통짜
//                     JSON) **완전 왕복**과 **사이드카 불요**, 그리고 컨테이너 자식이 형제로
//                     새지 않는가(fromBlockNote 컨테이너 예외) + 실제 `noteSchema` 적재 왕복.
//                     ※ 편집 표면 스펙 등록은 **묶음 B**의 몫이다 — 미등록이면 적재 단계만
//                       `pending(스펙 미등록)`으로 보고하고 실패로 치지 않는다.
//   ⑤ 실문서 코퍼스 : study.db 전건에서 **directive 이름 `columns` 표본 수**(예상 0)를 실측하고,
//                     산출 블록에 columns 0건 + 프로젝션 고정점(= 기존 문서 변환 diff 0).
import Module, { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { stable, stripIds } from './s32-normalize.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FRONT = path.resolve(HERE, '..')
const SRC = path.join(FRONT, 'src')

// `@blocknote/math-block`(schema.ts가 불러온다)은 CJS 엔트리에서 katex CSS를 require한다 —
// Node/jiti는 CSS를 JS로 파싱하려다 깨진다. s33/s37과 같은 스텁(스크립트 전용).
Module._extensions['.css'] = (mod) => {
  mod.exports = {}
}

const require = createRequire(path.join(FRONT, 'package.json'))
// 커스텀 스펙은 `.tsx`(React 렌더 컴포넌트) — jiti 1.x 기본 변환은 JSX를 모른다(s33·s37 관례).
const jitiBabelTransform = require('jiti/dist/babel')
const ts = require('typescript')

const jiti = require('jiti')(path.join(FRONT, 'scripts/_loader.cjs'), {
  interopDefault: true,
  esmResolve: true,
  cache: false,
  requireCache: false,
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

const { markdownToBlocks, blocksToMarkdown, parseToMdast } = jiti(path.join(SRC, 'editor2/transform/index.ts'))
const { toBlockNoteBlocks, fromBlockNoteBlocks } = jiti(path.join(SRC, 'editor2/adapter/index.ts'))

// ---------------------------------------------------------------- 공통 유틸

let pass = 0
let fail = 0
const failures = []
const notes = []

function check(label, ok, detail) {
  if (ok) pass += 1
  else {
    fail += 1
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const sections = []
let marked = 0
function mark(label) {
  const total = pass + fail
  sections.push({ label, count: total - marked })
  marked = total
}

function walkBlocks(blocks, fn) {
  for (const block of blocks ?? []) {
    fn(block)
    walkBlocks(block.children, fn)
  }
}

function countTypes(blocks) {
  const out = { columns: 0, callout: 0, sourceFallback: 0 }
  walkBlocks(blocks, (block) => {
    if (block.type in out) out[block.type] += 1
  })
  return out
}

/**
 * 방언 의미의 독립 관측 — 변환기를 통하지 않고 **mdast에서 직접** container directive의
 * 이름·속성을 훑는다(변환기가 정보를 흘리면 양쪽이 똑같이 흘려 통과하는 공허한 검사를 피한다).
 */
function dialectShape(md) {
  const root = parseToMdast(md)
  const out = []
  const walk = (node) => {
    if (node.type === 'containerDirective') out.push({ name: node.name ?? '', attrs: { ...(node.attributes ?? {}) } })
    for (const child of node.children ?? []) walk(child)
  }
  if (root) walk(root)
  return stable(out)
}

/** mdast 전체에서 container directive 이름별 개수(실문서 실측용 — 변환기 무관). */
function directiveNameCounts(md) {
  const out = new Map()
  const root = parseToMdast(md)
  const walk = (node) => {
    if (node.type === 'containerDirective') {
      const name = node.name ?? ''
      out.set(name, (out.get(name) ?? 0) + 1)
    }
    for (const child of node.children ?? []) walk(child)
  }
  if (root) walk(root)
  return out
}

const eq = (a, b) => stable(stripIds(a)) === stable(stripIds(b))

// ---------------------------------------------------------------- ① 정규형 왕복·고정점

const CANON = [
  ['2단 문단 2개', ':::columns{n=2}\n첫 문단입니다.\n\n둘째 문단입니다.\n:::'],
  ['3단 문단', ':::columns{n=3}\n하나.\n\n둘.\n\n셋.\n:::'],
  ['2단 + 목록', ':::columns{n=2}\n- 가\n- 나\n- 다\n:::'],
  ['2단 + 표', ':::columns{n=2}\n| 머리 | 값 |\n| --- | --- |\n| 가 | 1 |\n:::'],
  ['2단 + 코드', ':::columns{n=2}\n```js\nconst a = 1\n```\n:::'],
  ['2단 + 이미지', ':::columns{n=2}\n![그림](/sources/images/a.png)\n:::'],
  ['3단 + 수식 블록', ':::columns{n=3}\n$$\nx^2\n$$\n:::'],
  ['2단 + 헤딩·인용 혼합', ':::columns{n=2}\n## 절 제목\n\n> 인용문\n:::'],
  // 자식에 콜아웃이 있으면 **바깥 펜스가 길어진다**(calloutFence 단일 출처).
  ['2단 안 콜아웃(바깥 펜스 4)', '::::columns{n=2}\n:::note[안내]\n콜아웃 본문\n:::\n::::'],
  ['빈 자식', ':::columns{n=2}\n:::'],
  ['미지 속성 동반', ':::columns{n=2 x=1}\n본문\n:::'],
  ['범위 밖 n=4(값 보존)', ':::columns{n=4}\n본문\n:::'],
  ['비정수 n=abc(원문 보존)', ':::columns{n=abc}\n본문\n:::'],
  // 유입 데이터의 중첩은 **보존**한다(입력 UI가 막을 뿐 — 표시만 1단으로 강등).
  ['콜아웃 안 columns(유입 보존)', '::::note[안내]\n:::columns{n=2}\n속 본문\n:::\n::::'],
  ['columns 안 columns(유입 보존)', '::::columns{n=2}\n:::columns{n=3}\n속 본문\n:::\n::::'],
  ['문서 혼합(앞뒤 문단)', '앞 문단.\n\n:::columns{n=2}\n단 본문.\n:::\n\n뒤 문단.'],
  ['연속 2개', ':::columns{n=2}\n가.\n:::\n\n:::columns{n=3}\n나.\n:::'],
]

for (const [label, md] of CANON) {
  const doc = markdownToBlocks(md)
  const md1 = blocksToMarkdown(doc)
  const doc2 = markdownToBlocks(md1)
  const md2 = blocksToMarkdown(doc2)
  const counts = countTypes(doc.blocks)
  check(`[정규형] ${label} — 직렬화 = 원문 바이트 동일`, md1 === md, `투영=${JSON.stringify(md1)}`)
  check(`[정규형] ${label} — 블록 왕복 동형`, eq(doc.blocks, doc2.blocks))
  check(`[정규형] ${label} — 고정점(2차 투영 동일)`, md1 === md2)
  check(`[정규형] ${label} — 원문 보존 폴백 0건`, counts.sourceFallback === 0, `fallback=${counts.sourceFallback}`)
  check(`[정규형] ${label} — 스키마 버전 1 유지`, doc.version === 1, `version=${doc.version}`)
}

// 중첩 표본은 **정말로 중첩 구조로** 살아 있는가(평탄화되면 위 왕복은 통과해도 모델이 틀린다).
{
  const inCallout = markdownToBlocks('::::note[안내]\n:::columns{n=2}\n속\n:::\n::::').blocks
  check(
    '[정규형] 콜아웃 안 columns — 자식으로 중첩 보존',
    inCallout[0]?.type === 'callout' && inCallout[0].children?.[0]?.type === 'columns',
    stable(stripIds(inCallout)),
  )
  const inColumns = markdownToBlocks('::::columns{n=2}\n:::columns{n=3}\n속\n:::\n::::').blocks
  check(
    '[정규형] columns 안 columns — 자식으로 중첩 보존(count 2/3)',
    inColumns[0]?.type === 'columns' &&
      inColumns[0].count === 2 &&
      inColumns[0].children?.[0]?.type === 'columns' &&
      inColumns[0].children[0].count === 3,
    stable(stripIds(inColumns)),
  )
  const empty = markdownToBlocks(':::columns{n=2}\n:::').blocks[0]
  check('[정규형] 빈 자식 = children []', empty?.type === 'columns' && empty.children.length === 0, stable(stripIds(empty)))
  // 스키마 형태 못 박기 — prop 도메인이 조용히 넓어지지 않게 한다.
  const plain = markdownToBlocks(':::columns{n=3}\n본문\n:::').blocks[0]
  check(
    '[정규형] 블록 키 = children,count,id,type (미지 속성 없으면 attrs 부재)',
    stable(Object.keys(plain).sort()) === stable(['children', 'count', 'id', 'type']),
    `키=${Object.keys(plain)}`,
  )
}
mark('① 정규형 왕복·고정점')

// ---------------------------------------------------------------- ② 비정규 **표기** 정규화 수용

const NORMALIZED = [
  ['n 결손 → 기본 2', ':::columns\n본문\n:::', ':::columns{n=2}\n본문\n:::'],
  ['속성 순서(n이 앞으로)', ':::columns{x=1 n=3}\n본문\n:::', ':::columns{n=3 x=1}\n본문\n:::'],
  ['정수 표기 흔들림(n=03)', ':::columns{n=03}\n본문\n:::', ':::columns{n=3}\n본문\n:::'],
  ['인용 속성(n="2")', ':::columns{n="2"}\n본문\n:::', ':::columns{n=2}\n본문\n:::'],
  ['여분 공백', ':::columns{n=2    x=1}\n본문\n:::', ':::columns{n=2 x=1}\n본문\n:::'],
  ['펜스 5(내용에 3 없음 → 3으로 수렴)', ':::::columns{n=2}\n본문\n:::::', ':::columns{n=2}\n본문\n:::'],
]

for (const [label, md, expected] of NORMALIZED) {
  const md1 = blocksToMarkdown(markdownToBlocks(md))
  const md2 = blocksToMarkdown(markdownToBlocks(md1))
  check(`[정규화] ${label} — 정규형 수렴`, md1 === expected, `투영=${JSON.stringify(md1)}`)
  check(`[정규화] ${label} — 고정점`, md1 === md2)
  check(
    `[정규화] ${label} — 재파싱 블록 동형(의미 무변)`,
    eq(markdownToBlocks(md).blocks, markdownToBlocks(md1).blocks),
  )
}

// 정규화가 방언 이름을 바꾸지 않는가(독립 관측).
for (const [, md] of NORMALIZED) {
  const md1 = blocksToMarkdown(markdownToBlocks(md))
  const namesOf = (s) => stable(JSON.parse(dialectShape(s)).map((d) => d.name))
  check(`[정규화] directive 이름 무변`, namesOf(md) === namesOf(md1), `${namesOf(md)} → ${namesOf(md1)}`)
}
mark('② 비정규 표기 정규화 수용')

// ---------------------------------------------------------------- ③ 값 보존 · 라벨 동반 폴백

{
  // 규약 A — 범위 밖 값은 **자르지 않는다**(표시 강등은 렌더 몫).
  // 넷째 칸은 **기대 투영**(생략 = 원문 그대로). `n=""`만 기존 `attrString` 관례(빈 값 = 맨 키)로
  // `{n}`에 수렴한다 — 값(빈 문자열)은 그대로라 손실이 아니라 표기 정규화다.
  for (const [label, md, expectCount, expectAttrs, expectMd] of [
    ['n=4', ':::columns{n=4}\n본문\n:::', 4, undefined],
    ['n=1', ':::columns{n=1}\n본문\n:::', 1, undefined],
    ['n=0', ':::columns{n=0}\n본문\n:::', 0, undefined],
    ['n=-2', ':::columns{n=-2}\n본문\n:::', -2, undefined],
    ['n=12', ':::columns{n=12}\n본문\n:::', 12, undefined],
    // 비정수는 count 기본 2 + 원문 쌍을 attrs로 보존한다(재직렬화에서 원문이 살아난다).
    ['n=abc', ':::columns{n=abc}\n본문\n:::', 2, [['n', 'abc']]],
    ['n=2.5', ':::columns{n=2.5}\n본문\n:::', 2, [['n', '2.5']]],
    ['n 빈 값', ':::columns{n=""}\n본문\n:::', 2, [['n', '']], ':::columns{n}\n본문\n:::'],
  ]) {
    const block = markdownToBlocks(md).blocks[0]
    const md1 = blocksToMarkdown(markdownToBlocks(md))
    check(`[값보존] ${label} — count=${expectCount}`, block?.type === 'columns' && block.count === expectCount, `실제=${block?.count}`)
    check(
      `[값보존] ${label} — attrs 보존`,
      stable(block?.attrs) === stable(expectAttrs),
      `attrs=${stable(block?.attrs)}`,
    )
    check(`[값보존] ${label} — 재직렬화 유지`, md1 === (expectMd ?? md), `투영=${JSON.stringify(md1)}`)
    check(`[값보존] ${label} — 재파싱 블록 동형(값 무손실)`, eq(markdownToBlocks(md).blocks, markdownToBlocks(md1).blocks))
    check(`[값보존] ${label} — 고정점`, md1 === blocksToMarkdown(markdownToBlocks(md1)))
  }

  // 미지 속성은 순서까지 통짜 보존(콜아웃 전례).
  const multi = markdownToBlocks(':::columns{n=2 x=1 y=zz}\n본문\n:::').blocks[0]
  check('[값보존] 미지 속성 다중 — 순서 보존', stable(multi.attrs) === stable([['x', '1'], ['y', 'zz']]), stable(multi.attrs))

  // 라벨 동반은 스키마에 흡수하지 않는다 — 원문 보존(stage-37 `::toc[라벨]` 전례).
  for (const [label, md] of [
    ['라벨만', ':::columns[제목]\n본문\n:::'],
    ['라벨 + n', ':::columns[제목]{n=2}\n본문\n:::'],
  ]) {
    const doc = markdownToBlocks(md)
    const counts = countTypes(doc.blocks)
    check(`[폴백] ${label} — sourceFallback 1건 · columns 0건`, counts.sourceFallback === 1 && counts.columns === 0, stable(counts))
    check(`[폴백] ${label} — 재출력이 원문 그대로`, blocksToMarkdown(doc) === md, `투영=${JSON.stringify(blocksToMarkdown(doc))}`)
  }
}
mark('③ 값 보존 · 라벨 동반 폴백')

// ---------------------------------------------------------------- ④ 어댑터 왕복

const ADAPTER = [
  ['2단 문단 2개', [{ id: 'b1', type: 'columns', count: 2, children: [
    { id: 'b2', type: 'paragraph', content: [{ type: 'text', text: '가' }] },
    { id: 'b3', type: 'paragraph', content: [{ type: 'text', text: '나' }] },
  ] }]],
  ['3단 + 목록', [{ id: 'b1', type: 'columns', count: 3, children: [
    { id: 'b2', type: 'listItem', ordered: false, content: [{ type: 'text', text: '항목' }] },
  ] }]],
  ['빈 자식', [{ id: 'b1', type: 'columns', count: 2, children: [] }]],
  ['범위 밖 count=4', [{ id: 'b1', type: 'columns', count: 4, children: [
    { id: 'b2', type: 'paragraph', content: [{ type: 'text', text: '본문' }] },
  ] }]],
  ['attrs 보존', [{ id: 'b1', type: 'columns', count: 2, attrs: [['x', '1'], ['y', 'zz']], children: [
    { id: 'b2', type: 'paragraph', content: [{ type: 'text', text: '본문' }] },
  ] }]],
  ['비정수 원문(attrs n)', [{ id: 'b1', type: 'columns', count: 2, attrs: [['n', 'abc']], children: [
    { id: 'b2', type: 'paragraph', content: [{ type: 'text', text: '본문' }] },
  ] }]],
  ['provenance 동거', [{ id: 'b1', type: 'columns', count: 3, meta: { provenance: { kind: 'llm' } }, children: [
    { id: 'b2', type: 'paragraph', content: [{ type: 'text', text: '본문' }] },
  ] }]],
  ['attrs + provenance 동거', [{ id: 'b1', type: 'columns', count: 2, attrs: [['x', '1']], meta: { provenance: { kind: 'llm' } }, children: [
    { id: 'b2', type: 'paragraph', content: [{ type: 'text', text: '본문' }] },
  ] }]],
  ['자식에 콜아웃', [{ id: 'b1', type: 'columns', count: 2, children: [
    { id: 'b2', type: 'callout', variant: 'note', title: '안내', children: [
      { id: 'b3', type: 'paragraph', content: [{ type: 'text', text: '속' }] },
    ] },
  ] }]],
  ['자식에 표·코드·이미지', [{ id: 'b1', type: 'columns', count: 3, children: [
    { id: 'b2', type: 'table', align: [null, null], rows: [[[{ type: 'text', text: '머리' }], [{ type: 'text', text: '값' }]]] },
    { id: 'b3', type: 'codeBlock', code: 'const a = 1', language: 'js' },
    { id: 'b4', type: 'image', url: '/sources/images/a.png', alt: '그림' },
  ] }]],
  ['콜아웃 안 columns', [{ id: 'b1', type: 'callout', variant: 'note', title: '안내', children: [
    { id: 'b2', type: 'columns', count: 2, children: [
      { id: 'b3', type: 'paragraph', content: [{ type: 'text', text: '속' }] },
    ] },
  ] }]],
  ['columns 안 columns', [{ id: 'b1', type: 'columns', count: 2, children: [
    { id: 'b2', type: 'columns', count: 3, children: [
      { id: 'b3', type: 'paragraph', content: [{ type: 'text', text: '속' }] },
    ] },
  ] }]],
  ['앞뒤 형제 동반', [
    { id: 'b0', type: 'paragraph', content: [{ type: 'text', text: '앞' }] },
    { id: 'b1', type: 'columns', count: 2, children: [{ id: 'b2', type: 'paragraph', content: [{ type: 'text', text: '단' }] }] },
    { id: 'b9', type: 'paragraph', content: [{ type: 'text', text: '뒤' }] },
  ]],
]

for (const [label, blocks] of ADAPTER) {
  const doc = { version: 1, blocks }
  const fwd = toBlockNoteBlocks(doc)
  const back = fromBlockNoteBlocks(fwd.blocks, fwd.sidecar)
  // **사이드카 불요** — 사이드카를 통째로 버려도 결과가 같아야 한다(meta는 자기 prop이 싣는다).
  const bare = fromBlockNoteBlocks(fwd.blocks)
  check(`[어댑터] ${label} — 미지원 보고 0`, fwd.unsupported.length === 0, JSON.stringify(fwd.unsupported))
  check(`[어댑터] ${label} — 블록 왕복 동형(id 포함)`, stable(back.blocks) === stable(blocks), `복원=${stable(back.blocks).slice(0, 400)}`)
  check(`[어댑터] ${label} — 사이드카 없이도 동일(사이드카 불요)`, stable(bare.blocks) === stable(back.blocks))
  const columnsIds = []
  walkBlocks(blocks, (block) => {
    if (block.type === 'columns') columnsIds.push(block.id)
  })
  check(
    `[어댑터] ${label} — columns의 사이드카 항목 0`,
    columnsIds.every((id) => fwd.sidecar[id] === undefined),
    `사이드카=${JSON.stringify(fwd.sidecar)}`,
  )
}

// prop 도메인 고정 + 컨테이너 예외(자식이 형제로 새지 않는가).
{
  const fwd = toBlockNoteBlocks({
    version: 1,
    blocks: [{ id: 'b1', type: 'columns', count: 3, attrs: [['x', '1']], meta: { provenance: { kind: 'llm' } }, children: [
      { id: 'b2', type: 'paragraph', content: [{ type: 'text', text: '본문' }] },
    ] }],
  })
  const bn = fwd.blocks[0]
  check('[어댑터] BN columns prop = count,meta', stable(Object.keys(bn.props).sort()) === stable(['count', 'meta']), `키=${Object.keys(bn.props)}`)
  check('[어댑터] BN count는 number', typeof bn.props.count === 'number' && bn.props.count === 3, `count=${JSON.stringify(bn.props.count)}`)
  check('[어댑터] BN meta = 통짜 JSON 문자열(attrs+meta)', typeof bn.props.meta === 'string' && stable(JSON.parse(bn.props.meta)) === stable({ attrs: [['x', '1']], meta: { provenance: { kind: 'llm' } } }), `meta=${bn.props.meta}`)
  check('[어댑터] BN children = 자식 블록(내용)', (bn.children ?? []).length === 1 && bn.children[0].type === 'paragraph', stable(bn.children))

  const plain = toBlockNoteBlocks({ version: 1, blocks: [{ id: 'b1', type: 'columns', count: 2, children: [] }] }).blocks[0]
  check('[어댑터] attrs·meta 없음 = 빈 문자열', plain.props.meta === '', `meta=${JSON.stringify(plain.props.meta)}`)
  const restored = fromBlockNoteBlocks([{ id: 'b1', type: 'columns', props: { count: 2, meta: '' }, children: [] }])
  check('[어댑터] 빈 문자열 = 키 부재로 복원', stable(restored.blocks) === stable([{ id: 'b1', type: 'columns', count: 2, children: [] }]), stable(restored.blocks))
  // 깨진 meta prop은 저장 경로를 막지 않는다(관대한 복원 관례).
  const broken = fromBlockNoteBlocks([{ id: 'b1', type: 'columns', props: { count: 2, meta: '{깨짐' }, children: [] }])
  check('[어댑터] 깨진 meta prop 무시(저장 경로 유지)', broken.blocks[0]?.type === 'columns' && broken.blocks[0].attrs === undefined && broken.blocks[0].meta === undefined, stable(broken.blocks))
  // count prop이 문자열/결손으로 흘러와도 저장이 막히지 않는다(기본 2).
  const loose = fromBlockNoteBlocks([
    { id: 'b1', type: 'columns', props: { count: '3', meta: '' }, children: [] },
    { id: 'b2', type: 'columns', props: { meta: '' }, children: [] },
  ])
  check('[어댑터] count 문자열 수용 / 결손 = 기본 2', loose.blocks[0].count === 3 && loose.blocks[1].count === 2, stable(loose.blocks))
  // **컨테이너 예외** — 자식을 형제로 펴면 단 내용이 통째로 밖으로 샌다.
  const nested = fromBlockNoteBlocks([{ id: 'b1', type: 'columns', props: { count: 2, meta: '' }, children: [
    { id: 'b2', type: 'paragraph', content: [{ type: 'text', text: '가', styles: {} }] },
  ] }])
  check('[어댑터] 컨테이너 예외 — 자식이 형제로 새지 않는다', nested.blocks.length === 1 && nested.blocks[0].children.length === 1, stable(nested.blocks))
}

// md → 블록 → BN → 블록 → md 통합 왕복(화면 저장 경로와 같은 순서).
for (const [label, md] of CANON) {
  const doc = markdownToBlocks(md)
  const fwd = toBlockNoteBlocks(doc)
  const back = fromBlockNoteBlocks(fwd.blocks, fwd.sidecar)
  check(`[어댑터·통합] ${label} — md→블록→BN→블록→md 동일`, blocksToMarkdown(back) === md, `투영=${JSON.stringify(blocksToMarkdown(back))}`)
}

// ④-e 실제 `noteSchema` 적재 왕복(s33 ⑤·s37 ④-e 관례). **스펙 등록은 묶음 B의 몫**이므로
// 미등록 상태에서는 실패가 아니라 pending으로 보고한다(오케스트레이터가 등록 후 재실행).
let schemaState = 'pending(스펙 미등록)'
try {
  const { noteSchema, asEditorBlocks, asAdapterBlocks } = jiti(path.join(SRC, 'editor2/blocknote/schema.ts'))
  if (!Object.keys(noteSchema.blockSchema).includes('columns')) {
    notes.push('④-e noteSchema에 columns 스펙 미등록 — 적재 왕복은 pending(묶음 B 완료 후 재실행).')
  } else {
    const { ServerBlockNoteEditor } = await import('@blocknote/server-util')
    const server = ServerBlockNoteEditor.create({ schema: noteSchema })
    const throughSchema = (blocks) =>
      asAdapterBlocks(server._prosemirrorNodeToBlocks(server._blocksToProsemirrorNode(asEditorBlocks(blocks))))
    let ok = 0
    for (const [label, blocks] of ADAPTER) {
      const fwd = toBlockNoteBlocks({ version: 1, blocks })
      let back
      try {
        back = fromBlockNoteBlocks(throughSchema(fwd.blocks), fwd.sidecar)
      } catch (error) {
        check(`[스키마적재] ${label}`, false, `적재 실패: ${error?.message ?? error}`)
        continue
      }
      const same = stable(back.blocks) === stable(blocks)
      if (same) ok += 1
      check(`[스키마적재] ${label} — noteSchema 적재 후 동형`, same, `복원=${stable(back.blocks).slice(0, 400)}`)
    }
    const props = Object.keys(noteSchema.blockSchema.columns.propSchema).sort().join(',')
    check('[스키마적재] columns propSchema = count,meta', props === 'count,meta', `실제=${props}`)
    schemaState = `등재 확인 · 적재 왕복 ${ok}/${ADAPTER.length}`
  }
} catch (error) {
  notes.push(`④-e noteSchema 적재 단계 건너뜀(pending) — ${error?.message ?? error}`)
}
console.log(`  실제 스키마 적재: ${schemaState}`)
mark('④ 어댑터 왕복(count·meta prop·사이드카 불요·컨테이너 예외)')

// ---------------------------------------------------------------- ⑤ 실문서 코퍼스(읽기 전용)

const CANDIDATES = [process.argv[2], path.resolve(FRONT, '../study.db')].filter(Boolean)
const DB_PATH = CANDIDATES.find((p) => fs.existsSync(p))

let surfaces = []
if (DB_PATH) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 's41-'))
  const tmpDb = path.join(tmpDir, 'study.db')
  try {
    for (const suffix of ['', '-wal', '-shm']) {
      if (fs.existsSync(`${DB_PATH}${suffix}`)) fs.copyFileSync(`${DB_PATH}${suffix}`, `${tmpDb}${suffix}`)
    }
    const db = new DatabaseSync(tmpDb, { readOnly: true })
    const rows = db.prepare('SELECT doc_no, content, explanation FROM documents').all()
    db.close()
    for (const row of rows) {
      for (const kind of ['content', 'explanation']) {
        const md = row[kind]
        if (typeof md === 'string' && md.trim() !== '') surfaces.push({ label: `${row.doc_no}#${kind}`, md })
      }
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

let columnsDirectiveCount = 0
if (surfaces.length === 0) {
  console.log(`study.db를 찾지 못해 ⑤(실문서)를 건너뜁니다. (후보: ${CANDIDATES.join(' · ')})`)
} else {
  let columnsSurfaces = 0
  let columnsBlocks = 0
  let fixedPoint = 0
  const nameTally = new Map()
  for (const surface of surfaces) {
    const counts = directiveNameCounts(surface.md)
    for (const [name, n] of counts) nameTally.set(name, (nameTally.get(name) ?? 0) + n)
    const cols = counts.get('columns') ?? 0
    if (cols > 0) {
      columnsSurfaces += 1
      columnsDirectiveCount += cols
    }
    const doc = markdownToBlocks(surface.md)
    columnsBlocks += countTypes(doc.blocks).columns
    const md1 = blocksToMarkdown(doc)
    if (md1 === blocksToMarkdown(markdownToBlocks(md1))) fixedPoint += 1
  }
  check('[실문서] directive 이름 `columns` 기존 표본 0', columnsDirectiveCount === 0, `발견=${columnsDirectiveCount}건 / ${columnsSurfaces}표면`)
  check('[실문서] columns 블록 산출 0 (= 기존 문서 변환 diff 0)', columnsBlocks === 0, `산출=${columnsBlocks}`)
  check('[실문서] 프로젝션 고정점 전건', fixedPoint === surfaces.length, `${fixedPoint}/${surfaces.length}`)
  const tally = [...nameTally.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n}=${c}`).join(' · ')
  console.log(`  실문서 표면 ${surfaces.length}건 · container directive 이름 분포: ${tally || '(없음)'}`)
  console.log(`  **directive 이름 \`columns\` 기존 표본 수: ${columnsDirectiveCount}건**`)
}

// 리더 계약 — remarkStudy가 `data-directive-n`을 **columns에만** 붙이는가(기존 문서 렌더 diff 0).
{
  const hasNAttr = (md) => {
    const root = parseToMdast(md)
    let found = false
    const walk = (node) => {
      const props = node.data?.hProperties
      if (props && 'data-directive-n' in props) found = true
      for (const child of node.children ?? []) walk(child)
    }
    if (root) walk(root)
    return found
  }
  check('[리더] columns에는 data-directive-n이 붙는다', hasNAttr(':::columns{n=3}\n본문\n:::'))
  check('[리더] 콜아웃에는 붙지 않는다', !hasNAttr(':::note[안내]\n본문\n:::'))
  check('[리더] fold/hide에는 붙지 않는다', !hasNAttr(':::fold[제목]\n본문\n:::\n\n:::hide\n본문\n:::'))
  check('[리더] 평범한 문서에는 붙지 않는다', !hasNAttr('# 제목\n\n본문 문단.\n\n- 목록'))
}
mark('⑤ 실문서 코퍼스 · 리더 속성 계약')

// ---------------------------------------------------------------- 결과

console.log('')
for (const section of sections) console.log(`계열 ${section.label}: ${section.count}건`)
for (const note of notes) console.log(`참고: ${note}`)
console.log(`총 ${pass + fail}건 · 통과 ${pass} · 실패 ${fail}`)
if (fail) {
  console.log('실패 목록:')
  for (const line of failures) console.log(`  - ${line}`)
  process.exit(1)
}
