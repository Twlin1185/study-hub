// S32(M32) 변환 계층 왕복 코퍼스 검증 — stage-32 4-2/4-3.
//
// 실행: node frontend/scripts/s32-roundtrip-blocks.mjs
//   (프론트 유틸이라 pytest 대상이 아니다 — 불변 규칙 7의 "실행 스모크"에 해당한다.
//    TS 모듈은 s30 관례 그대로 jiti로 불러온다 — 신규 설치 0.)
//
// 검사 5계열(stage-32 규약 A·D):
//   ① 정규형 동등  : md → 블록 → md 투영본을 **같은 remark 파이프라인**으로 각각 파싱해
//                    정규화 함수 N(position 제거 · 인라인을 (텍스트, 마크 집합) run으로 평탄화 ·
//                    인접 동일 마크 병합)을 통과시킨 결과가 deep-equal인가 (규약 A-1).
//                    N은 이 스크립트가 **변환기와 독립적으로** mdast 위에 구현한다 —
//                    변환기가 정보를 흘리면 양쪽이 똑같이 흘려 통과하는 공허한 검사를 피한다.
//   ①-b 블록 동등 : 원본 블록과 투영본 재변환 블록이 id 제외 동등(변환기 자체의 안정성).
//   ② 고정점      : 1차 투영본을 재왕복하면 **바이트 동일** (규약 A-2).
//   ③ 이스케이프  : 문법 문자를 평문으로 담은 블록의 투영→재파싱이 같은 평문을 복원하는가 +
//                    이스케이프 과잉 방지(단어 내부 `_` 비이스케이프 · URL 백슬래시 0) (규약 A-3).
//   ④ 블록 출발   : 프로그램 생성 블록 → md → 블록 재변환이 id 제외 동등.
//   ⑤ fallback    : 팔레트 표본에서 sourceFallback/inlineFallback 발생 0 (규약 D · DoD 2).
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { SAMPLES, HAZARDS, BLOCK_SAMPLES } from './roundtrip-corpus.mjs'
import { stable, stripIds, countFallbacks, makeNormalize } from './s32-normalize.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FRONT = path.resolve(HERE, '..')
const SRC = path.join(FRONT, 'src')

const require = createRequire(path.join(FRONT, 'package.json'))
const jiti = require('jiti')(path.join(FRONT, 'scripts/_loader.cjs'), {
  interopDefault: true,
  esmResolve: true,
  cache: false,
  requireCache: false,
})

const transform = jiti(path.join(SRC, 'editor2/transform/index.ts'))
const { markdownToBlocks, blocksToMarkdown, parseToMdast, serializeInline } = transform
// stage-34 G-5 — 참조 칩 라벨·target 문자 도메인은 이제 `schema/refDomain.ts`가 **단일 출처**다.
// 이 스크립트가 표를 따로 들고 있으면 앱과 검증이 갈라지므로, 아래 계열 ⑥이 그 모듈을 직접 불러
// **표와 함수의 판정이 일치하는지 + 함수가 통과시킨 것은 반드시 왕복하는지**를 기계로 고정한다.
const refDomain = jiti(path.join(SRC, 'editor2/schema/refDomain.ts'))
const { isSafeRefText, normalizeRefText, refTextRejection, isDocNo, isSafeAnchorTarget } = refDomain

// ---------------------------------------------------------------- 공통 유틸

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

// 정규화 함수 N은 `s32-normalize.mjs`가 단일 출처다(실문서 보조 검증과 공용).
const normalize = makeNormalize(parseToMdast)

// ---------------------------------------------------------------- ①·①-b·②·⑤ 표본 왕복

const CORPUS = [
  ...SAMPLES,
  ...BLOCK_SAMPLES,
  ['문서 전체 결합(SAMPLES)', SAMPLES.map(([, src]) => src).join('\n\n')],
  ['문서 전체 결합(BLOCK_SAMPLES)', BLOCK_SAMPLES.map(([, src]) => src).join('\n\n')],
]

// 팔레트 밖 문법이라 fallback이 **나는 것이 정상**인 표본(규약 D의 안전망 자체를 검증한다).
const FALLBACK_EXPECTED = new Set(['HTML 원시 블록', '각주 정의', '문서 전체 결합(BLOCK_SAMPLES)'])

console.log('== ①/①-b/② 표본 왕복: 정규형 동등 · 블록 동등 · 고정점 ==')
let normPass = 0
let blockPass = 0
let fixedPass = 0
const fallbackTotals = new Map()
let fallbackTotal = 0

for (const [label, src] of CORPUS) {
  const doc1 = markdownToBlocks(src)
  const md1 = blocksToMarkdown(doc1)
  const doc2 = markdownToBlocks(md1)
  const md2 = blocksToMarkdown(doc2)

  // ① 정규형 동등
  const a = stable(normalize(src))
  const b = stable(normalize(md1))
  const okNorm = a === b
  if (okNorm) normPass += 1
  check(
    `[정규형] ${label}`,
    okNorm,
    okNorm ? '' : `원본N=${a.slice(0, 400)} 투영N=${b.slice(0, 400)} 투영=${JSON.stringify(md1)}`,
  )

  // ①-b 블록 동등(id 제외)
  const okBlocks = stable(stripIds(doc1.blocks)) === stable(stripIds(doc2.blocks))
  if (okBlocks) blockPass += 1
  check(
    `[블록동등] ${label}`,
    okBlocks,
    okBlocks ? '' : `원본=${stable(stripIds(doc1.blocks)).slice(0, 400)} 재변환=${stable(stripIds(doc2.blocks)).slice(0, 400)}`,
  )

  // ② 고정점(바이트 동일)
  const okFixed = md1 === md2
  if (okFixed) fixedPass += 1
  check(`[고정점] ${label}`, okFixed, okFixed ? '' : `1차=${JSON.stringify(md1)} 2차=${JSON.stringify(md2)}`)

  // ⑤ fallback 집계
  const counts = countFallbacks(doc1.blocks)
  const total = counts.block + counts.inline
  fallbackTotal += total
  for (const [type, n] of counts.types) fallbackTotals.set(type, (fallbackTotals.get(type) ?? 0) + n)
  const expected = FALLBACK_EXPECTED.has(label)
  check(
    `[fallback] ${label}`,
    expected ? total > 0 : total === 0,
    expected ? `안전망 표본인데 fallback 0` : `fallback ${total}건(${[...counts.types.keys()].join(',')})`,
  )
}
console.log(`  정규형 동등: ${normPass}/${CORPUS.length} · 블록 동등: ${blockPass}/${CORPUS.length} · 고정점: ${fixedPass}/${CORPUS.length}`)
console.log(
  `  fallback 총 ${fallbackTotal}건 (${[...fallbackTotals].map(([k, v]) => `${k}=${v}`).join(' · ') || '없음'}) — 안전망 표본 ${FALLBACK_EXPECTED.size}종 제외 전 표본 0`,
)

// ---------------------------------------------------------------- ③ 이스케이프 방어 (규약 A-3)

// s30 HAZARDS 계승 + 블록 문법 고유 위험(펜스·구분선·표 행·콜아웃 등).
const BLOCK_HAZARDS = [
  ['코드 펜스 입력', '```js'],
  ['구분선 입력', '---'],
  ['setext 입력', '==='],
  ['숫자 목록 입력', '1. 항목처럼'],
  ['인용 기호 입력', '> 인용처럼'],
  ['체크박스 입력', '- [ ] 항목처럼'],
  ['표 행 입력', '| a | b |'],
  ['콜아웃 입력', ':::note[제목]'],
  ['HTML 태그 입력', '<div class="x">'],
  ['엔티티 입력', '&amp; 와 &#65;'],
  ['수식 입력', '$a^2$ 와 $$블록$$'],
  // 임베드는 **문단 밖 블록으로 승격**되는 것이 F43 기존 동작이다(remarkStudy.unwrapEmbeds).
  // 텍스트가 살아남는지만 본다 — 승격 경계에 붙어 있던 공백 1칸은 Markdown이 표현할 수 없다.
  ['임베드 입력', '![[DOC-0001]]처럼 보이는 글자'],
  ['틸드 입력', '~물결~ 과 ~~둘~~'],
]

const ALL_HAZARDS = [...HAZARDS.map(([label, , typed]) => [label, typed]), ...BLOCK_HAZARDS]

/**
 * 블록 트리에서 **평문만** 뽑는다(링크 안쪽까지 훑는다 — 마크·구조는 보지 않는다).
 *
 * 참조 칩은 기본적으로 **평문이 아니다** — 규약 A-3이 요구하는 것은 "같은 **평문**의 복원"이므로,
 * 평문으로 입력한 `[[DOC-0001]]`이 칩으로 승격됐다면 그것은 통과가 아니다(검토 A2).
 * `expandChips=true`는 그 승격을 **식별하기 위한 별도 계산**일 뿐 판정에 쓰지 않는다.
 */
function plainOfInlines(nodes, expandChips) {
  let out = ''
  for (const node of nodes ?? []) {
    if (node.type === 'text') out += node.text
    else if (node.type === 'softBreak') out += '\n'
    else if (node.type === 'hardBreak') out += '\n'
    else if (node.type === 'link') out += plainOfInlines(node.children, expandChips)
    else if (node.type === 'inlineCode') out += node.value
    else if (node.type === 'inlineMath') out += node.value
    else if (node.type === 'inlineFallback') out += node.markdown
    else if (node.type === 'inlineImage') out += `![${node.alt}](${node.url})`
    else if (node.type === 'refChip' && expandChips) {
      const label = node.label === undefined ? '' : `|${node.label}`
      out += node.ref === 'embed' ? `![[${node.target}${label}]]` : node.ref === 'anchor' ? `[[#${node.target}${label}]]` : `[[${node.target}${label}]]`
    }
  }
  return out
}

function plainOfBlocks(blocks, expandChips) {
  const parts = []
  for (const block of blocks ?? []) {
    if (block.content) parts.push(plainOfInlines(block.content, expandChips))
    if (block.type === 'table') {
      for (const row of block.rows) for (const cell of row) parts.push(plainOfInlines(cell, expandChips))
    }
    if (block.type === 'codeBlock') parts.push(block.code)
    if (block.type === 'mathBlock') parts.push(block.value)
    if (block.type === 'sourceFallback') parts.push(block.markdown)
    if (block.type === 'docEmbed' && expandChips) {
      parts.push(`![[${block.target}${block.label === undefined ? '' : `|${block.label}`}]]`)
    }
    if (block.children) parts.push(plainOfBlocks(block.children, expandChips))
  }
  return parts.join('')
}

/** 문법 문자를 담은 텍스트를 여러 블록 문맥에 심어 본다. */
const HAZARD_CONTEXTS = [
  ['문단', (text) => [{ id: 'x', type: 'paragraph', content: [{ type: 'text', text }] }]],
  ['헤딩', (text) => [{ id: 'x', type: 'heading', level: 2, content: [{ type: 'text', text }] }]],
  [
    '인용',
    (text) => [
      { id: 'x', type: 'quote', children: [{ id: 'y', type: 'paragraph', content: [{ type: 'text', text }] }] },
    ],
  ],
  [
    '목록',
    (text) => [{ id: 'x', type: 'listItem', ordered: false, content: [{ type: 'text', text }] }],
  ],
  [
    '표 셀',
    (text) => [
      {
        id: 'x',
        type: 'table',
        align: [null],
        rows: [[[{ type: 'text', text: '머리' }]], [[{ type: 'text', text }]]],
      },
    ],
  ],
]

console.log('== ③ 이스케이프 방어: 문법 문자를 평문으로 담은 블록의 투영→재파싱 ==')
let hazardPass = 0
let hazardTotal = 0
// **알려진 방언 한계**: F43 참조 문법(`[[…]]`·`![[…]]`)은 `remarkStudy`가 참조 스캔에서 백슬래시
// 마스크를 보지 않아 **평문으로 되돌릴 이스케이프가 존재하지 않는다**(리더의 기존 동작과 동일 —
// 저장된 본문의 `[[DOC-0001]]`은 지금도 칩으로 렌더된다). 이 경우는 "통과"가 아니라 **별도로
// 집계·표시**하고 총계에 넣지 않는다(검토 A2 — 검사가 사실을 가리지 않게 한다).
const knownLimits = []
for (const [label, typed] of ALL_HAZARDS) {
  for (const [ctxLabel, build] of HAZARD_CONTEXTS) {
    const md = blocksToMarkdown({ version: 1, blocks: build(typed) })
    const back = markdownToBlocks(md)
    const expected = ctxLabel === '표 셀' ? `머리${typed}` : typed
    const plain = plainOfBlocks(back.blocks, false)
    if (plain !== expected && plainOfBlocks(back.blocks, true) === expected) {
      // 평문은 사라졌지만 참조 칩으로 승격돼 문법은 보존된 경우 — 알려진 한계로 분리.
      knownLimits.push(`${label} (${ctxLabel})`)
      continue
    }
    hazardTotal += 1
    const ok = plain === expected
    if (ok) hazardPass += 1
    check(
      `[방어] ${label} (${ctxLabel})`,
      ok,
      ok ? '' : `투영=${JSON.stringify(md)} 재파싱평문=${JSON.stringify(plain)}`,
    )
  }
}
console.log(`  조용한 변형 0: ${hazardPass}/${hazardTotal}`)
console.log(
  `  알려진 방언 한계(참조 문법 평문 이스케이프 불가 → 칩 승격, 총계 제외): ${knownLimits.length}건` +
    (knownLimits.length ? ` — ${knownLimits.join(' · ')}` : ''),
)

// ③-2 이스케이프 과잉 방지 — s30 ②-4 계약 계승(구현은 독립이지만 결과는 같아야 한다).
console.log('== ③-2 이스케이프 과잉 방지(`_` 문맥 감응 · URL 백슬래시 0) ==')
const ESCAPE_CASES = [
  ['URL 안 언더스코어', 'http://a.com/b_c', 'http://a.com/b_c'],
  ['식별자', 'snake_case_name 와 A_1', 'snake_case_name 와 A_1'],
  ['한글 사이', '가_나', '가_나'],
  ['이중 언더스코어 단어 내부', 'foo__bar__baz', 'foo__bar__baz'],
  ['강조가 될 수 있는 형태', '_강조_ 시도', '\\_강조\\_ 시도'],
  ['앞이 공백', 'a _b', 'a \\_b'],
  ['문자열 경계', '_시작과 끝_', '\\_시작과 끝\\_'],
  ['구두점 옆', '(_a_)', '(\\_a\\_)'],
  ['별표 회귀', 'a * b * c', 'a \\* b \\* c'],
  ['참조 회귀', '[[DOC-0001]] 처럼', '\\[\\[DOC-0001\\]\\] 처럼'],
  ['백틱 회귀', '`코드`', '\\`코드\\`'],
  ['마이크로 회귀', 'a==b==c', 'a\\==b\\==c'],
]
let escPass = 0
for (const [label, typed, expected] of ESCAPE_CASES) {
  const out = serializeInline([{ type: 'text', text: typed }])
  const ok = out === expected
  if (ok) escPass += 1
  check(`[이스케이프] ${label}`, ok, ok ? '' : `기대=${JSON.stringify(expected)} 실제=${JSON.stringify(out)}`)
}
check(
  '[이스케이프] URL 백슬래시 0',
  !serializeInline([{ type: 'text', text: 'http://a.com/b_c' }]).includes('\\'),
)
console.log(`  이스케이프 문맥 정확: ${escPass}/${ESCAPE_CASES.length}`)

// ③-3 규약 E 오인 방지 — 이미지 뒤에 사용자가 `{w=…}`를 **평문으로** 적은 경우.
{
  const blocks = [
    {
      id: 'x',
      type: 'paragraph',
      content: [
        { type: 'inlineImage', url: '/images/x.png', alt: '캡션' },
        { type: 'text', text: '{w=400} 은 평문' },
      ],
    },
  ]
  const md = blocksToMarkdown({ version: 1, blocks })
  const back = markdownToBlocks(md)
  const image = back.blocks[0]?.content?.[0]
  check(
    '[방어] 이미지 뒤 `{w=}` 평문 오인 없음',
    plainOfBlocks(back.blocks) === '![캡션](/images/x.png){w=400} 은 평문' && image?.width === undefined,
    `투영=${JSON.stringify(md)} 재파싱=${stable(stripIds(back.blocks))}`,
  )
}

// ---------------------------------------------------------------- ④ 블록 출발 왕복

console.log('== ④ 블록 출발 왕복: 프로그램 생성 블록 → md → 블록 재변환 ==')
const t = (text, styles) => (styles ? { type: 'text', text, styles } : { type: 'text', text })
const BLOCK_ORIGIN = [
  ['평문 문단', { id: 'x', type: 'paragraph', content: [t('그냥 문단')] }],
  [
    '굵게+기울임 중첩',
    { id: 'x', type: 'paragraph', content: [t('앞 ', { bold: true }), t('안쪽', { bold: true, italic: true }), t(' 뒤', { bold: true })] },
  ],
  [
    '취소선+밑줄',
    { id: 'x', type: 'paragraph', content: [t('취소', { strike: true }), t('밑줄', { underline: true })] },
  ],
  [
    '형광·스포일러',
    { id: 'x', type: 'paragraph', content: [t('형광', { highlight: true }), t(' 과 '), t('가림', { spoiler: true })] },
  ],
  [
    '굵게 안 형광(마이크로는 안쪽)',
    { id: 'x', type: 'paragraph', content: [t('형광', { bold: true, highlight: true })] },
  ],
  [
    ':t 팔레트',
    { id: 'x', type: 'paragraph', content: [t('색', { t: [['c', 'red'], ['bg', 'yellow'], ['s', 'large']] })] },
  ],
  [':t hex', { id: 'x', type: 'paragraph', content: [t('자유색', { t: [['c', '#3366ff']] })] }],
  [
    ':t 화이트리스트 밖 보존',
    { id: 'x', type: 'paragraph', content: [t('보존', { t: [['c', 'rebeccapurple']] })] },
  ],
  [
    ':t 안 굵게',
    { id: 'x', type: 'paragraph', content: [t('굵고 색', { bold: true, t: [['c', 'blue']] })] },
  ],
  [
    '코드·수식 인라인',
    { id: 'x', type: 'paragraph', content: [{ type: 'inlineCode', value: '**x**' }, t(' 와 '), { type: 'inlineMath', value: 'a^2' }] },
  ],
  [
    '링크(제목 포함)',
    { id: 'x', type: 'paragraph', content: [{ type: 'link', url: 'https://example.com', title: '타이틀', children: [t('링크 '), t('굵게', { bold: true })] }] },
  ],
  [
    '참조 칩 추종형',
    { id: 'x', type: 'paragraph', content: [t('앞 '), { type: 'refChip', ref: 'doc', target: 'DOC-0012' }, t(' 뒤')] },
  ],
  [
    '참조 칩 지정 라벨',
    { id: 'x', type: 'paragraph', content: [{ type: 'refChip', ref: 'doc', target: 'DOC-0012', label: '다른 이름' }] },
  ],
  [
    '앵커 칩',
    { id: 'x', type: 'paragraph', content: [{ type: 'refChip', ref: 'anchor', target: '절 제목' }] },
  ],
  [
    // 문단 안 임베드는 remarkStudy가 **블록으로 승격**한다(F43 기존 동작) — 인라인으로 남는 문맥
    // (헤딩·표 셀)에서 인라인 칩 왕복을 확인한다. 문단 승격 경로는 코퍼스 '문단 안 임베드'가 본다.
    '헤딩 안 임베드 칩',
    { id: 'x', type: 'heading', level: 2, content: [t('앞 '), { type: 'refChip', ref: 'embed', target: 'DOC-0007' }, t(' 뒤')] },
  ],
  [
    '줄바꿈 2종',
    { id: 'x', type: 'paragraph', content: [t('첫 줄'), { type: 'hardBreak' }, t('둘째 줄'), { type: 'softBreak' }, t('셋째 줄')] },
  ],
  ['헤딩', { id: 'x', type: 'heading', level: 3, content: [t('제목 '), t('굵게', { bold: true })] }],
  [
    '중첩 목록',
    {
      id: 'x',
      type: 'listItem',
      ordered: false,
      content: [t('상위')],
      children: [{ id: 'y', type: 'listItem', ordered: false, content: [t('하위')] }],
    },
  ],
  [
    '순서 목록 시작 번호',
    { id: 'x', type: 'listItem', ordered: true, start: 3, content: [t('셋')] },
  ],
  ['체크 항목', { id: 'x', type: 'listItem', ordered: false, checked: true, content: [t('완료')] }],
  [
    '인용 다중 블록',
    {
      id: 'x',
      type: 'quote',
      children: [
        { id: 'y', type: 'paragraph', content: [t('첫 문단')] },
        { id: 'z', type: 'paragraph', content: [t('둘째 문단')] },
      ],
    },
  ],
  ['코드 블록', { id: 'x', type: 'codeBlock', language: 'js', code: 'const a = 1' }],
  [
    '표(정렬)',
    {
      id: 'x',
      type: 'table',
      align: ['left', 'center', 'right'],
      rows: [
        [[t('a')], [t('b')], [t('c')]],
        [[t('1', { bold: true })], [{ type: 'inlineCode', value: 'x' }], [t('3')]],
      ],
    },
  ],
  ['블록 수식', { id: 'x', type: 'mathBlock', value: 'a^2 + b^2' }],
  ['이미지(크기)', { id: 'x', type: 'image', url: '/images/x.png', alt: '캡션', width: 400 }],
  ['이미지(제목)', { id: 'x', type: 'image', url: '/images/x.png', alt: '캡션', title: '이미지 제목' }],
  ['구분선', { id: 'x', type: 'divider' }],
  [
    '콜아웃',
    {
      id: 'x',
      type: 'callout',
      variant: 'note',
      title: '제목',
      children: [{ id: 'y', type: 'paragraph', content: [t('내용 '), t('형광', { highlight: true })] }],
    },
  ],
  ['문서 임베드 블록', { id: 'x', type: 'docEmbed', target: 'DOC-0007' }],
  ['문서 임베드 블록(별칭)', { id: 'x', type: 'docEmbed', target: 'DOC-0007', label: '다른 이름' }],
  [
    '원문 보존 fallback',
    { id: 'x', type: 'sourceFallback', markdown: '<div class="x">\n원시 HTML\n</div>', nodeType: 'html' },
  ],
  [
    '이미지 혼재 문단',
    {
      id: 'x',
      type: 'paragraph',
      content: [t('앞 '), { type: 'inlineImage', url: '/images/x.png', alt: '캡션', width: 250 }, t(' 뒤')],
    },
  ],
  // ---- 검토 A1·A5 회귀 표본: **블록에서 출발할 때만** 드러나는 구조 파괴 ----
  // 세 번째 원소 = 기대 정규형(직렬화가 표현 가능한 형태로 수렴시킨 결과).
  [
    '선행 4칸 문단(코드블록 승격 방어)',
    { id: 'x', type: 'paragraph', content: [t('    네 칸 들여쓴 평문')] },
    [{ type: 'paragraph', content: [t('네 칸 들여쓴 평문')] }],
  ],
  [
    '선행 탭 문단',
    { id: 'x', type: 'paragraph', content: [t('\t탭 들여쓴 평문')] },
    [{ type: 'paragraph', content: [t('탭 들여쓴 평문')] }],
  ],
  [
    '선행 2칸 + 후행 공백 문단',
    { id: 'x', type: 'paragraph', content: [t('  앞뒤 공백   ')] },
    [{ type: 'paragraph', content: [t('앞뒤 공백')] }],
  ],
  ['공백만 있는 문단(소멸)', { id: 'x', type: 'paragraph', content: [t('   ')] }, []],
  ['빈 문단(소멸)', { id: 'x', type: 'paragraph', content: [] }, []],
  [
    '문단 끝 hardBreak(백슬래시 유출 방어)',
    { id: 'x', type: 'paragraph', content: [t('끝'), { type: 'hardBreak' }] },
    [{ type: 'paragraph', content: [t('끝')] }],
  ],
  [
    '문단 앞 softBreak',
    { id: 'x', type: 'paragraph', content: [{ type: 'softBreak' }, t('앞')] },
    [{ type: 'paragraph', content: [t('앞')] }],
  ],
  [
    '문단 안 개행 품은 텍스트(헤딩 오인 방어)',
    { id: 'x', type: 'paragraph', content: [t('첫 줄\n# 둘째 줄')] },
    [{ type: 'paragraph', content: [t('첫 줄'), { type: 'softBreak' }, t('# 둘째 줄')] }],
  ],
  [
    '헤딩 안 개행(분열 방어)',
    { id: 'x', type: 'heading', level: 2, content: [t('첫'), { type: 'softBreak' }, t('둘')] },
    [{ type: 'heading', level: 2, content: [t('첫 둘')] }],
  ],
  [
    '표 셀 개행(행 분열 방어)',
    {
      id: 'x',
      type: 'table',
      align: [null],
      rows: [[[t('머리')]], [[t('첫 줄'), { type: 'softBreak' }, t('둘째 줄')]]],
    },
    [{ type: 'table', align: [null], rows: [[[t('머리')]], [[t('첫 줄 둘째 줄')]]] }],
  ],
  [
    '표 셀 hardBreak(백슬래시 유출 방어)',
    {
      id: 'x',
      type: 'table',
      align: [null],
      rows: [[[t('머리')]], [[t('첫 줄'), { type: 'hardBreak' }, t('둘째 줄')]]],
    },
    [{ type: 'table', align: [null], rows: [[[t('머리')]], [[t('첫 줄 둘째 줄')]]] }],
  ],
  [
    '목록 항목 선행 공백',
    { id: 'x', type: 'listItem', ordered: false, content: [t('   항목')] },
    [{ type: 'listItem', ordered: false, content: [t('항목')] }],
  ],
  // ---- 검토 C1 회귀 표본: 유니코드 공백은 **본문 문자**다(가장자리 트림이 지우면 안 된다) ----
  [
    'nbsp 가장자리(문단)',
    { id: 'x', type: 'paragraph', content: [t(' 앞뒤 nbsp ')] },
  ],
  [
    '전각 공백 가장자리(헤딩)',
    { id: 'x', type: 'heading', level: 2, content: [t('　제목　')] },
  ],
  [
    'nbsp 가장자리(표 셀)',
    {
      id: 'x',
      type: 'table',
      align: [null],
      rows: [[[t('머리')]], [[t(' 셀 ')]]],
    },
  ],
  // ---- 검토 C2 회귀 표본: 블록 메타데이터도 표현 가능한 형태로 수렴해야 한다 ----
  [
    '콜아웃 attrs 값에 따옴표·개행',
    {
      id: 'x',
      type: 'callout',
      variant: 'note',
      title: '',
      attrs: [['k', 'a"b\nc']],
      children: [{ id: 'y', type: 'paragraph', content: [t('내용')] }],
    },
    [
      {
        type: 'callout',
        variant: 'note',
        title: '',
        attrs: [['k', 'ab c']],
        children: [{ type: 'paragraph', content: [t('내용')] }],
      },
    ],
  ],
  [
    '콜아웃 variant 빈 값(기본값 수렴)',
    {
      id: 'x',
      type: 'callout',
      variant: '',
      title: '제목',
      children: [{ id: 'y', type: 'paragraph', content: [t('내용')] }],
    },
    [
      {
        type: 'callout',
        variant: 'note',
        title: '제목',
        children: [{ type: 'paragraph', content: [t('내용')] }],
      },
    ],
  ],
  [
    // 비-ASCII 이름은 파서가 받아들이므로 **보존**하고, 표현 불가 문자만 떨어낸다(D1 원칙).
    '콜아웃 variant 도메인 밖 문자만 제거',
    {
      id: 'x',
      type: 'callout',
      variant: '노트!',
      title: '',
      children: [{ id: 'y', type: 'paragraph', content: [t('내용')] }],
    },
    [{ type: 'callout', variant: '노트', title: '', children: [{ type: 'paragraph', content: [t('내용')] }] }],
  ],
  [
    '콜아웃 variant 전부 표현 불가(기본값 수렴)',
    {
      id: 'x',
      type: 'callout',
      variant: '!!!',
      title: '',
      children: [{ id: 'y', type: 'paragraph', content: [t('내용')] }],
    },
    [{ type: 'callout', variant: 'note', title: '', children: [{ type: 'paragraph', content: [t('내용')] }] }],
  ],
  // ---- 검토 D1·D2 회귀 표본: 속성 키 보존 · 빈 `{}` 금지 · 라벨/info 내부 공백 ----
  [
    '콜아웃 비-ASCII 속성 키 보존',
    {
      id: 'x',
      type: 'callout',
      variant: 'note',
      title: '',
      attrs: [['키', '값']],
      children: [{ id: 'y', type: 'paragraph', content: [t('내용')] }],
    },
  ],
  [
    '콜아웃 표현 불가 키만 제거',
    {
      id: 'x',
      type: 'callout',
      variant: 'note',
      title: '',
      attrs: [['k#1', 'a'], ['키', '값']],
      children: [{ id: 'y', type: 'paragraph', content: [t('내용')] }],
    },
    [
      {
        type: 'callout',
        variant: 'note',
        title: '',
        attrs: [['키', '값']],
        children: [{ type: 'paragraph', content: [t('내용')] }],
      },
    ],
  ],
  [
    '콜아웃 속성 전부 표현 불가 → 빈 `{}` 방출 금지',
    {
      id: 'x',
      type: 'callout',
      variant: 'note',
      title: '',
      attrs: [['k#1', 'a']],
      children: [{ id: 'y', type: 'paragraph', content: [t('내용')] }],
    },
    [{ type: 'callout', variant: 'note', title: '', children: [{ type: 'paragraph', content: [t('내용')] }] }],
  ],
  [':t 비-ASCII 속성 키 보존', { id: 'x', type: 'paragraph', content: [t('값', { t: [['키', '값']] })] }],
  [
    ':t 속성 전부 표현 불가 → 래퍼 자체 생략',
    { id: 'x', type: 'paragraph', content: [t('값', { t: [['k#1', 'a']] })] },
    [{ type: 'paragraph', content: [t('값')] }],
  ],
  [
    ':t 속성 값 인용·백슬래시 보존',
    { id: 'x', type: 'paragraph', content: [t('값', { t: [['a', '공백 있음'], ['b', '등호=포함'], ['c', 'a\\b']] })] },
  ],
  [
    '콜아웃 제목 내부 연속 공백 보존',
    {
      id: 'x',
      type: 'callout',
      variant: 'note',
      title: '제목  두칸',
      children: [{ id: 'y', type: 'paragraph', content: [t('내용')] }],
    },
  ],
  [
    '코드 블록 info 내부 연속 공백 보존',
    { id: 'x', type: 'codeBlock', language: 'js', info: 'a  b', code: 'x' },
  ],
  [
    '코드 블록 info 개행',
    { id: 'x', type: 'codeBlock', language: 'js', info: 'a\nb', code: 'const a = 1' },
    [{ type: 'codeBlock', language: 'js', info: 'a b', code: 'const a = 1' }],
  ],
  [
    '코드 블록 language 안 백틱',
    { id: 'x', type: 'codeBlock', language: 'j`s', code: 'x' },
    [{ type: 'codeBlock', language: 'js', code: 'x' }],
  ],
  [
    '콜아웃 제목 개행',
    {
      id: 'x',
      type: 'callout',
      variant: 'note',
      title: '첫 줄\n둘째 줄',
      children: [{ id: 'y', type: 'paragraph', content: [t('내용')] }],
    },
    [
      {
        type: 'callout',
        variant: 'note',
        title: '첫 줄 둘째 줄',
        children: [{ type: 'paragraph', content: [t('내용')] }],
      },
    ],
  ],
  // ---- 검토 A3 회귀 표본: 인접 목록 그룹 경계 ----
  [
    '인접 불릿 목록 경계',
    [
      { id: 'x', type: 'listItem', ordered: false, content: [t('하나')] },
      { id: 'y', type: 'listItem', ordered: false, groupBreak: true, content: [t('둘')] },
    ],
  ],
  [
    '인접 순서 목록 경계(시작 번호 유지)',
    [
      { id: 'x', type: 'listItem', ordered: true, content: [t('하나')] },
      { id: 'y', type: 'listItem', ordered: true, groupBreak: true, start: 5, content: [t('다섯')] },
    ],
  ],
  [
    '인접 목록 3연속 경계',
    [
      { id: 'x', type: 'listItem', ordered: false, content: [t('하나')] },
      { id: 'y', type: 'listItem', ordered: false, groupBreak: true, content: [t('둘')] },
      { id: 'z', type: 'listItem', ordered: false, groupBreak: true, content: [t('셋')] },
    ],
  ],
]
let originPass = 0
for (const [label, blockOrList, expected] of BLOCK_ORIGIN) {
  const blocks = Array.isArray(blockOrList) ? blockOrList : [blockOrList]
  const md = blocksToMarkdown({ version: 1, blocks })
  const back = markdownToBlocks(md)
  // 기대값이 따로 없으면 "입력 블록 그대로"가 계약이다. 있으면 직렬화가 수렴시킨 정규형이다
  // (표현 불가능한 가장자리 공백·줄바꿈이 정규화되는 A1·A5 회귀 표본).
  const want = stable(stripIds(expected ?? blocks))
  const got = stable(stripIds(back.blocks))
  const ok = want === got
  if (ok) originPass += 1
  check(`[블록출발] ${label}`, ok, ok ? '' : `md=${JSON.stringify(md)} 기대=${want} 실제=${got}`)
}
// 결합 문서(블록 여러 개가 이어졌을 때의 구분자·번호 매김) — 정규형 블록만 모은다.
{
  const blocks = BLOCK_ORIGIN.flatMap(([, blockOrList, expected], i) => {
    const list = expected ?? (Array.isArray(blockOrList) ? blockOrList : [blockOrList])
    return list.map((block, k) => ({ ...block, id: `x${i}_${k}` }))
  })
  const doc = { version: 1, blocks }
  const md = blocksToMarkdown(doc)
  const back = markdownToBlocks(md)
  check(
    '[블록출발] 전 블록 결합 문서',
    stable(stripIds(doc.blocks)) === stable(stripIds(back.blocks)),
    `md=${JSON.stringify(md).slice(0, 600)}`,
  )
  const md2 = blocksToMarkdown(back)
  check('[블록출발] 결합 문서 고정점', md === md2)
}
console.log(`  블록 출발 왕복: ${originPass}/${BLOCK_ORIGIN.length}`)

// ---------------------------------------------------------------- ⑥ 규약 C — 참조 칩 라벨 문자 도메인

// 칩 라벨은 `[[DOC-0012|라벨]]`의 `[^\]|\n]+` 안에 실리고, 그 전에 **remark-parse가 먼저** 그 줄을
// 훑는다. 그래서 인라인 문법을 여는 문자가 라벨에 있으면 칩이 붕괴하거나 아예 사라진다.
// §5.4 ②-(a)(선택 텍스트를 라벨로 승계)는 사용자가 고른 임의 텍스트를 라벨로 삼는 안이므로
// **M33 UX가 이 도메인 밖 문자를 걸러야 한다**. 아래는 그 도메인을 기계로 고정해 둔 것이다.
console.log('== ⑥ 규약 C: 참조 칩 라벨 문자 도메인(§5.4 ②-(a) 입력 제약) ==')
const LABEL_OK = [
  ['한글·공백', '다른 이름'],
  ['영문·숫자·하이픈', 'Chapter 3 - 요약'],
  ['소괄호', '괄호(소) 포함'],
  ['구두점', '쉼표, 마침표. 물음표?'],
  ['단어 내부 밑줄', 'snake_case'],
  ['해시', '# 해시'],
]
const LABEL_FORBIDDEN = [
  ['닫는 대괄호', '괄호 [안]'],
  ['파이프', '파이프 a|b'],
  ['별표', '별표 *강조*'],
  ['백틱', '백틱 `코드`'],
  ['틸드', '~물결~'],
  ['달러(수식)', '$수식$'],
  ['directive 모양', ':t[색]{c=red}'],
  ['개행', '첫 줄\n둘째 줄'],
  ['가장자리 공백', '  공백  '],
]
const chipRoundTrips = (label) => {
  const doc = {
    version: 1,
    blocks: [{ id: 'x', type: 'paragraph', content: [{ type: 'refChip', ref: 'doc', target: 'DOC-0012', label }] }],
  }
  const back = markdownToBlocks(blocksToMarkdown(doc))
  return stable(stripIds(doc.blocks)) === stable(stripIds(back.blocks))
}
let labelOkPass = 0
for (const [name, label] of LABEL_OK) {
  const ok = chipRoundTrips(label)
  if (ok) labelOkPass += 1
  check(`[라벨 도메인] 허용 — ${name}`, ok, `라벨=${JSON.stringify(label)} 왕복 실패`)
}
let labelForbidPass = 0
for (const [name, label] of LABEL_FORBIDDEN) {
  // 알려진 제약을 **고정**한다 — 방언이 바뀌어 왕복이 되기 시작하면 이 검사가 알려 준다.
  const ok = !chipRoundTrips(label)
  if (ok) labelForbidPass += 1
  check(`[라벨 도메인] 금지(고정) — ${name}`, ok, `라벨=${JSON.stringify(label)}가 왕복해 버렸다(제약 변경?)`)
}
console.log(`  허용 도메인 왕복: ${labelOkPass}/${LABEL_OK.length} · 금지 문자 고정: ${labelForbidPass}/${LABEL_FORBIDDEN.length}`)

// ---------------------------------------------------------------- ⑥-b 도메인 단일 출처(stage-34 G-5)
//
// 위 표는 **관측된 사실**(어떤 라벨이 왕복하는가)이고, `schema/refDomain.ts`는 앱이 입력 시점에
// 쓰는 **판정 함수**다. 둘이 갈라지면 UI가 통과시킨 라벨이 본문에서 깨진다 — 여기서 못 박는다.
//
//   계약: **`isSafeRefText(s) === true`이면 그 문자열은 반드시 방언 Markdown 왕복을 통과한다.**
//   (역은 성립하지 않아도 된다 — 함수는 보수적인 부분집합이다.)
console.log('== ⑥-b 규약 C: refDomain.ts가 라벨 도메인의 단일 출처인가 ==')
for (const [name, label] of LABEL_OK) {
  check(`[도메인함수] 허용 판정 — ${name}`, isSafeRefText(label) === true, `isSafeRefText(${JSON.stringify(label)}) = false`)
}
for (const [name, label] of LABEL_FORBIDDEN) {
  check(`[도메인함수] 거절 판정 — ${name}`, isSafeRefText(label) === false, `isSafeRefText(${JSON.stringify(label)}) = true`)
  check(`[도메인함수] 거절 사유 문구 — ${name}`, typeof refTextRejection(label) === 'string' && refTextRejection(label).length > 0)
}
// 계약의 기계 고정 — 통과시킨 것은 **반드시** 왕복한다(표 밖 문자까지 훑는다).
const DOMAIN_SWEEP = []
for (const ch of [
  ...'!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~',
  ' ',
  '\t',
  '\n',
  '가',
  'é',
  '😀',
  '·',
  '—',
  ' ',
  '　',
]) {
  DOMAIN_SWEEP.push(`앞${ch}뒤`, `${ch}시작`, `끝${ch}`)
}
let sweepSafe = 0
let sweepViolation = 0
for (const label of DOMAIN_SWEEP) {
  if (!isSafeRefText(label)) continue
  sweepSafe += 1
  if (!chipRoundTrips(label)) {
    sweepViolation += 1
    check(`[도메인계약] 통과시킨 라벨이 왕복하지 않는다 — ${JSON.stringify(label)}`, false)
  }
}
check(
  `[도메인계약] isSafeRefText 통과 = 왕복 성립 (${sweepSafe}종 표본)`,
  sweepViolation === 0,
  `위반 ${sweepViolation}종`,
)
// target 도메인 — 피커가 고른 값만 실리는 자리(자유 입력 경로 없음).
check('[도메인함수] 문서 번호 형식', isDocNo('DOC-0012') && isDocNo('DOC-12345') && !isDocNo('DOC-12') && !isDocNo('doc-0012'))
check('[도메인함수] 앵커 대상은 `#`으로 시작하지 않는다', isSafeAnchorTarget('절 제목') && !isSafeAnchorTarget('#절 제목'))
check('[도메인함수] 정규화 = 가장자리 공백 트림뿐', normalizeRefText('  가운데  공백  ') === '가운데  공백')
console.log(`  도메인 함수 판정 일치: ${LABEL_OK.length + LABEL_FORBIDDEN.length}종 · 계약 스윕 통과 표본 ${sweepSafe}종`)

// ---------------------------------------------------------------- 결과

console.log('')
console.log(`총 ${pass + fail}건 · 통과 ${pass} · 실패 ${fail}`)
if (fail) {
  console.log('실패 목록:')
  for (const line of failures) console.log(`  - ${line}`)
  process.exit(1)
}
