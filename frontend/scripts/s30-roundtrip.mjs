// S30(F56) 인라인 모델·직렬화 코어 기계 검증 — stage-30 A-5 + A-0 렌더 diff 0.
//
// 실행: node frontend/scripts/s30-roundtrip.mjs
//   (프론트 유틸이라 pytest 대상이 아니다 — 불변 규칙 7의 "실행 스모크"에 해당한다.)
//
// 검증 3종:
//   ① A-5 왕복    : 표본 블록마다 "파싱 → 무편집 → 직렬화 = 원본 1바이트 동일"
//   ② A-4 안전밸브: 모든 노드를 dirty로 강제해 정규 표기 표를 태운 뒤 재파싱 동형성이 유지되는가
//   ③ A-0 렌더 diff: git HEAD의 remarkStudy(변경 전)와 현재본으로 각각 hast를 만들어
//                    position 필드를 제거하고 완전 일치하는지(= 렌더 결과 diff 0)
//   ④ B-1 판정 술어: 리치 대상/비대상 표본
//
// TS 모듈은 jiti(vite가 이미 끌고 오는 의존 — 신규 설치 0)로 그대로 불러온다.
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
// 표본은 stage-32에서 `roundtrip-corpus.mjs`로 공용화했다(4-1). 이 스크립트가 쓰는 SAMPLES·
// HAZARDS의 **내용·순서는 추출 전과 동일**하다 — 총 검사 수 365가 이 스크립트의 고정 계약이다.
import { SAMPLES, HAZARDS } from './roundtrip-corpus.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FRONT = path.resolve(HERE, '..')
const ROOT = path.resolve(FRONT, '..')
const MD_DIR = path.join(FRONT, 'src/components/markdown')

const require = createRequire(path.join(FRONT, 'package.json'))
const jiti = require('jiti')(path.join(FRONT, 'scripts/_loader.cjs'), {
  interopDefault: true,
  esmResolve: true,
  cache: false,
  requireCache: false,
})

const { buildInlineModel, isRichEditableBlock, markSubtreeDirty } = jiti(path.join(MD_DIR, 'inlineModel.ts'))
const { serializeBlock, isRoundTripSafe } = jiti(path.join(MD_DIR, 'inlineSerialize.ts'))

// ---------------------------------------------------------------- 표본
//
// (SAMPLES·HAZARDS는 `roundtrip-corpus.mjs`에서 가져온다 — 위 import 참조.)

// B-1 기대값 — 설계 S30 ⓐ(최상위 paragraph·heading·list·blockquote + 배제 노드 0)
const PREDICATE_EXPECT = new Map([
  ['평문', true],
  ['중첩 굵게+기울임', true],
  [':t 다중', true],
  ['코드스팬 혼재', true],
  ['인라인 수식', true],
  ['마이크로 3종 혼재', true],
  ['링크 칩', true],
  ['앵커 칩', true],
  ['헤딩', true],
  ['불릿 목록', true],
  ['순서 목록', true],
  ['중첩 목록', true],
  ['인용', true],
  ['인용 안 목록', true],
  ['코드 펜스', false],
  ['표', false],
  ['이미지', false],
  ['이미지 혼재 문단', false],
  ['콜아웃', false],
  ['블록 수식', false],
  ['문단 안 임베드', false], // 임베드는 문단 밖 블록(div)으로 끌어올려진다 → 최상위 자식 조건 탈락
])

// ---------------------------------------------------------------- ① A-5 왕복

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

console.log('== ① A-5 왕복: 파싱 → 무편집 → 직렬화 = 원본 동일 ==')
let rtPass = 0
for (const [label, src] of SAMPLES) {
  const model = buildInlineModel(src)
  const out = serializeBlock(model)
  const ok = out === src
  if (ok) rtPass += 1
  check(`[왕복] ${label}`, ok, ok ? '' : `기대=${JSON.stringify(src)} 실제=${JSON.stringify(out)}`)
}
console.log(`  왕복 동일: ${rtPass}/${SAMPLES.length}`)

// ---------------------------------------------------------------- ② A-4 안전 밸브

console.log('== ② A-4 전면 dirty 강제 → 정규 표기 직렬화 → 재파싱 동형성 ==')
let dirtyPass = 0
let dirtyTotal = 0
for (const [label, src] of SAMPLES) {
  const model = buildInlineModel(src)
  if (!model.rich) continue // 리치 대상 아닌 블록은 표면에 올라가지 않는다
  dirtyTotal += 1
  for (const container of model.containers) container.children.forEach(markSubtreeDirty)
  const out = serializeBlock(model)
  const safe = isRoundTripSafe(model, out)
  if (safe) dirtyPass += 1
  check(`[정규화 동형] ${label}`, safe, safe ? '' : `직렬화=${JSON.stringify(out)}`)
}
console.log(`  전면 정규화 후 동형: ${dirtyPass}/${dirtyTotal}`)

// 안전 밸브가 **거짓을 걸러내는지** — 일부러 문법이 되는 텍스트를 심는다.
console.log('== ②-2 A-4 이스케이프 방어: 사용자가 문법 문자를 그냥 입력한 경우 ==')
// 계약상 통과 조건은 둘 중 하나다(설계 S30 ⓑ 3층):
//   (a) 이스케이프가 먹혀 **평문 그대로** 다시 읽힌다,
//   (b) 그러지 못하면 **동형성 검사가 거짓**을 내 편집이 적용되지 않는다(소스 편집 폴백).
// 어느 쪽도 아닌 경우 = 조용한 본문 변형 → 결함.
let hazardPass = 0
const hazardMode = []
for (const [label, src, typed] of HAZARDS) {
  const model = buildInlineModel(src)
  const leaf = model.containers[0].children[0]
  leaf.text = typed
  leaf.dirty = true
  const out = serializeBlock(model)
  const reparsed = buildInlineModel(out)
  const plain = reparsed.containers
    .flatMap((c) => c.children)
    .map((n) => (n.kind === 'text' ? n.text : `<${n.kind}>`))
    .join('')
  const escaped = plain === typed
  const safe = isRoundTripSafe(model, out)
  const ok = escaped ? safe : !safe
  if (ok) hazardPass += 1
  hazardMode.push(`${label}=${escaped ? '이스케이프' : '폴백'}`)
  check(
    `[방어] ${label}`,
    ok,
    ok ? '' : `직렬화=${JSON.stringify(out)} 재파싱평문=${JSON.stringify(plain)} safe=${safe}`,
  )
}
console.log(`  조용한 변형 0: ${hazardPass}/${HAZARDS.length}  (${hazardMode.join(' · ')})`)

// ---------------------------------------------------------------- ②-4 이스케이프 과잉 방지

// 검토 지적(중요-2): `_`를 무조건 이스케이프하면 URL·식별자가 `b\_c`로 더럽혀지고, 3층 검사가
// 거짓을 내 소스 편집으로 폴백할 때 **그 더럽혀진 초안이 사용자에게 남는다**. CommonMark에서
// 단어 내부 `_`는 강조가 될 수 없으므로 이스케이프하지 않는 것이 옳다.
console.log('== ②-4 이스케이프 과잉 방지(`_` 문맥 감응) ==')
const ESCAPE_CASES = [
  // [라벨, 입력 텍스트, 기대 직렬화]
  ['URL 안 언더스코어', 'http://a.com/b_c', 'http://a.com/b_c'],
  ['식별자', 'snake_case_name 와 A_1', 'snake_case_name 와 A_1'],
  ['한글 사이', '가_나', '가_나'],
  ['이중 언더스코어 단어 내부', 'foo__bar__baz', 'foo__bar__baz'],
  ['강조가 될 수 있는 형태', '_강조_ 시도', '\\_강조\\_ 시도'],
  ['앞이 공백', 'a _b', 'a \\_b'],
  ['문자열 경계', '_시작과 끝_', '\\_시작과 끝\\_'],
  ['구두점 옆', '(_a_)', '(\\_a\\_)'],
  // 회귀 확인 — 기존 이스케이프는 그대로여야 한다.
  ['별표 회귀', 'a * b * c', 'a \\* b \\* c'],
  ['참조 회귀', '[[DOC-0001]] 처럼', '\\[\\[DOC-0001\\]\\] 처럼'],
  ['백틱 회귀', '`코드`', '\\`코드\\`'],
  ['마이크로 회귀', 'a==b==c', 'a\\==b\\==c'],
]
let escPass = 0
for (const [label, typed, expected] of ESCAPE_CASES) {
  const model = buildInlineModel('평문 문장')
  const leaf = model.containers[0].children[0]
  leaf.text = typed
  leaf.dirty = true
  const out = serializeBlock(model)
  const ok = out === expected
  if (ok) escPass += 1
  check(`[이스케이프] ${label}`, ok, ok ? '' : `기대=${JSON.stringify(expected)} 실제=${JSON.stringify(out)}`)
}
// 지적된 케이스는 "백슬래시 0"이 계약이다.
{
  const model = buildInlineModel('평문 문장')
  const leaf = model.containers[0].children[0]
  leaf.text = 'http://a.com/b_c'
  leaf.dirty = true
  const out = serializeBlock(model)
  check(`[이스케이프] URL 백슬래시 0`, !out.includes('\\'), `직렬화=${JSON.stringify(out)}`)
}
console.log(`  이스케이프 문맥 정확: ${escPass}/${ESCAPE_CASES.length}`)

// ---------------------------------------------------------------- ②-3 2층 계약(부분 dirty)

console.log('== ②-3 2층 계약: dirty 노드만 정규 표기, 나머지는 원본 슬라이스 그대로 ==')
const LAYER2 = [
  // [라벨, 원본, 편집할 리프 인덱스, 새 텍스트, 기대 결과]
  [
    '__굵게__ 비정규 표기 보존',
    '앞 __굵게__ 뒤',
    0,
    '앞2 ',
    '앞2 __굵게__ 뒤',
  ],
  [
    '이스케이프 보존',
    '리터럴 \\*별표\\* 와 평문',
    0,
    '바뀐 텍스트',
    '바뀐 텍스트',
  ],
  [
    '원자 노드(코드스팬) 불변',
    '앞 `code **x**` 뒤',
    0,
    '새앞 ',
    '새앞 `code **x**` 뒤',
  ],
  [
    '원자 노드(참조) 불변',
    '앞 [[DOC-0012|별칭]] 뒤',
    0,
    '새앞 ',
    '새앞 [[DOC-0012|별칭]] 뒤',
  ],
  [
    ':t 화이트리스트 밖 값 보존',
    '앞 :t[색]{c=rebeccapurple} 뒤',
    0,
    '새앞 ',
    '새앞 :t[색]{c=rebeccapurple} 뒤',
  ],
  [
    '인용 접두 보존',
    '> 인용 **굵게** 끝',
    0,
    '바뀐 ',
    '> 바뀐 **굵게** 끝',
  ],
  [
    '목록 마커 보존',
    '* 항목 **굵게**',
    0,
    '새 항목 ',
    '* 새 항목 **굵게**',
  ],
  [
    '헤딩 접두 보존',
    '### 제목 **굵게**',
    0,
    '새 제목 ',
    '### 새 제목 **굵게**',
  ],
]
let layer2Pass = 0
for (const [label, src, leafIdx, newText, expected] of LAYER2) {
  const model = buildInlineModel(src)
  const leaf = model.containers[0].children[leafIdx]
  leaf.text = newText
  leaf.dirty = true
  const out = serializeBlock(model)
  const ok = out === expected
  if (ok) layer2Pass += 1
  check(`[2층] ${label}`, ok, ok ? '' : `기대=${JSON.stringify(expected)} 실제=${JSON.stringify(out)}`)
}
console.log(`  부분 편집 정확: ${layer2Pass}/${LAYER2.length}`)

// ---------------------------------------------------------------- ④ B-1 판정 술어

console.log('== ④ B-1 리치 대상 판정 술어 ==')
let predPass = 0
for (const [label, src] of SAMPLES) {
  if (!PREDICATE_EXPECT.has(label)) continue
  const expected = PREDICATE_EXPECT.get(label)
  const actual = isRichEditableBlock(src)
  const ok = actual === expected
  if (ok) predPass += 1
  check(`[판정] ${label}`, ok, ok ? '' : `기대=${expected} 실제=${actual}`)
}
console.log(`  판정 일치: ${predPass}/${PREDICATE_EXPECT.size}`)

// ---------------------------------------------------------------- ③ A-0 렌더 diff 0

console.log('== ③ A-0 position 전파 전/후 hast 완전 일치(렌더 diff 0) ==')

const BASELINE_PATH = path.join(MD_DIR, '__baseline_remarkStudy.gen.ts')
let renderPass = 0
let renderTotal = 0

function stripPosition(node) {
  if (Array.isArray(node)) return node.map(stripPosition)
  if (node && typeof node === 'object') {
    const out = {}
    for (const key of Object.keys(node).sort()) {
      if (key === 'position') continue
      out[key] = stripPosition(node[key])
    }
    return out
  }
  return node
}

// A-0 기준선 ref — **S30 착수 전 커밋**이어야 한다. `HEAD`로 두면 구현을 커밋한 뒤에는
// "자기 자신과의 비교"가 되어 ③ 렌더 diff 검사가 공허해지고 A-0 전파 검사(변경 전 결손 > 0)가
// 거짓 실패로 뒤집힌다. 검토 반려 결함 7 — 기본값이 `main`이었는데, S30의 A-0 커밋(`86d171d`)이
// main에 병합된 뒤로는 `main`이 더 이상 "착수 전"이 아니라서 같은 자기비교 함정에 빠져
// `[A-0] 합성 노드 position 전무`가 거짓 실패한다. `86d171d~1`(그 직전 커밋, stage-29)로 고정한다
// — 필요하면 여전히 첫 인자로 다른 ref를 줄 수 있다.
const BASELINE_REF = process.argv[2] || '86d171d~1'

try {
  const baselineSource = execFileSync(
    'git',
    ['show', `${BASELINE_REF}:frontend/src/components/markdown/remarkStudy.ts`],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
  )
  fs.writeFileSync(BASELINE_PATH, baselineSource, 'utf8')
  console.log(`  (A-0 기준선 ref = ${BASELINE_REF})`)

  const { unified } = jiti('unified')
  const remarkParse = jiti('remark-parse')
  const remarkGfm = jiti('remark-gfm')
  const remarkMath = jiti('remark-math')
  const remarkBreaks = jiti('remark-breaks')
  const remarkDirective = jiti('remark-directive')
  const remarkRehype = jiti('remark-rehype')
  const current = jiti(path.join(MD_DIR, 'remarkStudy.ts'))
  const baseline = jiti(BASELINE_PATH)

  const makeHast = (mod, src, { breaks, inlineFormat }) => {
    const plugins = [
      remarkGfm,
      remarkMath,
      remarkDirective,
      [mod.remarkStudyDirectives, { inlineFormat }],
      [mod.remarkStudyRefs, { inlineFormat }],
    ]
    if (breaks) plugins.push(remarkBreaks)
    plugins.push([remarkRehype, { allowDangerousHtml: false }])
    const proc = unified().use(remarkParse).use(plugins)
    return proc.runSync(proc.parse(src), src)
  }

  // C-3ⓐ(자유 hex)는 **의도된 신규 렌더 동작**이라 diff 0 대상에서 뺀다(아래 ⑤에서 별도 검증).
  const HEX_LABELS = new Set([':t hex'])
  const DIFF0_SAMPLES = SAMPLES.filter(([label]) => !HEX_LABELS.has(label))
  // 대표 입력 = 표본 전체 + 마이크로/참조가 진하게 섞인 문서 전체 형태.
  const DOC = DIFF0_SAMPLES.map(([, src]) => src).join('\n\n')
  const RENDER_INPUTS = [...DIFF0_SAMPLES, ['문서 전체 결합', DOC]]

  for (const [label, src] of RENDER_INPUTS) {
    for (const breaks of [true, false]) {
      for (const inlineFormat of [true, false]) {
        renderTotal += 1
        const a = JSON.stringify(stripPosition(makeHast(baseline, src, { breaks, inlineFormat })))
        const b = JSON.stringify(stripPosition(makeHast(current, src, { breaks, inlineFormat })))
        const ok = a === b
        if (ok) renderPass += 1
        check(
          `[렌더 diff] ${label} (breaks=${breaks}, inlineFormat=${inlineFormat})`,
          ok,
          ok ? '' : 'hast 불일치',
        )
      }
    }
  }
  console.log(`  hast 동일(조합 4종 × 입력 ${RENDER_INPUTS.length}): ${renderPass}/${renderTotal}`)

  // A-0이 실제로 position을 붙였는지(전파가 동작함) 확인 — 붙지 않았다면 검증 자체가 무의미하다.
  const posProbe = (mod) => {
    const plugins = [
      remarkGfm,
      remarkMath,
      remarkDirective,
      [mod.remarkStudyDirectives, { inlineFormat: true }],
      [mod.remarkStudyRefs, { inlineFormat: true }],
    ]
    const proc = unified().use(remarkParse).use(plugins)
    const src = '앞 ++밑줄++ 과 [[DOC-0001]] 과 ==형광== 끝'
    const tree = proc.runSync(proc.parse(src), src)
    return tree.children[0].children.map((c) => [c.type, c.position?.start?.offset ?? null, c.position?.end?.offset ?? null])
  }
  const before = posProbe(baseline)
  const after = posProbe(current)
  const beforeMissing = before.filter(([, s]) => s === null).length
  const afterMissing = after.filter(([, s]) => s === null).length
  console.log(`  position 결손 노드: 변경 전 ${beforeMissing}개 → 변경 후 ${afterMissing}개`)
  check('[A-0] 합성 노드 position 전무 → 전부 부여', beforeMissing > 0 && afterMissing === 0)
  // 오프셋이 실제 소스와 맞는지(슬라이스 = 원문)까지 확인.
  const probeSrc = '앞 ++밑줄++ 과 [[DOC-0001]] 과 ==형광== 끝'
  const slices = after.filter(([, s]) => s !== null).map(([, s, e]) => probeSrc.slice(s, e))
  check(
    '[A-0] 오프셋 슬라이스 = 원문 재구성',
    slices.join('') === probeSrc,
    `재구성=${JSON.stringify(slices.join(''))}`,
  )
  // 이스케이프가 섞인 텍스트 노드에서도 오프셋이 어긋나지 않는가.
  const escSrc = '\\*리터럴\\* ++밑줄++ 끝'
  const escProc = unified()
    .use(remarkParse)
    .use([
      remarkGfm,
      remarkMath,
      remarkDirective,
      [current.remarkStudyDirectives, { inlineFormat: true }],
      [current.remarkStudyRefs, { inlineFormat: true }],
    ])
  const escTree = escProc.runSync(escProc.parse(escSrc), escSrc)
  const escSlices = escTree.children[0].children.map((c) =>
    escSrc.slice(c.position.start.offset, c.position.end.offset),
  )
  check('[A-0] 이스케이프 보정 오프셋', escSlices.join('') === escSrc, `재구성=${JSON.stringify(escSlices.join(''))}`)

  // -------------------------------------------------------------- ⑤ C-3ⓐ hex 화이트리스트
  console.log('== ⑤ C-3ⓐ `:t` 색 값 화이트리스트(팔레트 ∪ #rrggbb) ==')
  const directiveProps = (src) => {
    const proc = unified()
      .use(remarkParse)
      .use([remarkGfm, remarkMath, remarkDirective, [current.remarkStudyDirectives, { inlineFormat: true }]])
    const tree = proc.runSync(proc.parse(src), src)
    const node = tree.children[0].children.find((c) => c.type === 'textDirective')
    return (node && node.data && node.data.hProperties) || {}
  }
  const HEX_CASES = [
    ['hex 글자색', ':t[x]{c=#3366ff}', { style: '--u-ink:#3366ff', className: ['u-ink'] }],
    ['hex 바탕색', ':t[x]{bg=#ffee88}', { style: '--u-bg:#ffee88', className: ['u-mark'] }],
    [
      'hex 양쪽',
      ':t[x]{c=#3366ff bg=#ffee88}',
      { style: '--u-ink:#3366ff;--u-bg:#ffee88', className: ['u-ink', 'u-mark'] },
    ],
    ['대문자 hex', ':t[x]{c=#AABBCC}', { style: '--u-ink:#AABBCC', className: ['u-ink'] }],
    ['팔레트(무변경)', ':t[x]{c=red}', { 'data-ink': 'red' }],
    ['3자리 축약 불허', ':t[x]{c=#abc}', {}],
    ['rgb() 불허', ':t[x]{c=rgb(1,2,3)}', {}],
    ['색 이름 불허', ':t[x]{c=rebeccapurple}', {}],
    ['8자리 불허', ':t[x]{c=#aabbccdd}', {}],
  ]
  let hexPass = 0
  for (const [label, src, expected] of HEX_CASES) {
    const props = directiveProps(src)
    const picked = {}
    for (const key of ['style', 'className', 'data-ink', 'data-mark', 'data-size']) {
      if (props[key] !== undefined) picked[key] = props[key]
    }
    const ok = JSON.stringify(picked) === JSON.stringify(expected)
    if (ok) hexPass += 1
    check(`[hex] ${label}`, ok, ok ? '' : `기대=${JSON.stringify(expected)} 실제=${JSON.stringify(picked)}`)
  }
  console.log(`  화이트리스트 방출 일치: ${hexPass}/${HEX_CASES.length}`)

  // 팔레트만 쓰는 기존 본문은 변경 전/후 hProperties가 완전히 같아야 한다(렌더 diff 0 재확인).
  const baselineProps = (src) => {
    const proc = unified()
      .use(remarkParse)
      .use([remarkGfm, remarkMath, remarkDirective, [baseline.remarkStudyDirectives, { inlineFormat: true }]])
    const tree = proc.runSync(proc.parse(src), src)
    const node = tree.children[0].children.find((c) => c.type === 'textDirective')
    return (node && node.data && node.data.hProperties) || {}
  }
  for (const src of [':t[x]{c=red}', ':t[x]{bg=yellow s=large}', ':t[x]{c=rebeccapurple}', ':t[x]{c=#abc}']) {
    check(
      `[hex] 팔레트/불허 값 hProperties 무변경 ${src}`,
      JSON.stringify(baselineProps(src)) === JSON.stringify(directiveProps(src)),
    )
  }
} finally {
  if (fs.existsSync(BASELINE_PATH)) fs.rmSync(BASELINE_PATH)
}

// ---------------------------------------------------------------- 결과

console.log('')
console.log(`총 ${pass + fail}건 · 통과 ${pass} · 실패 ${fail}`)
if (fail) {
  console.log('실패 목록:')
  for (const line of failures) console.log(`  - ${line}`)
  process.exit(1)
}
