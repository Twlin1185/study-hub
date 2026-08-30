// S41(stage-41) **고정 열 다단** 검증 2차 — H-1(스키마·정규화) · H-2(변환기·어댑터) · H-5(왕복 코퍼스).
//
// 실행: node frontend/scripts/s41-columns-roundtrip.mjs [db경로]
//   (프론트 유틸이라 pytest 대상이 아니다 — 불변 규칙 7의 "실행 스모크". TS 모듈은 s30 이후
//    관례 그대로 jiti로 불러온다 — 신규 설치 0. DB는 **읽기 전용 임시 복사본**으로만 만진다.)
//
// 1차(흐름형 `:::columns{n=2}` + 평문 자식)는 2차(고정 열 `::::columns{n=2}` > `:::column`)가
// 대체했다 — 1차 표기는 **레거시 수용**(계열 ②)으로만 남는다.
//
// 검사 5계열(stage-41 2차 규약 A·C):
//   ① 정규형        : `::::columns{n=…}` + `:::column` 표본이 md→블록→md에서 **바이트 동일**
//                     (정규형 = 직렬화 고정점)이고 블록 왕복이 동형인가. 정규 구조(columns의
//                     자식은 전부 column · 각 column은 자식 ≥ 1 · count = 단 수)가 실제로 서는가.
//                     펜스 길이 산정이 콜아웃과 **같은 단일 출처**라 단 안 콜아웃 = column 4 ·
//                     columns 5로 함께 자라는가.
//   ② 정규화 수용   : 비정규 **입력**(1차 레거시 평문 자식 · `n` 결손·표기 흔들림 · `n`과 단 수
//                     불일치 · column과 평문 혼재)을 파싱이 받아 **정규화**(불변식 ①~③)가
//                     정규형으로 수렴시키되 내용은 손실 0인가.
//   ③ 값 보존·폴백  : `n=4`(4단 그대로) · 비정수 `n=abc` · 미지 속성이 **손실 0**으로 왕복하는가 +
//                     라벨/속성 동반(`:::columns[제목]`·`:::column{x=1}`)은 스키마에 흡수되지 않고
//                     **원문 보존**(sourceFallback)으로 가는가 + `columns` 밖 단독 `:::column`은
//                     자식을 제자리에 **승격**하는가(불변식 ④).
//   ④ 어댑터        : 블록 ↔ BlockNote JSON 왕복 — `columns`(count·meta prop)·`column`(prop 0)
//                     **완전 왕복**과 **사이드카 불요**, 컨테이너 자식이 형제로 새지 않는가
//                     (fromBlockNote 평탄화 예외), 되읽기 정규화가 비정규 유입을 되돌리는가 +
//                     실제 `noteSchema` 적재 왕복.
//                     ※ 편집 표면 스펙 등록은 **묶음 B**의 몫이다 — 미등록이면 적재 단계만
//                       `pending(스펙 미등록)`으로 보고하고 실패로 치지 않는다.
//   ⑤ 실문서 코퍼스 : study.db 전건에서 **directive 이름 `columns`·`column` 표본 수**(예상 0)를
//                     실측하고, 산출 블록에 columns/column 0건 + 프로젝션 고정점(= 기존 문서
//                     변환 diff 0) + 리더가 읽는 hProperties 계약(`data-directive-n` ·
//                     `data-directive-normative`)이 기존 문서에는 붙지 않는가.
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
const { toBlockNoteBlocks, fromBlockNoteBlocks, BN_BLOCK_TYPES } = jiti(path.join(SRC, 'editor2/adapter/index.ts'))
const { normalizeColumnsBlock, unwrapStrayColumns, normalizeColumnsTree } = jiti(
  path.join(SRC, 'editor2/schema/columnsNormalize.ts'),
)

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
  const out = { columns: 0, column: 0, callout: 0, sourceFallback: 0 }
  walkBlocks(blocks, (block) => {
    if (block.type in out) out[block.type] += 1
  })
  return out
}

/** 정규 구조 위반 집계(불변식 ①~④) — 트리의 모든 columns/column을 훑는다. */
function structureReport(blocks) {
  const out = { strayColumn: 0, nonColumnChild: 0, emptyColumn: 0, countMismatch: 0, columns: 0, column: 0 }
  const walk = (list, parentIsColumns) => {
    for (const block of list ?? []) {
      if (block.type === 'column') {
        out.column += 1
        if (!parentIsColumns) out.strayColumn += 1
        if ((block.children ?? []).length === 0) out.emptyColumn += 1
      }
      if (block.type === 'columns') {
        out.columns += 1
        const kids = block.children ?? []
        for (const kid of kids) if (kid.type !== 'column') out.nonColumnChild += 1
        if (kids.length !== block.count) out.countMismatch += 1
      }
      walk(block.children, block.type === 'columns')
    }
  }
  walk(blocks, false)
  return out
}

/** 정규 상태인가(계열 ①~④의 공통 사후 조건). */
function isNormalized(blocks) {
  const r = structureReport(blocks)
  return r.strayColumn === 0 && r.nonColumnChild === 0 && r.emptyColumn === 0 && r.countMismatch === 0
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

/** 내용 손실 감시 — 블록 트리의 텍스트를 문서 순서대로 뽑는다(정규화는 **옮기기만** 해야 한다). */
function textOf(blocks) {
  const out = []
  const inline = (nodes) => {
    for (const node of nodes ?? []) {
      if (typeof node.text === 'string') out.push(node.text)
      inline(node.children)
    }
  }
  walkBlocks(blocks, (block) => {
    inline(block.content)
    if (block.type === 'codeBlock') out.push(block.code)
    if (block.type === 'mathBlock') out.push(block.value)
    if (block.type === 'sourceFallback') out.push(block.markdown)
    if (block.type === 'image') out.push(block.url)
    if (block.type === 'table') for (const row of block.rows ?? []) for (const cell of row) inline(cell)
  })
  return out.filter((t) => t !== '').join('')
}

const eq = (a, b) => stable(stripIds(a)) === stable(stripIds(b))

// ---------------------------------------------------------------- ① 정규형 왕복·고정점·구조

const CANON = [
  ['2단 문단', '::::columns{n=2}\n:::column\n1단 문단.\n:::\n:::column\n2단 문단.\n:::\n::::'],
  ['3단 문단', '::::columns{n=3}\n:::column\n하나.\n:::\n:::column\n둘.\n:::\n:::column\n셋.\n:::\n::::'],
  [
    '단 안 여러 블록',
    '::::columns{n=2}\n:::column\n첫 문단.\n\n둘째 문단.\n:::\n:::column\n## 절 제목\n\n> 인용문\n:::\n::::',
  ],
  [
    '목록 · 표',
    '::::columns{n=2}\n:::column\n- 가\n- 나\n:::\n:::column\n| 머리 | 값 |\n| --- | --- |\n| 가 | 1 |\n:::\n::::',
  ],
  [
    '코드 · 이미지',
    '::::columns{n=2}\n:::column\n```js\nconst a = 1\n```\n:::\n:::column\n![그림](/sources/images/a.png)\n:::\n::::',
  ],
  ['수식 · 헤딩', '::::columns{n=3}\n:::column\n$$\nx^2\n$$\n:::\n:::column\n### 소제목\n:::\n:::column\n본문.\n:::\n::::'],
  [
    '단 안 콜아웃(column 4 · columns 5)',
    ':::::columns{n=2}\n::::column\n:::note[안내]\n콜아웃 본문\n:::\n::::\n:::column\n둘째 단.\n:::\n:::::',
  ],
  ['빈 단 1개', '::::columns{n=2}\n:::column\n내용.\n:::\n:::column\n:::\n::::'],
  ['전부 빈 단(3단)', '::::columns{n=3}\n:::column\n:::\n:::column\n:::\n:::column\n:::\n::::'],
  ['미지 속성 동반', '::::columns{n=2 x=1}\n:::column\n본문.\n:::\n:::column\n본문2.\n:::\n::::'],
  [
    '범위 밖 n=4(4단 보존)',
    '::::columns{n=4}\n:::column\n가\n:::\n:::column\n나\n:::\n:::column\n다\n:::\n:::column\n라\n:::\n::::',
  ],
  ['비정수 n=abc(원문 보존)', '::::columns{n=abc}\n:::column\n가\n:::\n:::column\n나\n:::\n::::'],
  [
    '콜아웃 안 columns(유입 보존)',
    ':::::note[안내]\n::::columns{n=2}\n:::column\n속 본문\n:::\n:::column\n속 본문2\n:::\n::::\n:::::',
  ],
  [
    'columns 안 columns(유입 보존)',
    '::::::columns{n=2}\n:::::column\n::::columns{n=2}\n:::column\n안쪽\n:::\n:::column\n안쪽2\n:::\n::::\n:::::\n:::column\n바깥 2단\n:::\n::::::',
  ],
  ['문서 혼합(앞뒤 문단)', '앞 문단.\n\n::::columns{n=2}\n:::column\n단 본문.\n:::\n:::column\n단 본문2.\n:::\n::::\n\n뒤 문단.'],
  [
    '연속 2개',
    '::::columns{n=2}\n:::column\n가.\n:::\n:::column\n나.\n:::\n::::\n\n::::columns{n=3}\n:::column\n다.\n:::\n:::column\n라.\n:::\n:::column\n마.\n:::\n::::',
  ],
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
  check(`[정규형] ${label} — 정규 구조(불변식 ①~④)`, isNormalized(doc.blocks), stable(structureReport(doc.blocks)))
  check(`[정규형] ${label} — 스키마 버전 1 유지`, doc.version === 1, `version=${doc.version}`)
}

// 구조를 못 박는다(왕복만 보면 "평탄화된 채 일관되게 틀린" 모델을 놓친다).
{
  const two = markdownToBlocks('::::columns{n=2}\n:::column\n가\n:::\n:::column\n나\n:::\n::::').blocks
  const root = two[0]
  check(
    '[정규형] columns > column > 문단 3층 구조',
    root?.type === 'columns' &&
      root.count === 2 &&
      root.children.length === 2 &&
      root.children.every(
        (c) => c.type === 'column' && c.children.length === 1 && c.children[0].type === 'paragraph',
      ),
    stable(stripIds(two)),
  )
  check(
    '[정규형] column 블록 키 = children,id,type (prop·attrs 없음)',
    stable(Object.keys(root.children[0]).sort()) === stable(['children', 'id', 'type']),
    `키=${Object.keys(root.children[0])}`,
  )
  check(
    '[정규형] columns 블록 키 = children,count,id,type (미지 속성 없으면 attrs 부재)',
    stable(Object.keys(root).sort()) === stable(['children', 'count', 'id', 'type']),
    `키=${Object.keys(root)}`,
  )
  // 빈 단은 **빈 문단 1개**로 채워진다(불변식 ③ — 편집 표면에서 클릭으로 들어갈 자리).
  const empty = markdownToBlocks('::::columns{n=2}\n:::column\n:::\n:::column\n:::\n::::').blocks[0]
  check(
    '[정규형] 빈 단 = 빈 문단 1개(불변식 ③)',
    empty.children.length === 2 &&
      empty.children.every(
        (c) => c.children.length === 1 && c.children[0].type === 'paragraph' && c.children[0].content.length === 0,
      ),
    stable(stripIds(empty)),
  )
  // 중첩은 정말로 중첩으로 살아 있는가(평탄화되면 위 왕복은 통과해도 모델이 틀린다).
  const inCallout = markdownToBlocks(
    ':::::note[안내]\n::::columns{n=2}\n:::column\n속\n:::\n:::column\n속2\n:::\n::::\n:::::',
  ).blocks
  check(
    '[정규형] 콜아웃 안 columns — 자식으로 중첩 보존',
    inCallout[0]?.type === 'callout' && inCallout[0].children?.[0]?.type === 'columns',
    stable(stripIds(inCallout)),
  )
  const nested = markdownToBlocks(
    '::::::columns{n=2}\n:::::column\n::::columns{n=2}\n:::column\n안쪽\n:::\n:::column\n안쪽2\n:::\n::::\n:::::\n:::column\n바깥 2단\n:::\n::::::',
  ).blocks
  check(
    '[정규형] columns 안 columns — column 안에 중첩 보존',
    nested[0]?.type === 'columns' && nested[0].children[0]?.children[0]?.type === 'columns',
    stable(stripIds(nested)),
  )
}
mark('① 정규형 왕복·고정점·구조')

// ---------------------------------------------------------------- ② 비정규 입력 정규화 수용

const NORMALIZED = [
  [
    '1차 레거시(평문 자식) → 1단 + 빈 단',
    ':::columns{n=2}\n레거시 평문\n:::',
    '::::columns{n=2}\n:::column\n레거시 평문\n:::\n:::column\n:::\n::::',
  ],
  [
    '1차 레거시 3단 · 여러 블록 → 전부 1단',
    ':::columns{n=3}\n앞 문단\n\n- 가\n- 나\n:::',
    '::::columns{n=3}\n:::column\n앞 문단\n\n- 가\n- 나\n:::\n:::column\n:::\n:::column\n:::\n::::',
  ],
  ['n 결손 → 기본 2단', ':::columns\n본문\n:::', '::::columns{n=2}\n:::column\n본문\n:::\n:::column\n:::\n::::'],
  ['빈 columns(자식 0) → 빈 단 2개', ':::columns{n=2}\n:::', '::::columns{n=2}\n:::column\n:::\n:::column\n:::\n::::'],
  [
    '정수 표기 흔들림(n=03)',
    ':::columns{n=03}\n본문\n:::',
    '::::columns{n=3}\n:::column\n본문\n:::\n:::column\n:::\n:::column\n:::\n::::',
  ],
  ['인용 속성(n="2")', ':::columns{n="2"}\n본문\n:::', '::::columns{n=2}\n:::column\n본문\n:::\n:::column\n:::\n::::'],
  [
    'n과 단 수 불일치 → 단 수가 이긴다(불변식 ②)',
    '::::columns{n=3}\n:::column\n가\n:::\n:::column\n나\n:::\n::::',
    '::::columns{n=2}\n:::column\n가\n:::\n:::column\n나\n:::\n::::',
  ],
  [
    'column 앞 평문 혼재 → 첫 단 앞으로(불변식 ①)',
    '::::columns{n=2}\n앞 평문\n:::column\n1단\n:::\n::::',
    '::::columns{n=1}\n:::column\n앞 평문\n\n1단\n:::\n::::',
  ],
  [
    'column 뒤 평문 혼재 → 직전 단 끝으로(불변식 ①)',
    '::::columns{n=2}\n:::column\n1단\n:::\n뒤 평문\n:::column\n2단\n:::\n::::',
    '::::columns{n=2}\n:::column\n1단\n\n뒤 평문\n:::\n:::column\n2단\n:::\n::::',
  ],
  [
    '여분 공백 · 속성 순서',
    ':::columns{x=1    n=2}\n본문\n:::',
    '::::columns{n=2 x=1}\n:::column\n본문\n:::\n:::column\n:::\n::::',
  ],
  [
    '펜스 과다(6) → 필요한 길이로 수렴',
    '::::::columns{n=2}\n:::::column\n가\n:::::\n:::::column\n나\n:::::\n::::::',
    '::::columns{n=2}\n:::column\n가\n:::\n:::column\n나\n:::\n::::',
  ],
]

for (const [label, md, expected] of NORMALIZED) {
  const doc = markdownToBlocks(md)
  const md1 = blocksToMarkdown(doc)
  const md2 = blocksToMarkdown(markdownToBlocks(md1))
  check(`[정규화] ${label} — 정규형 수렴`, md1 === expected, `투영=${JSON.stringify(md1)}`)
  check(`[정규화] ${label} — 고정점`, md1 === md2, `2차=${JSON.stringify(md2)}`)
  check(`[정규화] ${label} — 정규 구조(불변식 ①~④)`, isNormalized(doc.blocks), stable(structureReport(doc.blocks)))
  check(
    `[정규화] ${label} — 내용 손실 0(텍스트 순서 보존)`,
    textOf(doc.blocks) === textOf(markdownToBlocks(md1).blocks),
    `${textOf(doc.blocks)} → ${textOf(markdownToBlocks(md1).blocks)}`,
  )
}

// 정규화가 방언 이름을 바꾸지 않는가(독립 관측 — columns가 콜아웃으로 새면 여기서 잡힌다).
for (const [label, md] of NORMALIZED) {
  const md1 = blocksToMarkdown(markdownToBlocks(md))
  const namesOf = (s) => [...new Set(JSON.parse(dialectShape(s)).map((d) => d.name))].sort()
  check(`[정규화] ${label} — directive 이름 columns 유지`, namesOf(md1).includes('columns'), `${namesOf(md)} → ${namesOf(md1)}`)
}
mark('② 비정규 입력 정규화 수용')

// ---------------------------------------------------------------- ③ 값 보존 · 폴백 · 승격

{
  // 규약 A — `n`은 표기이고 정본은 단 수다. 범위 밖 단 수도 **자르지 않는다**(결정 ②).
  for (const [label, md, expectCount, expectAttrs] of [
    [
      '4단(n=4)',
      '::::columns{n=4}\n:::column\n가\n:::\n:::column\n나\n:::\n:::column\n다\n:::\n:::column\n라\n:::\n::::',
      4,
      undefined,
    ],
    ['1단(n=1)', '::::columns{n=1}\n:::column\n가\n:::\n::::', 1, undefined],
    ['비정수 n=abc + 2단', '::::columns{n=abc}\n:::column\n가\n:::\n:::column\n나\n:::\n::::', 2, [['n', 'abc']]],
    [
      '비정수 n=2.5 + 3단',
      '::::columns{n=2.5}\n:::column\n가\n:::\n:::column\n나\n:::\n:::column\n다\n:::\n::::',
      3,
      [['n', '2.5']],
    ],
    [
      '미지 속성 다중',
      '::::columns{n=2 x=1 y=zz}\n:::column\n가\n:::\n:::column\n나\n:::\n::::',
      2,
      [
        ['x', '1'],
        ['y', 'zz'],
      ],
    ],
  ]) {
    const block = markdownToBlocks(md).blocks[0]
    const md1 = blocksToMarkdown(markdownToBlocks(md))
    check(
      `[값보존] ${label} — count=${expectCount}`,
      block?.type === 'columns' && block.count === expectCount,
      `실제=${block?.count}`,
    )
    check(`[값보존] ${label} — attrs 보존(순서 포함)`, stable(block?.attrs) === stable(expectAttrs), `attrs=${stable(block?.attrs)}`)
    check(`[값보존] ${label} — 재직렬화 = 원문`, md1 === md, `투영=${JSON.stringify(md1)}`)
    check(`[값보존] ${label} — 고정점`, md1 === blocksToMarkdown(markdownToBlocks(md1)))
  }

  // 비정수 `n` + 단 없음: count 기본 2로 단을 만들고 원문 쌍은 그대로 살아난다.
  const abc = markdownToBlocks(':::columns{n=abc}\n본문\n:::')
  check(
    '[값보존] 비정수 n + 레거시 평문 → 2단 + 원문 n 보존',
    blocksToMarkdown(abc) === '::::columns{n=abc}\n:::column\n본문\n:::\n:::column\n:::\n::::',
    `투영=${JSON.stringify(blocksToMarkdown(abc))}`,
  )

  // 라벨/속성 동반은 스키마에 흡수하지 않는다 — 원문 보존(stage-37 `::toc[라벨]` 전례).
  for (const [label, md] of [
    ['columns 라벨만', ':::columns[제목]\n본문\n:::'],
    ['columns 라벨 + n', ':::columns[제목]{n=2}\n본문\n:::'],
    ['단독 column 라벨', ':::column[제목]\n본문\n:::'],
    ['단독 column 속성', ':::column{x=1}\n본문\n:::'],
  ]) {
    const doc = markdownToBlocks(md)
    const counts = countTypes(doc.blocks)
    check(
      `[폴백] ${label} — sourceFallback 1건 · columns/column 0건`,
      counts.sourceFallback === 1 && counts.columns === 0 && counts.column === 0,
      stable(counts),
    )
    check(`[폴백] ${label} — 재출력이 원문 그대로`, blocksToMarkdown(doc) === md, `투영=${JSON.stringify(blocksToMarkdown(doc))}`)
  }

  // 불변식 ④ — `columns` 밖 단독 `:::column`은 자식을 제자리에 승격한다(콜아웃으로 새지 않는다).
  for (const [label, md, expected] of [
    ['최상위 단독 column', ':::column\n승격 대상\n:::', '승격 대상'],
    ['최상위 단독 column(여러 블록)', ':::column\n앞\n\n- 가\n:::', '앞\n\n- 가'],
    ['콜아웃 안 단독 column', '::::note[안내]\n:::column\n속\n:::\n::::', ':::note[안내]\n속\n:::'],
    ['앞뒤 형제 동반', '앞.\n\n:::column\n속\n:::\n\n뒤.', '앞.\n\n속\n\n뒤.'],
    [
      'column 안 column(중첩 stray)',
      '::::::columns{n=1}\n:::::column\n::::column\n속\n::::\n:::::\n::::::',
      '::::columns{n=1}\n:::column\n속\n:::\n::::',
    ],
  ]) {
    const doc = markdownToBlocks(md)
    const md1 = blocksToMarkdown(doc)
    check(`[승격] ${label} — 자식 제자리 승격`, md1 === expected, `투영=${JSON.stringify(md1)}`)
    check(`[승격] ${label} — 정규 구조`, isNormalized(doc.blocks), stable(structureReport(doc.blocks)))
    check(`[승격] ${label} — 고정점`, md1 === blocksToMarkdown(markdownToBlocks(md1)))
  }

  // 라벨 동반 column이 **columns 안에** 있으면: 원문 보존 블록이 되고 정규화가 1단으로 모은다
  // (원문 문자열이 그대로 살아 있으므로 손실 0 — 표기만 정규형으로 수렴한다).
  {
    const md = '::::columns{n=2}\n:::column[제목]\n본문\n:::\n::::'
    const doc = markdownToBlocks(md)
    const md1 = blocksToMarkdown(doc)
    check(
      '[폴백] columns 안 라벨 동반 column — 원문 보존 1건',
      countTypes(doc.blocks).sourceFallback === 1,
      stable(countTypes(doc.blocks)),
    )
    check('[폴백] columns 안 라벨 동반 column — 원문 문자열 유지', md1.includes(':::column[제목]'), `투영=${JSON.stringify(md1)}`)
    check('[폴백] columns 안 라벨 동반 column — 고정점', md1 === blocksToMarkdown(markdownToBlocks(md1)), `투영=${JSON.stringify(md1)}`)
  }
}
mark('③ 값 보존 · 라벨/속성 폴백 · 승격')

// ---------------------------------------------------------------- ③-b 정규화 함수 직접 검사(순수 함수)

{
  const para = (id, text) => ({ id, type: 'paragraph', content: [{ type: 'text', text }] })
  const col = (id, kids) => ({ id, type: 'column', children: kids })

  // 정규 입력 = **같은 객체 참조**를 돌려준다(편집기 훅이 "변경 없음"을 값싸게 판정한다).
  const canonical = {
    id: 'c1',
    type: 'columns',
    count: 2,
    children: [col('k1', [para('p1', '가')]), col('k2', [para('p2', '나')])],
  }
  check('[정규화함수] 정규 입력 = 참조 동일(무변경)', normalizeColumnsBlock(canonical) === canonical)
  check('[정규화함수] 정규 트리 = 참조 동일', normalizeColumnsTree([canonical])[0] === canonical)
  check('[정규화함수] 정규 트리 unwrap = 배열 참조 동일', unwrapStrayColumns([canonical]).length === 1)

  // ① 비-column 자식 흡수(앞 = 첫 단 앞 · 뒤 = 직전 단 끝)
  const mixed = normalizeColumnsBlock({
    id: 'c2',
    type: 'columns',
    count: 2,
    children: [para('p0', '앞'), col('k1', [para('p1', '가')]), para('p2', '뒤'), col('k2', [para('p3', '나')])],
  })
  check(
    '[정규화함수] ① 앞 평문 = 첫 단 앞 · 뒤 평문 = 직전 단 끝',
    mixed.children.length === 2 &&
      mixed.children[0].children.map((b) => b.id).join(',') === 'p0,p1,p2' &&
      mixed.children[1].children.map((b) => b.id).join(',') === 'p3',
    stable(mixed),
  )
  check('[정규화함수] ② count = 단 수', mixed.count === 2, `count=${mixed.count}`)

  // ② column 0개 → count개 생성(내용은 1단) · ③ 빈 단은 빈 문단 1개
  const made = normalizeColumnsBlock({ id: 'c3', type: 'columns', count: 3, children: [para('p1', '본문')] })
  check(
    '[정규화함수] ② column 0개 → count개 생성(1단에 내용)',
    made.children.length === 3 &&
      made.children.every((c) => c.type === 'column') &&
      made.children[0].children[0].id === 'p1',
    stable(made),
  )
  check(
    '[정규화함수] ③ 빈 단 = 빈 문단 1개',
    made.children.slice(1).every((c) => c.children.length === 1 && c.children[0].type === 'paragraph'),
    stable(made),
  )
  check(
    '[정규화함수] 생성 id는 컨테이너 파생·중복 없음',
    new Set([...made.children.map((c) => c.id), ...made.children.flatMap((c) => c.children.map((b) => b.id))]).size === 6,
    stable(made.children.map((c) => c.id)),
  )
  const custom = normalizeColumnsBlock(
    { id: 'c4', type: 'columns', count: 2, children: [] },
    { makeId: (() => { let n = 0; return () => `x${(n += 1)}` })() },
  )
  check('[정규화함수] makeId 주입 = 호출부 관례 id', custom.children[0].id === 'x1', stable(custom.children.map((c) => c.id)))

  // 병적 입력: 값은 보존하되 생성 수는 상한(12)에서 멈춘다(문서 폭주 방지 · 내용은 1단에 산다).
  const huge = normalizeColumnsBlock({ id: 'c5', type: 'columns', count: 9999, children: [para('p1', '본문')] })
  check('[정규화함수] 병적 n → 생성 상한 12', huge.children.length === 12 && huge.count === 12, `단=${huge.children.length}`)
  const zero = normalizeColumnsBlock({ id: 'c6', type: 'columns', count: 0, children: [para('p1', '본문')] })
  check('[정규화함수] n=0 → 1단(내용 보존)', zero.children.length === 1 && zero.count === 1, stable(zero))
  // 수가 아니거나 없는 count = **기본 2**(스키마 기본·파서 `n` 결손 기본·편집기 계층과 정렬).
  const nan = normalizeColumnsBlock({ id: 'c6b', type: 'columns', count: Number.NaN, children: [para('p1', '본문')] })
  const missing = normalizeColumnsBlock({ id: 'c6c', type: 'columns', children: [para('p1', '본문')] })
  check(
    '[정규화함수] count 비수치/미지정 → 기본 2단',
    nan.children.length === 2 && nan.count === 2 && missing.children.length === 2 && missing.count === 2,
    `nan=${nan.children.length} · missing=${missing.children.length}`,
  )

  // ④ 트리 순회 — 부모가 columns가 아닌 column 해제
  const stray = normalizeColumnsTree([col('k9', [para('p1', '가'), para('p2', '나')])])
  check('[정규화함수] ④ 최상위 stray column 해제', stray.map((b) => b.id).join(',') === 'p1,p2', stable(stray))
  const strayInCallout = normalizeColumnsTree([
    { id: 'a1', type: 'callout', variant: 'note', title: '', children: [col('k9', [para('p1', '가')])] },
  ])
  check(
    '[정규화함수] ④ 콜아웃 안 stray column 해제',
    strayInCallout[0].children.map((b) => b.id).join(',') === 'p1',
    stable(strayInCallout),
  )
  check(
    '[정규화함수] unwrapStrayColumns는 정규화하지 않는다(해제만)',
    stable(unwrapStrayColumns([{ id: 'c7', type: 'columns', count: 2, children: [] }])) ===
      stable([{ id: 'c7', type: 'columns', count: 2, children: [] }]),
  )
  check('[정규화함수] attrs·meta 보존', (() => {
    const out = normalizeColumnsBlock({
      id: 'c8',
      type: 'columns',
      count: 2,
      attrs: [['n', 'abc']],
      meta: { provenance: { kind: 'llm' } },
      children: [para('p1', '본문')],
    })
    return stable(out.attrs) === stable([['n', 'abc']]) && stable(out.meta) === stable({ provenance: { kind: 'llm' } })
  })())
}
mark('③-b 정규화 함수 단위 검사')

// ---------------------------------------------------------------- ④ 어댑터 왕복

const P = (id, text) => ({ id, type: 'paragraph', content: [{ type: 'text', text }] })
const COL = (id, kids) => ({ id, type: 'column', children: kids })

const ADAPTER = [
  ['2단 문단', [{ id: 'b1', type: 'columns', count: 2, children: [COL('c1', [P('p1', '가')]), COL('c2', [P('p2', '나')])] }]],
  [
    '3단 + 목록',
    [
      {
        id: 'b1',
        type: 'columns',
        count: 3,
        children: [
          COL('c1', [{ id: 'p1', type: 'listItem', ordered: false, content: [{ type: 'text', text: '항목' }] }]),
          COL('c2', [P('p2', '나')]),
          COL('c3', [P('p3', '다')]),
        ],
      },
    ],
  ],
  [
    '빈 단(빈 문단 1개)',
    [{ id: 'b1', type: 'columns', count: 2, children: [COL('c1', [P('p1', '가')]), COL('c2', [{ id: 'p2', type: 'paragraph', content: [] }])] }],
  ],
  [
    '범위 밖 count=4',
    [
      {
        id: 'b1',
        type: 'columns',
        count: 4,
        children: [COL('c1', [P('p1', '가')]), COL('c2', [P('p2', '나')]), COL('c3', [P('p3', '다')]), COL('c4', [P('p4', '라')])],
      },
    ],
  ],
  [
    'attrs 보존',
    [
      {
        id: 'b1',
        type: 'columns',
        count: 2,
        attrs: [
          ['x', '1'],
          ['y', 'zz'],
        ],
        children: [COL('c1', [P('p1', '가')]), COL('c2', [P('p2', '나')])],
      },
    ],
  ],
  [
    '비정수 원문(attrs n)',
    [{ id: 'b1', type: 'columns', count: 2, attrs: [['n', 'abc']], children: [COL('c1', [P('p1', '가')]), COL('c2', [P('p2', '나')])] }],
  ],
  [
    'provenance 동거',
    [
      {
        id: 'b1',
        type: 'columns',
        count: 2,
        meta: { provenance: { kind: 'llm' } },
        children: [COL('c1', [P('p1', '가')]), COL('c2', [P('p2', '나')])],
      },
    ],
  ],
  [
    '단 안 콜아웃',
    [
      {
        id: 'b1',
        type: 'columns',
        count: 2,
        children: [
          COL('c1', [{ id: 'a1', type: 'callout', variant: 'note', title: '안내', children: [P('p1', '속')] }]),
          COL('c2', [P('p2', '나')]),
        ],
      },
    ],
  ],
  [
    '단 안 표·코드·이미지',
    [
      {
        id: 'b1',
        type: 'columns',
        count: 3,
        children: [
          COL('c1', [
            { id: 't1', type: 'table', align: [null, null], rows: [[[{ type: 'text', text: '머리' }], [{ type: 'text', text: '값' }]]] },
          ]),
          COL('c2', [{ id: 'k1', type: 'codeBlock', code: 'const a = 1', language: 'js' }]),
          COL('c3', [{ id: 'i1', type: 'image', url: '/sources/images/a.png', alt: '그림' }]),
        ],
      },
    ],
  ],
  [
    '콜아웃 안 columns',
    [
      {
        id: 'b1',
        type: 'callout',
        variant: 'note',
        title: '안내',
        children: [{ id: 'b2', type: 'columns', count: 2, children: [COL('c1', [P('p1', '가')]), COL('c2', [P('p2', '나')])] }],
      },
    ],
  ],
  [
    'columns 안 columns(단 안 중첩)',
    [
      {
        id: 'b1',
        type: 'columns',
        count: 2,
        children: [
          COL('c1', [{ id: 'b2', type: 'columns', count: 2, children: [COL('c3', [P('p1', '가')]), COL('c4', [P('p2', '나')])] }]),
          COL('c2', [P('p3', '다')]),
        ],
      },
    ],
  ],
  [
    '앞뒤 형제 동반',
    [
      P('b0', '앞'),
      { id: 'b1', type: 'columns', count: 2, children: [COL('c1', [P('p1', '가')]), COL('c2', [P('p2', '나')])] },
      P('b9', '뒤'),
    ],
  ],
]

for (const [label, blocks] of ADAPTER) {
  const doc = { version: 1, blocks }
  const fwd = toBlockNoteBlocks(doc)
  const back = fromBlockNoteBlocks(fwd.blocks, fwd.sidecar)
  // **사이드카 불요** — 사이드카를 통째로 버려도 결과가 같아야 한다(meta는 자기 prop이 싣는다).
  const bare = fromBlockNoteBlocks(fwd.blocks)
  check(`[어댑터] ${label} — 미지원 보고 0`, fwd.unsupported.length === 0, JSON.stringify(fwd.unsupported))
  check(
    `[어댑터] ${label} — 블록 왕복 동형(id 포함)`,
    stable(back.blocks) === stable(blocks),
    `복원=${stable(back.blocks).slice(0, 400)}`,
  )
  check(`[어댑터] ${label} — 사이드카 없이도 동일(사이드카 불요)`, stable(bare.blocks) === stable(back.blocks))
  check(`[어댑터] ${label} — 되읽기 결과가 정규 상태`, isNormalized(back.blocks), stable(structureReport(back.blocks)))
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

// prop 도메인 고정 + 컨테이너 예외 + 되읽기 정규화.
{
  const fwd = toBlockNoteBlocks({
    version: 1,
    blocks: [
      {
        id: 'b1',
        type: 'columns',
        count: 3,
        attrs: [['x', '1']],
        meta: { provenance: { kind: 'llm' } },
        children: [COL('c1', [P('p1', '가')]), COL('c2', [P('p2', '나')]), COL('c3', [P('p3', '다')])],
      },
    ],
  })
  const bn = fwd.blocks[0]
  check(
    '[어댑터] BN columns prop = count,meta',
    stable(Object.keys(bn.props).sort()) === stable(['count', 'meta']),
    `키=${Object.keys(bn.props)}`,
  )
  check('[어댑터] BN count는 number', typeof bn.props.count === 'number' && bn.props.count === 3, `count=${JSON.stringify(bn.props.count)}`)
  check(
    '[어댑터] BN meta = 통짜 JSON 문자열(attrs+meta)',
    typeof bn.props.meta === 'string' &&
      stable(JSON.parse(bn.props.meta)) === stable({ attrs: [['x', '1']], meta: { provenance: { kind: 'llm' } } }),
    `meta=${bn.props.meta}`,
  )
  check(
    '[어댑터] BN columns children = column 3개',
    (bn.children ?? []).length === 3 && bn.children.every((c) => c.type === 'column'),
    stable(bn.children.map((c) => c.type)),
  )
  check('[어댑터] BN column prop 0(빈 객체)', stable(bn.children[0].props) === stable({}), stable(bn.children[0].props))
  check(
    '[어댑터] BN column children = 단 내용',
    (bn.children[0].children ?? []).length === 1 && bn.children[0].children[0].type === 'paragraph',
    stable(bn.children[0].children),
  )
  check(
    '[어댑터] BN_BLOCK_TYPES에 column 등재',
    BN_BLOCK_TYPES.includes('column') && BN_BLOCK_TYPES.includes('columns'),
    BN_BLOCK_TYPES.join(','),
  )

  const plain = toBlockNoteBlocks({
    version: 1,
    blocks: [{ id: 'b1', type: 'columns', count: 2, children: [COL('c1', [P('p1', '가')]), COL('c2', [P('p2', '나')])] }],
  }).blocks[0]
  check('[어댑터] attrs·meta 없음 = 빈 문자열', plain.props.meta === '', `meta=${JSON.stringify(plain.props.meta)}`)

  // 깨진 meta prop·문자열 count는 저장 경로를 막지 않는다(관대한 복원 관례).
  const broken = fromBlockNoteBlocks([
    {
      id: 'b1',
      type: 'columns',
      props: { count: 2, meta: '{깨짐' },
      children: [
        { id: 'c1', type: 'column', props: {}, children: [{ id: 'p1', type: 'paragraph', content: [] }] },
        { id: 'c2', type: 'column', props: {}, children: [{ id: 'p2', type: 'paragraph', content: [] }] },
      ],
    },
  ])
  check(
    '[어댑터] 깨진 meta prop 무시(저장 경로 유지)',
    broken.blocks[0]?.type === 'columns' && broken.blocks[0].attrs === undefined && broken.blocks[0].meta === undefined,
    stable(broken.blocks),
  )
  const loose = fromBlockNoteBlocks([
    {
      id: 'b1',
      type: 'columns',
      props: { count: '3', meta: '' },
      children: [
        { id: 'c1', type: 'column', props: {}, children: [{ id: 'p1', type: 'paragraph', content: [] }] },
        { id: 'c2', type: 'column', props: {}, children: [{ id: 'p2', type: 'paragraph', content: [] }] },
        { id: 'c3', type: 'column', props: {}, children: [{ id: 'p3', type: 'paragraph', content: [] }] },
      ],
    },
  ])
  check('[어댑터] count 문자열 수용(단 수와 일치)', loose.blocks[0].count === 3, stable(loose.blocks))

  // **컨테이너 예외** — 자식을 형제로 펴면 단 내용이 통째로 밖으로 샌다.
  const nested = fromBlockNoteBlocks([
    {
      id: 'b1',
      type: 'columns',
      props: { count: 1, meta: '' },
      children: [
        {
          id: 'c1',
          type: 'column',
          props: {},
          children: [{ id: 'p1', type: 'paragraph', content: [{ type: 'text', text: '가', styles: {} }] }],
        },
      ],
    },
  ])
  check(
    '[어댑터] 컨테이너 예외 — column·columns 자식이 형제로 새지 않는다',
    nested.blocks.length === 1 && nested.blocks[0].children.length === 1 && nested.blocks[0].children[0].children.length === 1,
    stable(nested.blocks),
  )

  // 되읽기 정규화(규약 A) — 편집 세션이 남긴 비정규 상태를 저장 전에 되돌린다.
  const denorm = fromBlockNoteBlocks([
    {
      id: 'b1',
      type: 'columns',
      props: { count: 2, meta: '' },
      children: [
        { id: 'p0', type: 'paragraph', content: [{ type: 'text', text: '단 밖으로 승격된 블록', styles: {} }] },
        { id: 'c1', type: 'column', props: {}, children: [] },
      ],
    },
  ])
  check('[어댑터] 되읽기 정규화 — 비정규 유입이 정규 상태로', isNormalized(denorm.blocks), stable(denorm.blocks))
  check(
    '[어댑터] 되읽기 정규화 — 내용 손실 0',
    textOf(denorm.blocks).includes('단 밖으로 승격된 블록'),
    stable(denorm.blocks),
  )
  const strayTop = fromBlockNoteBlocks([
    {
      id: 'c1',
      type: 'column',
      props: {},
      children: [{ id: 'p1', type: 'paragraph', content: [{ type: 'text', text: '최상위 단', styles: {} }] }],
    },
  ])
  check(
    '[어댑터] 되읽기 정규화 — columns 밖 단독 column 해제',
    strayTop.blocks.length === 1 && strayTop.blocks[0].type === 'paragraph',
    stable(strayTop.blocks),
  )
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
  const registered = Object.keys(noteSchema.blockSchema)
  if (!registered.includes('columns') || !registered.includes('column')) {
    notes.push('④-e noteSchema에 columns/column 스펙 미등록 — 적재 왕복은 pending(묶음 B 완료 후 재실행).')
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
    const colProps = Object.keys(noteSchema.blockSchema.column.propSchema).sort().join(',')
    check('[스키마적재] column propSchema = 없음(prop 0)', colProps === '', `실제=${colProps}`)
    schemaState = `등재 확인 · 적재 왕복 ${ok}/${ADAPTER.length}`
  }
} catch (error) {
  notes.push(`④-e noteSchema 적재 단계 건너뜀(pending) — ${error?.message ?? error}`)
}
console.log(`  실제 스키마 적재: ${schemaState}`)
mark('④ 어댑터 왕복(prop 도메인·사이드카 불요·컨테이너 예외·되읽기 정규화)')

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
let columnDirectiveCount = 0
if (surfaces.length === 0) {
  console.log(`study.db를 찾지 못해 ⑤(실문서)를 건너뜁니다. (후보: ${CANDIDATES.join(' · ')})`)
} else {
  let dialectSurfaces = 0
  let dialectBlocks = 0
  let fixedPoint = 0
  const nameTally = new Map()
  for (const surface of surfaces) {
    const counts = directiveNameCounts(surface.md)
    for (const [name, n] of counts) nameTally.set(name, (nameTally.get(name) ?? 0) + n)
    const cols = counts.get('columns') ?? 0
    const cell = counts.get('column') ?? 0
    if (cols + cell > 0) dialectSurfaces += 1
    columnsDirectiveCount += cols
    columnDirectiveCount += cell
    const doc = markdownToBlocks(surface.md)
    const t = countTypes(doc.blocks)
    dialectBlocks += t.columns + t.column
    const md1 = blocksToMarkdown(doc)
    if (md1 === blocksToMarkdown(markdownToBlocks(md1))) fixedPoint += 1
  }
  // 2026-08-30 후속: 기능 출시 후 실문서에 다단이 쓰이기 시작하면(같은 날 사용자 문서 1건) 표본 수는
  // 0이 아니게 된다 — "표본 0"은 출시 전 레거시 검사였으므로 **정보로만 출력**하고, 대신 발견된 표본이
  // 전부 2차 정규형(columns 자식 = column · count = 단 수)으로 파싱되고 고정점 왕복하는지를 검사한다.
  let nonNormative = 0
  for (const surface of surfaces) {
    if ((directiveNameCounts(surface.md).get('columns') ?? 0) === 0) continue
    walkBlocks(markdownToBlocks(surface.md).blocks, (b) => {
      if (b.type !== 'columns') return
      const ok = b.children.length > 0 && b.children.every((k) => k.type === 'column') && b.count === b.children.length
      if (!ok) nonNormative += 1
    })
  }
  check(
    '[실문서] 발견된 columns 표본 전건 2차 정규형(자식 = column · count = 단 수)',
    nonNormative === 0,
    `비정규 ${nonNormative} / directive columns=${columnsDirectiveCount} · column=${columnDirectiveCount} / ${dialectSurfaces}표면`,
  )
  check(
    '[실문서] directive 표본 수 = 산출 블록 수(폴백 0)',
    dialectBlocks === columnsDirectiveCount + columnDirectiveCount,
    `directive ${columnsDirectiveCount + columnDirectiveCount} · 블록 ${dialectBlocks}`,
  )
  check('[실문서] 프로젝션 고정점 전건', fixedPoint === surfaces.length, `${fixedPoint}/${surfaces.length}`)
  const tally = [...nameTally.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([n, c]) => `${n}=${c}`)
    .join(' · ')
  console.log(`  실문서 표면 ${surfaces.length}건 · container directive 이름 분포: ${tally || '(없음)'}`)
  console.log(
    `  **directive 이름 기존 표본 수: \`columns\` ${columnsDirectiveCount}건 · \`column\` ${columnDirectiveCount}건**`,
  )
}

// 리더 계약 — remarkStudy가 리더용 hProperties를 **다단 방언에만** 붙이는가(기존 문서 렌더 diff 0).
{
  const propsIn = (md, key) => {
    const root = parseToMdast(md)
    const found = []
    const walk = (node) => {
      const props = node.data?.hProperties
      if (props && key in props) found.push(String(props[key]))
      for (const child of node.children ?? []) walk(child)
    }
    if (root) walk(root)
    return found
  }
  check('[리더] columns에는 data-directive-n이 붙는다', stable(propsIn(':::columns{n=3}\n본문\n:::', 'data-directive-n')) === stable(['3']))
  check('[리더] 콜아웃에는 data-directive-n이 붙지 않는다', propsIn(':::note[안내]\n본문\n:::', 'data-directive-n').length === 0)
  check(
    '[리더] fold/hide에는 붙지 않는다',
    propsIn(':::fold[제목]\n본문\n:::\n\n:::hide\n본문\n:::', 'data-directive-n').length === 0,
  )
  check('[리더] 평범한 문서에는 붙지 않는다', propsIn('# 제목\n\n본문 문단.\n\n- 목록', 'data-directive-n').length === 0)
  // 단(column)은 **정규 표기 여부**만 넘긴다 — 변환기의 흡수/폴백 판정과 같은 결론이어야 한다.
  check(
    '[리더] 정규 column = normative true',
    stable(propsIn('::::columns{n=2}\n:::column\n가\n:::\n:::column\n나\n:::\n::::', 'data-directive-normative')) ===
      stable(['true', 'true']),
    stable(propsIn('::::columns{n=2}\n:::column\n가\n:::\n:::column\n나\n:::\n::::', 'data-directive-normative')),
  )
  check(
    '[리더] 라벨 동반 column = normative false',
    stable(propsIn(':::column[제목]\n본문\n:::', 'data-directive-normative')) === stable(['false']),
  )
  check(
    '[리더] 속성 동반 column = normative false',
    stable(propsIn(':::column{x=1}\n본문\n:::', 'data-directive-normative')) === stable(['false']),
  )
  check(
    '[리더] 기존 문서(콜아웃·fold·평문)에는 normative가 붙지 않는다',
    propsIn(':::note[안내]\n본문\n:::\n\n:::fold[제목]\n본문\n:::\n\n# 제목\n\n본문', 'data-directive-normative').length === 0,
  )
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
