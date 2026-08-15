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

// A-5가 요구하는 표본 계열: 중첩 서식 · 이스케이프 · `:t` 속성 다중 · 링크/코드스팬 혼재 ·
// 마이크로 3종 · 목록/인용 블록 · 문단 안 임베드 참조.
const SAMPLES = [
  // 평문·기본
  ['평문', '그냥 한 줄짜리 문단입니다.'],
  ['빈칸 포함 평문', '앞뒤   공백과  여러 칸이 섞인 문장.'],
  // 중첩 서식
  ['중첩 굵게+기울임', '**굵게 안의 *기울임* 이어서** 끝'],
  ['중첩 3중', '**a *b ~~c~~ d* e**'],
  ['비정규 표기 보존', '__언더바 굵게__ 와 _언더바 기울임_ 은 그대로'],
  ['취소선', '~~취소된 문장~~ 뒤에 평문'],
  // 이스케이프
  ['이스케이프 별표', '리터럴 \\*별표\\* 와 \\_언더바\\_'],
  ['이스케이프 마이크로', '\\+\\+밑줄아님\\+\\+ 과 \\=\\=형광아님\\=\\='],
  ['이스케이프 뒤 정상쌍', '\\+\\+a++b++'],
  ['이스케이프 대괄호', '\\[대괄호\\] 와 \\`백틱\\`'],
  // :t 속성
  [':t 단일', ':t[빨간 글자]{c=red} 뒤 평문'],
  [':t 다중', ':t[빨강 노랑 크게]{c=red bg=yellow s=large}'],
  [':t hex', ':t[자유색]{c=#3366ff bg=#ffee88}'],
  [':t 화이트리스트 밖', ':t[무시되는 색]{c=rebeccapurple}'],
  [':t 중첩 원본', ':t[:t[안쪽]{c=red}]{bg=yellow}'],
  // 링크·코드스팬·수식
  ['링크', '앞 [링크 텍스트](https://example.com/a_b) 뒤'],
  ['링크 제목', '[제목 달린](https://example.com "타이틀") 링크'],
  ['코드스팬 혼재', '문장 안 `코드 스팬` 과 **굵게** 혼재'],
  ['코드스팬 안 문법', '`**굵지 않음**` 과 `[[DOC-0001]]`'],
  ['인라인 수식', '수식 $a^2 + b^2$ 이 있는 문단'],
  ['달러 평문', '가격은 $100 이고 다른 값은 $200 이다'],
  // 마이크로 3종
  ['마이크로 밑줄', '++밑줄 친 부분++ 뒤 평문'],
  ['마이크로 형광펜', '==형광펜 부분== 뒤 평문'],
  ['마이크로 스포일러', '||가려진 정답|| 뒤 평문'],
  ['마이크로 3종 혼재', '++밑줄++ 과 ==형광== 과 ||스포일러|| 전부'],
  ['마이크로 안 서식', '==**굵은 형광펜**== 끝'],
  ['마이크로+굵게 중첩', '**굵게 ++밑줄++ 안쪽**'],
  // 참조(F43)
  ['링크 칩', '앞 [[DOC-0012]] 뒤'],
  ['링크 칩 별칭', '앞 [[DOC-0012|다른 이름]] 뒤'],
  ['앵커 칩', '앞 [[#절 제목]] 뒤'],
  ['문단 안 임베드', '앞 문장 ![[DOC-0007]] 뒤 문장'],
  ['참조+서식 혼재', '**굵게** [[DOC-0001]] `코드` ==형광== 끝'],
  // 헤딩
  ['헤딩', '## 제목에 **굵게** 포함'],
  ['헤딩 닫힘', '### 닫는 해시 ###'],
  // 목록
  ['불릿 목록', '- 첫 항목 **굵게**\n- 둘째 항목 `코드`\n- 셋째 ==형광=='],
  ['별표 마커 목록', '* 별표 마커\n* 두 번째'],
  ['순서 목록', '1. 하나 *기울임*\n2. 둘 [[DOC-0003]]\n3. 셋'],
  ['중첩 목록', '- 상위\n  - 하위 **굵게**\n- 상위2'],
  // 인용
  ['인용', '> 인용문 **굵게** 포함'],
  ['인용 여러 줄', '> 첫 줄\n> 둘째 줄 ==형광=='],
  ['인용 안 목록', '> - 항목 하나\n> - 항목 둘'],
  // 여러 줄 문단
  ['여러 줄 문단', '첫 줄 **굵게**\n둘째 줄 ==형광=='],
  ['경성 줄바꿈', '첫 줄  \n둘째 줄'],
  // 배제 대상(모델은 만들되 rich=false여야)
  ['코드 펜스', '```js\nconst a = 1\n```'],
  ['표', '| a | b |\n| --- | --- |\n| 1 | 2 |'],
  ['이미지', '![캡션](/images/2026/08/x.png)'],
  ['이미지 혼재 문단', '앞 문장 ![캡션](/images/2026/08/x.png) 뒤 문장'],
  ['콜아웃', ':::note[제목]\n내용\n:::'],
  ['블록 수식', '$$\na^2\n$$'],
]

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
const HAZARDS = [
  ['별표 입력', '평문 문장', 'a * b * c'],
  ['대괄호 입력', '평문 문장', '[[DOC-0001]] 처럼 보이는 글자'],
  ['마이크로 입력', '평문 문장', '수식 ||절댓값|| 표기'],
  ['directive 입력', '평문 문장', ':t[진짜 문법처럼]{c=red}'],
  ['형광 입력', '평문 문장', 'a==b==c'],
  ['줄머리 해시', '평문 문장', '# 제목처럼 보이는 글자'],
  ['백슬래시', '평문 문장', 'C:\\Users\\x'],
  ['이미지 문법', '평문 문장', '![캡션](/x.png)'],
]
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

try {
  const baselineSource = execFileSync(
    'git',
    ['show', 'HEAD:frontend/src/components/markdown/remarkStudy.ts'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
  )
  fs.writeFileSync(BASELINE_PATH, baselineSource, 'utf8')

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
