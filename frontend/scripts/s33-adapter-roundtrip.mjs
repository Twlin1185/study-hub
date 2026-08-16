// S33(M33) 어댑터 왕복 검증 — stage-33 F-5.
//
// 실행: node frontend/scripts/s33-adapter-roundtrip.mjs
//   (s30·s32 관례 계승 — TS 모듈은 jiti로 불러온다. 신규 설치 0. 어댑터는 규약 B에 따라
//    **에디터 인스턴스 없이** 동작하는 순수 JSON 변환이라 DOM 없이 이 검증이 성립한다.)
//
// 검사 5계열:
//   ① 코어 왕복   : M32 공용 코퍼스(roundtrip-corpus.mjs)의 **코어 범위 표본**을
//                   md → 앱 블록 → BN 블록 → 앱 블록으로 돌려 **id 제외 동등**.
//   ② 정규형 동등 : 그 블록을 `blocksToMarkdown`으로 다시 투영해 M32 정규형(N)이 원본 md와 동등.
//                   (N은 `s32-normalize.mjs`가 단일 출처 — 변환기와 독립 구현)
//   ③ 손실 0      : 방언·표현 불가 표본을 넣었을 때 어댑터가 **조용히 버리지 않고**
//                   `unsupported`로 명시 보고하는가. 코어/방언 **분류 자체를 고정**한다
//                   (표본이 조용히 방언 쪽으로 흘러가면 이 검사가 알려 준다) + 사유 코드 고정.
//   ④ BN 출발 왕복: **실제 저장 경로**(편집기 문서 → 앱 블록 → 편집기 문서)의 안정성 +
//                   규약 D(말미 빈 문단 트림).
//   ⑤ 실제 스키마 적재: ①~④는 어댑터가 **스스로 선언한 구조 타입**(`adapter/types.ts`)끼리의
//                   왕복이라, `blocknote/schema.ts`의 경계 캐스트(`as unknown as`) 2곳이 실제
//                   스키마와 어긋나도 잡지 못한다. 그래서 **화면이 쓰는 바로 그 `noteSchema`**로
//                   ProseMirror 문서를 만들었다가 되읽어(`@blocknote/server-util` —
//                   **이미 devDependency**, 신규 설치 0) 어댑터 산출 JSON이 진짜 편집기 스키마에
//                   실리는지 검증한다. stage-34에서 커스텀 스펙을 얹다 캐스트가 깨지면 여기서 깨진다.
//                   (서버 유틸은 **스크립트 전용**이다 — `src/**` 어디에서도 import하지 않으므로
//                    런타임 번들에 들어가지 않는다.)
import Module, { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { ServerBlockNoteEditor } from '@blocknote/server-util'
import { SAMPLES, BLOCK_SAMPLES } from './roundtrip-corpus.mjs'
import { stable, stripIds, makeNormalize } from './s32-normalize.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FRONT = path.resolve(HERE, '..')
const SRC = path.join(FRONT, 'src')

// `@blocknote/math-block`(stage-34 G-7 채택)은 CJS 엔트리에서 `katex/dist/katex.min.css`를
// require한다 — 번들러(Vite)는 처리하지만 Node/jiti는 CSS를 JS로 파싱하려다 깨진다.
// **이 스크립트 전용** 스텁을 등록한다(런타임 번들에는 영향이 0이다).
Module._extensions['.css'] = (mod) => {
  mod.exports = {}
}

const require = createRequire(path.join(FRONT, 'package.json'))

// stage-34 커스텀 스펙은 `.tsx`다(React 렌더 컴포넌트). jiti 1.x는 `.ts/.mts/.cts`만 TypeScript로
// 보고 JSX 변환 플러그인도 갖고 있지 않아 `.tsx`를 파싱하지 못한다(실측). 그래서 `.tsx`만
// **이미 있는 devDependency인 typescript**로 직접 트랜스파일하고 나머지는 jiti 기본 변환에 맡긴다.
// (스크립트 전용 배선 — 런타임 번들·Vite 경로에는 영향이 0이다.)
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

const transform = jiti(path.join(SRC, 'editor2/transform/index.ts'))
const { markdownToBlocks, blocksToMarkdown, parseToMdast } = transform
const adapter = jiti(path.join(SRC, 'editor2/adapter/index.ts'))
const { toBlockNoteBlocks, fromBlockNoteBlocks, fromBlockNoteResult, collapseMicroMarks, MICRO_MARKS } = adapter
// 계열 ⑤ — 화면(NoteEditPage)이 쓰는 **그 스키마 모듈 그대로**를 불러온다(스펙 자체 선언 금지:
// 별도 구성이면 캐스트·스펙 회귀를 못 잡는다). 스타일 import는 화면 쪽으로 옮겨 두어 이 모듈이
// DOM·번들러 없이 로드된다(`blocknote/schema.ts` 머리말 주석 참조).
const schemaModule = jiti(path.join(SRC, 'editor2/blocknote/schema.ts'))
const { noteSchema, asEditorBlocks, asAdapterBlocks } = schemaModule

const normalize = makeNormalize(parseToMdast)

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

// 계열별 검사 수 집계(보고용) — 각 계열이 끝날 때 mark()를 부른다.
const sections = []
let marked = 0
function mark(label) {
  const total = pass + fail
  sections.push({ label, count: total - marked })
  marked = total
}

// ---------------------------------------------------------------- 분류 고정(계열 ③의 뼈대)
//
// **방언·표현 불가로 분류돼야 하는 표본 전수**. 여기 없는 표본은 전부 "코어"여야 하며,
// 코어 표본은 계열 ①·②를 통과해야 한다. 분류가 바뀌면(코어가 방언으로 흘러가거나 그 반대)
// 아래 두 검사가 동시에 깨진다 — 어댑터의 범위를 기계로 못박는 장치다.
//
// **stage-34에서 이 표가 대폭 축소됐다** — 방언 팔레트(형광펜·스포일러·`:t`·참조 칩·문단 안 이미지·
// 원문 보존·수식·콜아웃·문서 임베드·경성 줄바꿈)가 커스텀 스펙으로 이식돼 **코어로 편입**됐고,
// 규약 I 흡수 4종(`inline:hardBreak`·`link:title`·`image:title`/`height`·`block:meta`)도 보존 경로가
// 생겨 보고가 사라졌다. 남는 것은 **R34 판정 대기 3종뿐**이다(임의 흡수 금지 — 사용자 판정 대기):
//   · `listItem:spread` · `listItem:groupBreak` — 평평한 목록 모델에 자리가 없다(prop 추가 금지)
//   · `table:align` — 사이드카로 **왕복 보존은 하되** 보고는 유지한다(정렬 편집 UI = M35)
const EXPECTED_DIALECT = new Map()

// BLOCK_SAMPLES 쪽 — R34 판정 대기 3종만 남는다.
for (const [label, kind] of [
  ['목록 안 다중 블록', 'listItem:spread'],
  ['느슨한 목록', 'listItem:spread'],
  ['인접 목록 분리(마커 변경)', 'listItem:groupBreak'],
  ['인접 순서 목록 분리(구분자 변경)', 'listItem:groupBreak'],
  ['인접 목록 3연속 분리', 'listItem:groupBreak'],
  ['인접 목록 분리 + 시작 번호', 'listItem:groupBreak'],
  ['중첩 안 인접 목록 분리', 'listItem:groupBreak'],
  ['표 정렬', 'table:align'],
]) {
  EXPECTED_DIALECT.set(label, kind)
}

const CORPUS = [...SAMPLES, ...BLOCK_SAMPLES]

// ---------------------------------------------------------------- ①·②·③ 코퍼스 분류·왕복

console.log('== ①/② 코어 표본: md → 앱 블록 → BN 블록 → 앱 블록 (id 제외 동등) + 정규형 동등 ==')
let coreCount = 0
let dialectCount = 0
let coreBlockPass = 0
let corePassNorm = 0
const dialectKinds = new Map()

for (const [label, src] of CORPUS) {
  const doc1 = markdownToBlocks(src)
  // 사이드카(규약 I 흡수분)는 화면이 로드→저장 사이에 들고 있는 값이다 — 왕복 검증도 그대로 넘긴다.
  const { blocks: bn, unsupported, sidecar } = toBlockNoteBlocks(doc1)
  const expectedKind = EXPECTED_DIALECT.get(label)

  // ③ 분류 고정 — 기대와 실제(미지원 보고 유무)가 일치하는가.
  const isDialect = unsupported.length > 0
  check(
    `[분류] ${label}`,
    isDialect === (expectedKind !== undefined),
    isDialect
      ? `코어로 기대했는데 미지원 보고: ${unsupported.map((u) => u.kind).join(',')}`
      : `방언(${expectedKind})으로 기대했는데 미지원 보고가 0건 — 조용히 버려졌을 수 있다`,
  )

  if (isDialect) {
    dialectCount += 1
    for (const issue of unsupported) dialectKinds.set(issue.kind, (dialectKinds.get(issue.kind) ?? 0) + 1)
    // ③-b 사유 코드 고정 — 기대한 사유가 보고 목록에 들어 있는가(조용한 사유 변경 방지).
    check(
      `[사유] ${label}`,
      unsupported.some((issue) => issue.kind === expectedKind),
      `기대 사유=${expectedKind} 실제=${[...new Set(unsupported.map((u) => u.kind))].join(',')}`,
    )
    // ③-c 보고에는 위치와 사람이 읽는 설명이 함께 있어야 한다.
    check(
      `[보고형태] ${label}`,
      unsupported.every((issue) => typeof issue.path === 'string' && issue.path.length > 0),
      '미지원 보고에 위치(path)가 없다',
    )
    continue
  }

  coreCount += 1

  // ① 블록 동등(id 제외)
  const doc2 = fromBlockNoteBlocks(bn, sidecar)
  const want = stable(stripIds(doc1.blocks))
  const got = stable(stripIds(doc2.blocks))
  const okBlocks = want === got
  if (okBlocks) coreBlockPass += 1
  check(`[코어왕복] ${label}`, okBlocks, okBlocks ? '' : `원본=${want.slice(0, 400)} 왕복=${got.slice(0, 400)}`)

  // ② 정규형 동등(M32 N) — 왕복 블록의 Markdown 투영이 원본과 같은 정규형인가.
  const md2 = blocksToMarkdown(doc2)
  const a = stable(normalize(src))
  const b = stable(normalize(md2))
  const okNorm = a === b
  if (okNorm) corePassNorm += 1
  check(`[정규형] ${label}`, okNorm, okNorm ? '' : `원본N=${a.slice(0, 300)} 투영N=${b.slice(0, 300)} 투영=${JSON.stringify(md2)}`)

  // ②-b 고정점 — 왕복 결과를 한 번 더 돌려도 바이트 동일.
  const bn2 = toBlockNoteBlocks(doc2)
  const md3 = blocksToMarkdown(fromBlockNoteBlocks(bn2.blocks, bn2.sidecar))
  check(`[고정점] ${label}`, md2 === md3, `1차=${JSON.stringify(md2)} 2차=${JSON.stringify(md3)}`)
}
console.log(`  코어 표본 ${coreCount}종 · 방언/표현 불가 표본 ${dialectCount}종 (전체 ${CORPUS.length}종)`)
console.log(`  코어 블록 왕복: ${coreBlockPass}/${coreCount} · 정규형 동등: ${corePassNorm}/${coreCount}`)
console.log(`  미지원 사유 분포: ${[...dialectKinds].map(([k, v]) => `${k}=${v}`).join(' · ')}`)
mark('①·② 코퍼스 코어 왕복·정규형·고정점 + ③ 분류/사유 고정')

// ---------------------------------------------------------------- ③-d 사유별 최소 표본(손실 0 계약)

console.log('== ③ 손실 0: 방언 이식분은 무손실 왕복 · 남은 제약만 명시 보고되는가 ==')
const t = (text, styles) => (styles ? { type: 'text', text, styles } : { type: 'text', text })
const p = (content) => ({ id: 'x', type: 'paragraph', content })

// ③-d ① **방언 팔레트 + 규약 I 흡수 4종**: 미지원 보고가 **0건**이고 왕복이 무손실이어야 한다
// (stage-34 DoD 2 — "방언에는 더 이상 미지원이 없다"). 실제 스키마 적재(⑤ 경로)까지 통과시켜
// 커스텀 스펙 prop이 진짜로 살아남는지 함께 본다.
const DIALECT_ROUNDTRIP_CASES = [
  ['형광펜 스타일', p([t('형광', { highlight: true })])],
  ['스포일러 스타일', p([t('가림', { spoiler: true })])],
  [':t 스타일', p([t('색', { t: [['c', 'red']] })])],
  [':t 화이트리스트 밖·중복 키 보존', p([t('값', { t: [['c', 'rebeccapurple'], ['키', '값'], ['k', '1'], ['k', '2']] })])],
  ['마이크로 + CommonMark 중첩', p([t('굵은 형광', { bold: true, highlight: true })])],
  ['참조 칩(라벨 추종형)', p([{ type: 'refChip', ref: 'doc', target: 'DOC-0012' }])],
  ['참조 칩(지정 라벨)', p([{ type: 'refChip', ref: 'doc', target: 'DOC-0012', label: '다른 이름' }])],
  ['앵커 칩', p([{ type: 'refChip', ref: 'anchor', target: '절 제목' }])],
  ['문단 안 임베드 칩', p([{ type: 'refChip', ref: 'embed', target: 'DOC-0007' }])],
  ['서식 걸린 참조 칩', p([{ type: 'refChip', ref: 'doc', target: 'DOC-0003', styles: { bold: true, t: [['c', 'blue']] } }])],
  ['인라인 수식', p([{ type: 'inlineMath', value: 'a^2' }])],
  ['문단 안 이미지', p([{ type: 'inlineImage', url: '/images/x.png', alt: 'c' }])],
  ['문단 안 이미지(제목·크기)', p([{ type: 'inlineImage', url: '/images/x.png', alt: 'c', title: '제목', width: 250, height: 100 }])],
  ['원문 보존 인라인', p([{ type: 'inlineFallback', markdown: '<b>x</b>', nodeType: 'html' }])],
  ['경성 줄바꿈', p([t('첫'), { type: 'hardBreak' }, t('둘')])],
  ['링크 제목(사이드카)', p([{ type: 'link', url: 'https://example.com', title: '타이틀', children: [t('링크')] }])],
  ['수식 블록', { id: 'x', type: 'mathBlock', value: 'a^2' }],
  ['수식 블록(여러 줄)', { id: 'x', type: 'mathBlock', value: 'a &= b \\\\\nc &= d' }],
  ['콜아웃', { id: 'x', type: 'callout', variant: 'note', title: '', children: [p([t('내용')])] }],
  [
    '콜아웃(고정 목록 밖 variant·속성 보존)',
    {
      id: 'x',
      type: 'callout',
      variant: '노트',
      title: '제목 (괄호)',
      attrs: [['키', '값'], ['data-x', '공백 있는 값']],
      children: [p([t('내용')])],
    },
  ],
  ['문서 임베드 블록', { id: 'x', type: 'docEmbed', target: 'DOC-0007' }],
  ['문서 임베드 블록(별칭)', { id: 'x', type: 'docEmbed', target: 'DOC-0007', label: '다른 이름' }],
  ['원문 보존 블록', { id: 'x', type: 'sourceFallback', markdown: '<div class="x">\n원시 HTML\n</div>', nodeType: 'html' }],
  ['이미지 제목·높이(prop 확장)', { id: 'x', type: 'image', url: '/images/x.png', alt: '캡션', title: '제목', width: 400, height: 300 }],
  ['블록 메타(사이드카)', { id: 'x', type: 'paragraph', content: [t('a')], meta: { provenance: { kind: 'ocr', capturedAt: '2026-08-16T00:00:00Z' } } }],
  [
    '중첩 안 블록 메타(사이드카 — 평평한 id 맵)',
    {
      id: 'x',
      type: 'listItem',
      ordered: false,
      content: [t('상위')],
      children: [{ id: 'y', type: 'paragraph', content: [t('하위')], meta: { provenance: { kind: 'ocr' } } }],
    },
  ],
  [
    '인용 첫 문단 끌어올리기 + 사이드카 이관',
    {
      id: 'q',
      type: 'quote',
      children: [
        {
          id: 'q-first',
          type: 'paragraph',
          content: [{ type: 'link', url: 'https://example.com', title: '타이틀', children: [t('링크')] }],
          meta: { provenance: { kind: 'ocr' } },
        },
        p([t('둘째 문단')]),
      ],
    },
  ],
]
for (const [label, block] of DIALECT_ROUNDTRIP_CASES) {
  const doc = { version: 1, blocks: [block] }
  const { blocks, unsupported, sidecar } = toBlockNoteBlocks(doc)
  check(`[방언-미지원0] ${label}`, unsupported.length === 0, `미지원=${JSON.stringify(unsupported)}`)
  const want = stable(stripIds(doc.blocks))
  check(
    `[방언왕복] ${label}`,
    stable(stripIds(fromBlockNoteBlocks(blocks, sidecar).blocks)) === want,
    `원본=${want} 왕복=${stable(stripIds(fromBlockNoteBlocks(blocks, sidecar).blocks))}`,
  )
}

// ③-d ② 남아 있는 보고 — 구조적 사유 + **R34 판정 대기 3종**(임의 흡수 금지).
const UNSUPPORTED_CASES = [
  [
    '링크 안 칩',
    p([{ type: 'link', url: 'https://example.com', children: [{ type: 'refChip', ref: 'doc', target: 'DOC-1' }] }]),
    'link:nested',
  ],
  [
    '링크 안 링크(중첩 링크)',
    p([
      {
        type: 'link',
        url: 'https://a.example',
        children: [{ type: 'link', url: 'https://b.example', children: [t('안쪽')] }],
      },
    ]),
    'link:nested',
  ],
  [
    '번호 목록 체크박스',
    { id: 'x', type: 'listItem', ordered: true, checked: true, content: [t('a')] },
    'listItem:orderedChecked',
  ],
  [
    '인라인 수식에 걸린 서식',
    p([{ type: 'inlineMath', value: 'a^2', styles: { bold: true } }]),
    'inline:mathStyles',
  ],
  ['느슨한 목록', { id: 'x', type: 'listItem', ordered: false, spread: true, content: [t('a')] }, 'listItem:spread'],
  [
    '인접 목록 경계',
    { id: 'x', type: 'listItem', ordered: false, groupBreak: true, content: [t('a')] },
    'listItem:groupBreak',
  ],
  [
    '표 열 정렬',
    { id: 'x', type: 'table', align: ['center'], rows: [[[t('머리')]], [[t('셀')]]] },
    'table:align',
  ],
]
for (const [label, block, kind] of UNSUPPORTED_CASES) {
  const { unsupported } = toBlockNoteBlocks({ version: 1, blocks: [block] })
  check(
    `[손실0] ${label}`,
    unsupported.some((issue) => issue.kind === kind),
    `기대 사유=${kind} 실제=${JSON.stringify(unsupported)}`,
  )
}

// ③-d ③ 판정 대기 3종 중 `table:align`은 **보고를 유지하면서도 값은 왕복 보존**된다(사이드카).
// 열 수가 달라지면(사용자가 열을 넣거나 뺐다) 어긋난 정렬을 되살리지 않는다.
{
  const table = { id: 'tb', type: 'table', align: ['center', null], rows: [[[t('머리')], [t('둘')]], [[t('셀')], [t('둘')]]] }
  const { blocks, sidecar } = toBlockNoteBlocks({ version: 1, blocks: [table] })
  const back = fromBlockNoteBlocks(blocks, sidecar)
  check('[사이드카] 표 정렬 왕복 보존', stable(back.blocks[0].align) === stable(['center', null]), `실제=${stable(back.blocks[0].align)}`)
  const shrunk = JSON.parse(JSON.stringify(blocks))
  shrunk[0].content.rows = shrunk[0].content.rows.map((row) => ({ cells: row.cells.slice(0, 1) }))
  const backShrunk = fromBlockNoteBlocks(shrunk, sidecar)
  check(
    '[사이드카] 열 수가 바뀌면 정렬을 되살리지 않는다',
    stable(backShrunk.blocks[0].align) === stable([null]),
    `실제=${stable(backShrunk.blocks[0].align)}`,
  )
}

// ③-e 규약 C — 마이크로 마크 상호 배타. 어댑터는 조용히 접지 않고 **집계 보고**한다.
{
  const bn = [
    {
      id: '1',
      type: 'paragraph',
      content: [{ type: 'text', text: '겹침', styles: { underline: true, highlight: true, spoiler: true } }],
    },
  ]
  const result = fromBlockNoteResult(bn)
  const styles = result.document.blocks[0].content[0].styles
  check('[규약C] 마이크로 마크는 1개만 남는다', stable(styles) === stable({ underline: true }), `실제=${stable(styles)}`)
  check('[규약C] 접은 건수 집계 보고', stable(result.microMarkCollapses) === stable(['highlight', 'spoiler']), `실제=${stable(result.microMarkCollapses)}`)
  const clean = fromBlockNoteResult([{ id: '1', type: 'paragraph', content: [{ type: 'text', text: 'a', styles: { highlight: true } }] }])
  check('[규약C] 겹치지 않으면 접지 않는다', clean.microMarkCollapses.length === 0)
  check(
    '[규약C] 우선순위는 MARK_ORDER(밑줄 > 형광 > 스포일러)',
    stable(collapseMicroMarks({ highlight: true, spoiler: true }).styles) === stable({ highlight: true }) &&
      stable(MICRO_MARKS) === stable(['underline', 'highlight', 'spoiler']),
  )
}

mark('③ 손실 0 — 방언 무손실 왕복 · 잔존 보고 · 사이드카 · 규약 C')

// ---------------------------------------------------------------- ④ BN 출발 왕복(실제 저장 경로)

console.log('== ④ BN 출발 왕복: 편집기 문서 → 앱 블록 → 편집기 문서 (저장·재로드 안정성) ==')
const bt = (text, styles) => ({ type: 'text', text, styles: styles ?? {} })
const BN_ORIGIN = [
  ['빈 문단', [{ id: '1', type: 'paragraph', content: [] }]],
  ['평문 문단', [{ id: '1', type: 'paragraph', content: [bt('그냥 문단')] }]],
  [
    '서식 4종',
    [
      {
        id: '1',
        type: 'paragraph',
        content: [
          bt('굵게', { bold: true }),
          bt('기울임', { italic: true }),
          bt('취소', { strike: true }),
          bt('밑줄', { underline: true }),
          bt('코드', { code: true }),
        ],
      },
    ],
  ],
  ['줄바꿈(\\n)', [{ id: '1', type: 'paragraph', content: [bt('첫 줄\n둘째 줄')] }]],
  [
    '링크',
    [{ id: '1', type: 'paragraph', content: [{ type: 'link', href: 'https://example.com', content: [bt('링크')] }] }],
  ],
  ['헤딩 1~6', [1, 2, 3, 4, 5, 6].map((level, i) => ({ id: `h${i}`, type: 'heading', props: { level }, content: [bt(`제목 ${level}`)] }))],
  [
    '중첩 불릿 목록',
    [
      {
        id: '1',
        type: 'bulletListItem',
        content: [bt('상위')],
        children: [{ id: '2', type: 'bulletListItem', content: [bt('하위')], children: [] }],
      },
    ],
  ],
  [
    '번호 목록(시작 번호)',
    [{ id: '1', type: 'numberedListItem', props: { start: 3 }, content: [bt('셋')], children: [] }],
  ],
  ['체크 목록', [{ id: '1', type: 'checkListItem', props: { checked: true }, content: [bt('완료')], children: [] }]],
  ['인용(한 줄)', [{ id: '1', type: 'quote', content: [bt('인용문')], children: [] }]],
  [
    '인용(다중 블록)',
    [
      {
        id: '1',
        type: 'quote',
        content: [bt('첫 문단')],
        children: [{ id: '2', type: 'paragraph', content: [bt('둘째 문단')], children: [] }],
      },
    ],
  ],
  [
    '코드 블록',
    [{ id: '1', type: 'codeBlock', props: { language: 'javascript', info: '' }, content: [bt('const a = 1')] }],
  ],
  [
    '코드 블록(언어 없음 = text)',
    [{ id: '1', type: 'codeBlock', props: { language: 'text', info: '' }, content: [bt('평범한 코드')] }],
  ],
  [
    '코드 블록(info 보존 — 규약 E)',
    [{ id: '1', type: 'codeBlock', props: { language: 'javascript', info: 'title=a' }, content: [bt('x')] }],
  ],
  [
    '표',
    [
      {
        id: '1',
        type: 'table',
        content: {
          type: 'tableContent',
          columnWidths: [undefined, undefined],
          headerRows: 1,
          rows: [
            { cells: [[bt('a')], [bt('b')]] },
            { cells: [[bt('1')], [bt('2')]] },
          ],
        },
      },
    ],
  ],
  [
    '표(편집기가 돌려주는 tableCell 형태)',
    [
      {
        id: '1',
        type: 'table',
        content: {
          type: 'tableContent',
          columnWidths: [undefined],
          headerRows: 1,
          rows: [
            { cells: [{ type: 'tableCell', props: { textAlignment: 'left' }, content: [bt('머리')] }] },
            { cells: [{ type: 'tableCell', props: { textAlignment: 'left' }, content: [bt('셀')] }] },
          ],
        },
      },
    ],
    // 편집기 형태는 왕복 시 단순 배열 형태로 정규화된다 — 앱 블록 기준으로 비교하므로 동등.
  ],
  ['이미지', [{ id: '1', type: 'image', props: { url: '/images/x.png', caption: '캡션', previewWidth: 400, name: '' } }]],
  [
    '이미지(확장 prop — title·height)',
    [{ id: '1', type: 'image', props: { url: '/images/x.png', caption: '캡션', previewWidth: 400, title: '제목', height: 300, name: '' } }],
  ],
  ['구분선', [{ id: '1', type: 'divider' }]],
  // ---- stage-34 방언 스펙(편집기가 실제로 돌려주는 형태)
  ['수식 블록', [{ id: '1', type: 'mathBlock', props: {}, content: [bt('a^2 + b^2')] }]],
  ['인라인 수식', [{ id: '1', type: 'paragraph', content: [bt('앞 '), { type: 'math', props: {}, content: 'a^2' }, bt(' 뒤')] }]],
  [
    '참조 칩 3종',
    [
      {
        id: '1',
        type: 'paragraph',
        content: [
          { type: 'refChip', props: { refType: 'doc', target: 'DOC-0012', label: '', styles: '' } },
          bt(' '),
          { type: 'refChip', props: { refType: 'anchor', target: '절 제목', label: '보이는 이름', styles: '' } },
          bt(' '),
          { type: 'refChip', props: { refType: 'embed', target: 'DOC-0007', label: '', styles: '' } },
        ],
      },
    ],
  ],
  [
    '문단 안 이미지',
    [
      {
        id: '1',
        type: 'paragraph',
        content: [bt('앞 '), { type: 'inlineImage', props: { url: '/images/x.png', alt: '캡션', title: '', width: 250, height: 0, styles: '' } }, bt(' 뒤')],
      },
    ],
  ],
  [
    '경성 줄바꿈(원자)',
    [{ id: '1', type: 'paragraph', content: [bt('첫'), { type: 'lineBreak', props: { styles: '' } }, bt('둘')] }],
  ],
  [
    '방언 스타일 3종',
    [
      {
        id: '1',
        type: 'paragraph',
        content: [
          bt('형광', { highlight: true }),
          bt('가림', { spoiler: true }),
          bt('색', { t: JSON.stringify([['c', 'red'], ['s', 'large']]) }),
        ],
      },
    ],
  ],
  [
    '콜아웃(children)',
    [
      {
        id: '1',
        type: 'callout',
        props: { variant: 'warn', title: '주의', attrs: '' },
        children: [{ id: '2', type: 'paragraph', content: [bt('내용')], children: [] }],
      },
    ],
  ],
  ['문서 임베드', [{ id: '1', type: 'docEmbed', props: { target: 'DOC-0007', label: '다른 이름' } }]],
  [
    '원문 보존 블록',
    [{ id: '1', type: 'sourceFallback', props: { markdown: '<div class="x">\n원시 HTML\n</div>', nodeType: 'html' } }],
  ],
]

let bnPass = 0
for (const [label, blocks] of BN_ORIGIN) {
  const doc = fromBlockNoteBlocks(blocks)
  const { blocks: bn2, unsupported, sidecar } = toBlockNoteBlocks(doc)
  check(`[BN왕복-미지원0] ${label}`, unsupported.length === 0, `미지원=${JSON.stringify(unsupported)}`)
  const doc2 = fromBlockNoteBlocks(bn2, sidecar)
  const ok = stable(stripIds(doc.blocks)) === stable(stripIds(doc2.blocks))
  if (ok) bnPass += 1
  check(
    `[BN왕복] ${label}`,
    ok,
    `1차=${stable(stripIds(doc.blocks)).slice(0, 300)} 2차=${stable(stripIds(doc2.blocks)).slice(0, 300)}`,
  )
  // 투영 고정점 — 저장 때마다 Markdown이 흔들리지 않아야 한다.
  check(`[BN투영고정점] ${label}`, blocksToMarkdown(doc) === blocksToMarkdown(doc2))
}
console.log(`  BN 출발 왕복: ${bnPass}/${BN_ORIGIN.length}`)

// ④-b 규약 D — 말미 연속 빈 문단은 1개만 남는다(본문 중간은 불변).
{
  const empty = (id) => ({ id, type: 'paragraph', content: [] })
  const doc = fromBlockNoteBlocks([
    { id: '1', type: 'paragraph', content: [bt('본문')] },
    empty('2'),
    { id: '3', type: 'paragraph', content: [bt('중간 뒤')] },
    empty('4'),
    empty('5'),
    empty('6'),
  ])
  check(
    '[규약D] 말미 빈 문단 1개만 남음',
    doc.blocks.length === 4 && doc.blocks[3].type === 'paragraph' && doc.blocks[3].content.length === 0,
    `블록=${stable(stripIds(doc.blocks))}`,
  )
  check(
    '[규약D] 본문 중간 빈 문단 보존',
    doc.blocks[1].type === 'paragraph' && doc.blocks[1].content.length === 0,
    `블록=${stable(stripIds(doc.blocks))}`,
  )
  // 누적 방지: 트림된 결과를 다시 저장해도 더 줄지 않는다(고정점).
  const doc2 = fromBlockNoteBlocks(toBlockNoteBlocks(doc).blocks)
  check('[규약D] 트림 고정점', stable(stripIds(doc.blocks)) === stable(stripIds(doc2.blocks)))
}

// ④-c id 왕복 보존 — BlockNote가 부여한 id가 앱 블록 id로 그대로 실린다.
{
  const doc = fromBlockNoteBlocks([
    { id: 'bn-abc', type: 'paragraph', content: [bt('a')] },
    {
      id: 'bn-def',
      type: 'bulletListItem',
      content: [bt('b')],
      children: [{ id: 'bn-ghi', type: 'bulletListItem', content: [bt('c')], children: [] }],
    },
  ])
  check('[id보존] 최상위', doc.blocks[0].id === 'bn-abc' && doc.blocks[1].id === 'bn-def')
  check('[id보존] 중첩', doc.blocks[1].children?.[0]?.id === 'bn-ghi')
  const back = toBlockNoteBlocks(doc).blocks
  check('[id보존] 역방향', back[0].id === 'bn-abc' && back[1].children?.[0]?.id === 'bn-ghi')
}

mark('④ BN 출발 왕복 + 규약 D + id 보존')

// ---------------------------------------------------------------- ⑤ 실제 BlockNote 스키마 적재 왕복
//
// 어댑터 산출 JSON을 **화면이 쓰는 그 스키마**(`noteSchema`)로 ProseMirror 문서에 적재했다가
// 되읽는다. 여기까지 통과하면 다음 셋이 동시에 보증된다:
//   ⓐ 어댑터가 만든 블록 타입·prop·content 형태가 실제 스키마에 **그대로 실린다**
//      (`blocknote/schema.ts`의 경계 캐스트 2곳이 거짓말을 하고 있지 않다)
//   ⓑ 편집기가 정규화해 돌려주는 형태(표 셀 객체화·줄바꿈 접힘 등)를 `fromBlockNote`가 읽어낸다
//   ⓒ 앱 전용 확장 prop(codeBlock `info` — 규약 E)이 스키마를 통과해 살아남는다
// DOM은 필요 없다(`_blocksToProsemirrorNode`/`_prosemirrorNodeToBlocks`는 jsdom 없이 동작한다 —
// HTML 직렬화 경로만 jsdom을 쓴다).
console.log('== ⑤ 실제 BlockNote 스키마 적재: 어댑터 JSON → ProseMirror 문서 → 어댑터 JSON ==')
const server = ServerBlockNoteEditor.create({ schema: noteSchema })

/** 경계 캐스트(asEditorBlocks/asAdapterBlocks)를 **실제로 통과시켜** 왕복시킨다. */
function throughSchema(blocks) {
  const pmNode = server._blocksToProsemirrorNode(asEditorBlocks(blocks))
  return asAdapterBlocks(server._prosemirrorNodeToBlocks(pmNode))
}

let schemaCore = 0
let schemaPass = 0
for (const [label, src] of CORPUS) {
  const doc1 = markdownToBlocks(src)
  const { blocks: bn, unsupported, sidecar } = toBlockNoteBlocks(doc1)
  if (unsupported.length > 0) continue
  schemaCore += 1
  let doc2
  try {
    doc2 = fromBlockNoteBlocks(throughSchema(bn), sidecar)
  } catch (error) {
    check(`[스키마적재] ${label}`, false, `적재 실패: ${error?.message ?? error}`)
    continue
  }
  const want = stable(stripIds(doc1.blocks))
  const got = stable(stripIds(doc2.blocks))
  const ok = want === got
  if (ok) schemaPass += 1
  check(`[스키마적재] ${label}`, ok, ok ? '' : `원본=${want.slice(0, 400)} 적재후=${got.slice(0, 400)}`)
  check(
    `[스키마적재-투영] ${label}`,
    blocksToMarkdown(doc1) === blocksToMarkdown(doc2),
    `원본투영=${JSON.stringify(blocksToMarkdown(doc1))} 적재후=${JSON.stringify(blocksToMarkdown(doc2))}`,
  )
}
console.log(`  코어 표본 실제 스키마 왕복: ${schemaPass}/${schemaCore}`)

// ⑤-b BN 출발 표본도 실제 스키마를 통과시킨다(props·표·중첩·확장 prop이 스키마에 살아남는가).
let schemaBnPass = 0
for (const [label, blocks] of BN_ORIGIN) {
  const doc = fromBlockNoteBlocks(blocks)
  let doc2
  try {
    const forward = toBlockNoteBlocks(doc)
    doc2 = fromBlockNoteBlocks(throughSchema(forward.blocks), forward.sidecar)
  } catch (error) {
    check(`[스키마적재-BN] ${label}`, false, `적재 실패: ${error?.message ?? error}`)
    continue
  }
  const ok = stable(stripIds(doc.blocks)) === stable(stripIds(doc2.blocks))
  if (ok) schemaBnPass += 1
  check(
    `[스키마적재-BN] ${label}`,
    ok,
    `1차=${stable(stripIds(doc.blocks)).slice(0, 300)} 적재후=${stable(stripIds(doc2.blocks)).slice(0, 300)}`,
  )
}
console.log(`  BN 출발 표본 실제 스키마 왕복: ${schemaBnPass}/${BN_ORIGIN.length}`)

// ⑤-c 스키마 팔레트 고정 — 채택한 블록·스타일·인라인 집합이 조용히 넓어지거나 좁아지지 않게 한다
// (BlockNote 기본 색 스타일 2종이 되돌아오면 불변 규칙 5가 깨진다).
{
  const blockTypes = Object.keys(noteSchema.blockSchema).sort().join(',')
  const styleTypes = Object.keys(noteSchema.styleSchema).sort().join(',')
  const inlineTypes = Object.keys(noteSchema.inlineContentSchema).sort().join(',')
  check(
    '[스키마팔레트] 블록 14종 고정(코어 10 + 방언 4)',
    blockTypes ===
      'bulletListItem,callout,checkListItem,codeBlock,divider,docEmbed,heading,image,mathBlock,numberedListItem,paragraph,quote,sourceFallback,table',
    `실제=${blockTypes}`,
  )
  check(
    '[스키마팔레트] 스타일 8종 고정(BlockNote 기본 색 스타일 0)',
    styleTypes === 'bold,code,highlight,italic,spoiler,strike,t,underline',
    `실제=${styleTypes}`,
  )
  check(
    '[스키마팔레트] 인라인 7종 고정(내장 2 + 방언 5)',
    inlineTypes === 'inlineFallback,inlineImage,lineBreak,link,math,refChip,text',
    `실제=${inlineTypes}`,
  )
  // 기본 색 스타일 2종이 되돌아오면 불변 규칙 5가 깨진다 — 이름으로 못 박는다.
  check(
    '[스키마팔레트] textColor/backgroundColor 스타일 0',
    !('textColor' in noteSchema.styleSchema) && !('backgroundColor' in noteSchema.styleSchema),
  )
  const props = (type) => Object.keys(noteSchema.blockSchema[type].propSchema).sort().join(',')
  check('[스키마팔레트] 문단 표현 prop 0', props('paragraph') === '', `실제=${props('paragraph')}`)
  check('[스키마팔레트] 헤딩 prop = level만', props('heading') === 'level', `실제=${props('heading')}`)
  check('[스키마팔레트] 코드블록 prop = info,language', props('codeBlock') === 'info,language', `실제=${props('codeBlock')}`)
  // 규약 I 흡수 ③ — 내장 image에 확장 prop 2개가 붙어 있는가(빠지면 title·height가 조용히 사라진다).
  check(
    '[스키마팔레트] 이미지 확장 prop(title·height) 존재',
    props('image') === 'caption,height,name,previewWidth,showPreview,title,url',
    `실제=${props('image')}`,
  )
  check('[스키마팔레트] 콜아웃 prop = attrs,title,variant', props('callout') === 'attrs,title,variant', `실제=${props('callout')}`)
  check('[스키마팔레트] 임베드 prop = label,target', props('docEmbed') === 'label,target', `실제=${props('docEmbed')}`)
  check(
    '[스키마팔레트] 원문 보존 prop = markdown,nodeType',
    props('sourceFallback') === 'markdown,nodeType',
    `실제=${props('sourceFallback')}`,
  )
  const inlineProps = (type) => Object.keys(noteSchema.inlineContentSchema[type].propSchema).sort().join(',')
  check(
    '[스키마팔레트] 참조 칩 prop = label,refType,styles,target',
    inlineProps('refChip') === 'label,refType,styles,target',
    `실제=${inlineProps('refChip')}`,
  )
  check(
    '[스키마팔레트] 문단 안 이미지 prop = alt,height,styles,title,url,width',
    inlineProps('inlineImage') === 'alt,height,styles,title,url,width',
    `실제=${inlineProps('inlineImage')}`,
  )
  // 원자 인라인 4종은 전부 content:'none'(내부 편집 불가). 수식만 'plain'이다.
  const icContent = (type) => noteSchema.inlineContentSchema[type].content
  check(
    '[스키마팔레트] 방언 인라인은 원자(content:none) · 수식만 plain',
    icContent('refChip') === 'none' &&
      icContent('inlineImage') === 'none' &&
      icContent('inlineFallback') === 'none' &&
      icContent('lineBreak') === 'none' &&
      icContent('math') === 'plain',
  )
}
mark('⑤ 실제 BlockNote 스키마 적재 왕복 + 팔레트 고정')

// ---------------------------------------------------------------- 결과

console.log('')
for (const section of sections) console.log(`계열 ${section.label}: ${section.count}건`)
console.log(`총 ${pass + fail}건 · 통과 ${pass} · 실패 ${fail}`)
if (fail) {
  console.log('실패 목록:')
  for (const line of failures) console.log(`  - ${line}`)
  process.exit(1)
}
