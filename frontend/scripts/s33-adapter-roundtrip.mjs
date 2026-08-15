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
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { ServerBlockNoteEditor } from '@blocknote/server-util'
import { SAMPLES, BLOCK_SAMPLES } from './roundtrip-corpus.mjs'
import { stable, stripIds, makeNormalize } from './s32-normalize.mjs'

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
const { markdownToBlocks, blocksToMarkdown, parseToMdast } = transform
const adapter = jiti(path.join(SRC, 'editor2/adapter/index.ts'))
const { toBlockNoteBlocks, fromBlockNoteBlocks } = adapter
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
const EXPECTED_DIALECT = new Map([
  // ---- 방언(형광펜·스포일러·:t·참조 칩·임베드·수식·콜아웃·원문 보존) — stage-34 이식 대상
  [':t 단일', 'style:t'],
  [':t 다중', 'style:t'],
  [':t hex', 'style:t'],
  [':t 화이트리스트 밖', 'style:t'],
  [':t 중첩 원본', 'style:t'],
  ['인라인 수식', 'inline:inlineMath'],
  // `$100 … $200`은 remark-math가 인라인 수식으로 읽는다(M32 기존 해석 — 어댑터가 만든 규칙이 아니다).
  ['달러 평문', 'inline:inlineMath'],
  ['링크 제목', 'link:title'],
  ['마이크로 밑줄', null], // ++밑줄++ 은 코어 underline으로 이식된다 — 아래에서 코어로 재분류
  ['마이크로 형광펜', 'style:highlight'],
  ['마이크로 스포일러', 'style:spoiler'],
  ['마이크로 3종 혼재', 'style:highlight'],
  // `==**x**==`·`||…||` 안쪽은 remarkStudy가 다시 파싱하지 않아 표식이 **평문**이다 → 코어.
  ['마이크로 안 서식', null],
  ['마이크로+굵게 중첩', null],
  ['불릿 목록', 'style:highlight'],
  ['순서 목록', 'inline:refChip'],
  ['인용 여러 줄', 'style:highlight'],
  ['여러 줄 문단', 'style:highlight'],
  ['링크 칩', 'inline:refChip'],
  ['링크 칩 별칭', 'inline:refChip'],
  ['앵커 칩', 'inline:refChip'],
  ['문단 안 임베드', 'block:docEmbed'],
  ['참조+서식 혼재', 'inline:refChip'],
  ['이미지 혼재 문단', 'inline:inlineImage'],
  ['콜아웃', 'block:callout'],
  ['블록 수식', 'block:mathBlock'],
  ['경성 줄바꿈', 'inline:hardBreak'],
])
// 위 Map에서 값이 null인 항목은 "코어"라는 뜻이다(가독성을 위해 자리만 남긴다).
for (const [label, kind] of [...EXPECTED_DIALECT]) if (kind === null) EXPECTED_DIALECT.delete(label)

// BLOCK_SAMPLES 쪽 방언·표현 불가 표본
for (const [label, kind] of [
  ['이미지 크기 혼재 문단', 'inline:inlineImage'],
  ['이미지 크기 평문(이스케이프)', 'inline:inlineImage'],
  ['체크리스트 중첩', 'style:highlight'],
  ['목록 안 다중 블록', 'listItem:spread'],
  ['느슨한 목록', 'listItem:spread'],
  ['인접 목록 분리(마커 변경)', 'listItem:groupBreak'],
  ['인접 순서 목록 분리(구분자 변경)', 'listItem:groupBreak'],
  ['인접 목록 3연속 분리', 'listItem:groupBreak'],
  ['인접 목록 분리 + 시작 번호', 'listItem:groupBreak'],
  ['중첩 안 인접 목록 분리', 'listItem:groupBreak'],
  ['콜아웃 다중 블록', 'block:callout'],
  ['콜아웃 안 코드', 'block:callout'],
  ['콜아웃 라벨 없음', 'block:callout'],
  ['접기 directive', 'block:callout'],
  ['표 정렬', 'table:align'],
  ['표 안 서식', 'inline:refChip'],
  ['블록 임베드 단독', 'block:docEmbed'],
  ['블록 임베드 별칭', 'block:docEmbed'],
  ['임베드 사이 문단', 'block:docEmbed'],
  ['헤딩 안 참조', 'inline:refChip'],
  ['블록 수식 여러 줄', 'block:mathBlock'],
  ['이미지 제목', 'image:title'],
  ['앵커 칩 별칭', 'inline:refChip'],
  ['참조 칩 서식 안', 'inline:refChip'],
  [':t 안 참조', 'style:t'],
  [':t 부분 겹침', 'style:t'],
  ['형광 안 :t', 'style:highlight'],
  ['nbsp + 서식 혼재', 'style:highlight'],
  [':t 비-ASCII 속성 키', 'style:t'],
  [':t 속성 키 기호', 'style:t'],
  [':t 속성 키 라틴확장·이모지', 'style:t'],
  [':t 속성 빈 값', 'style:t'],
  [':t 속성 값 인용 필요', 'style:t'],
  [':t 속성 값 백슬래시', 'style:t'],
  [':t 속성 값 기호', 'style:t'],
  [':t 속성 중복 키', 'style:t'],
  [':t 속성 + 팔레트 혼재', 'style:t'],
  ['HTML 원시 블록', 'block:sourceFallback'],
  ['각주 정의', 'block:sourceFallback'],
  ['콜아웃 비-ASCII 속성 키', 'block:callout'],
  ['콜아웃 속성 값 인용', 'block:callout'],
  ['콜아웃 이름 비-ASCII', 'block:callout'],
  ['콜아웃 이름 밑줄·하이픈', 'block:callout'],
  ['콜아웃 라벨 내부 연속 공백', 'block:callout'],
  ['콜아웃 라벨 내부 탭', 'block:callout'],
  ['콜아웃 라벨 내부 유니코드 공백', 'block:callout'],
  ['콜아웃 라벨 기호', 'block:callout'],
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
  const { blocks: bn, unsupported } = toBlockNoteBlocks(doc1)
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
  const doc2 = fromBlockNoteBlocks(bn)
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
  const md3 = blocksToMarkdown(fromBlockNoteBlocks(bn2.blocks))
  check(`[고정점] ${label}`, md2 === md3, `1차=${JSON.stringify(md2)} 2차=${JSON.stringify(md3)}`)
}
console.log(`  코어 표본 ${coreCount}종 · 방언/표현 불가 표본 ${dialectCount}종 (전체 ${CORPUS.length}종)`)
console.log(`  코어 블록 왕복: ${coreBlockPass}/${coreCount} · 정규형 동등: ${corePassNorm}/${coreCount}`)
console.log(`  미지원 사유 분포: ${[...dialectKinds].map(([k, v]) => `${k}=${v}`).join(' · ')}`)
mark('①·② 코퍼스 코어 왕복·정규형·고정점 + ③ 분류/사유 고정')

// ---------------------------------------------------------------- ③-d 사유별 최소 표본(손실 0 계약)

console.log('== ③ 손실 0: 블록에서 출발한 방언·표현 불가 입력이 전부 명시 보고되는가 ==')
const t = (text, styles) => (styles ? { type: 'text', text, styles } : { type: 'text', text })
const p = (content) => ({ id: 'x', type: 'paragraph', content })
const UNSUPPORTED_CASES = [
  ['형광펜 스타일', p([t('형광', { highlight: true })]), 'style:highlight'],
  ['스포일러 스타일', p([t('가림', { spoiler: true })]), 'style:spoiler'],
  [':t 스타일', p([t('색', { t: [['c', 'red']] })]), 'style:t'],
  ['참조 칩', p([{ type: 'refChip', ref: 'doc', target: 'DOC-0012' }]), 'inline:refChip'],
  ['인라인 수식', p([{ type: 'inlineMath', value: 'a^2' }]), 'inline:inlineMath'],
  ['문단 안 이미지', p([{ type: 'inlineImage', url: '/images/x.png', alt: 'c' }]), 'inline:inlineImage'],
  ['원문 보존 인라인', p([{ type: 'inlineFallback', markdown: '<b>x</b>', nodeType: 'html' }]), 'inline:inlineFallback'],
  ['경성 줄바꿈', p([t('첫'), { type: 'hardBreak' }, t('둘')]), 'inline:hardBreak'],
  [
    '링크 제목',
    p([{ type: 'link', url: 'https://example.com', title: '타이틀', children: [t('링크')] }]),
    'link:title',
  ],
  [
    '링크 안 칩',
    p([{ type: 'link', url: 'https://example.com', children: [{ type: 'refChip', ref: 'doc', target: 'DOC-1' }] }]),
    'inline:refChip',
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
  ['수식 블록', { id: 'x', type: 'mathBlock', value: 'a^2' }, 'block:mathBlock'],
  [
    '콜아웃',
    { id: 'x', type: 'callout', variant: 'note', title: '', children: [p([t('내용')])] },
    'block:callout',
  ],
  ['문서 임베드 블록', { id: 'x', type: 'docEmbed', target: 'DOC-0007' }, 'block:docEmbed'],
  [
    '원문 보존 블록',
    { id: 'x', type: 'sourceFallback', markdown: '<div>x</div>', nodeType: 'html' },
    'block:sourceFallback',
  ],
  [
    '이미지 제목',
    { id: 'x', type: 'image', url: '/images/x.png', alt: '캡션', title: '제목' },
    'image:title',
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
  ['블록 메타(provenance)', { id: 'x', type: 'paragraph', content: [t('a')], meta: { provenance: { kind: 'ocr' } } }, 'block:meta'],
]
for (const [label, block, kind] of UNSUPPORTED_CASES) {
  const { unsupported } = toBlockNoteBlocks({ version: 1, blocks: [block] })
  check(
    `[손실0] ${label}`,
    unsupported.some((issue) => issue.kind === kind),
    `기대 사유=${kind} 실제=${JSON.stringify(unsupported)}`,
  )
}

mark('③ 손실 0 — 사유별 최소 표본')

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
  ['구분선', [{ id: '1', type: 'divider' }]],
]

let bnPass = 0
for (const [label, blocks] of BN_ORIGIN) {
  const doc = fromBlockNoteBlocks(blocks)
  const { blocks: bn2, unsupported } = toBlockNoteBlocks(doc)
  check(`[BN왕복-미지원0] ${label}`, unsupported.length === 0, `미지원=${JSON.stringify(unsupported)}`)
  const doc2 = fromBlockNoteBlocks(bn2)
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
  const { blocks: bn, unsupported } = toBlockNoteBlocks(doc1)
  if (unsupported.length > 0) continue
  schemaCore += 1
  let doc2
  try {
    doc2 = fromBlockNoteBlocks(throughSchema(bn))
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
    doc2 = fromBlockNoteBlocks(throughSchema(toBlockNoteBlocks(doc).blocks))
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
    '[스키마팔레트] 블록 10종 고정',
    blockTypes ===
      'bulletListItem,checkListItem,codeBlock,divider,heading,image,numberedListItem,paragraph,quote,table',
    `실제=${blockTypes}`,
  )
  check('[스키마팔레트] 스타일 5종 고정(색 스타일 0)', styleTypes === 'bold,code,italic,strike,underline', `실제=${styleTypes}`)
  check('[스키마팔레트] 인라인 2종 고정', inlineTypes === 'link,text', `실제=${inlineTypes}`)
  const props = (type) => Object.keys(noteSchema.blockSchema[type].propSchema).sort().join(',')
  check('[스키마팔레트] 문단 표현 prop 0', props('paragraph') === '', `실제=${props('paragraph')}`)
  check('[스키마팔레트] 헤딩 prop = level만', props('heading') === 'level', `실제=${props('heading')}`)
  check('[스키마팔레트] 코드블록 prop = info,language', props('codeBlock') === 'info,language', `실제=${props('codeBlock')}`)
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
