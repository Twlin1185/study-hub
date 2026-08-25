// S40(stage-40) 블록별 툴바 필터(FB-6, 규약 B) **기계 검증** — 순수 함수 단위 검사.
//
// 실행: node frontend/scripts/s40-toolbar-filter.mjs
//   (s33 이후 관례 그대로 jiti로 TS 모듈을 직접 불러온다 — 신규 설치 0. `toolbar/blockFilter.ts`는
//    값 import로 `react`·`@blocknote/react`를 물고 있어(훅 `useSelectedBlockTypes` 때문 — 이
//    스크립트가 검사하는 대상은 아니지만 모듈 로드 시 함께 실행된다) s37과 같은 `.css` 스텁이 필요하다.)
//
// 검사 대상: `shouldShowTextFormattingGroup(blockTypes)` — 군 정의(원자·미디어 7종 · 코드 블록 1종 ·
// 그 외 = 텍스트 블록) × 규칙 1~4(전부 원자·미디어=숨김 · 전부 코드=숨김 · 혼합=표시 · 빈 집합=표시)
// 전수표를 기계로 고정한다.
import Module, { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FRONT = path.resolve(HERE, '..')
const SRC = path.join(FRONT, 'src')

// `@blocknote/react`의 배럴(`index.js`)이 `BlockNoteView.tsx` → `import "./styles.css"`를 물고
// 온다 — s37과 같은 스텁(이 스크립트 전용, 런타임 번들 무영향).
Module._extensions['.css'] = (mod) => {
  mod.exports = {}
}

const require = createRequire(path.join(FRONT, 'package.json'))
const jiti = require('jiti')(path.join(FRONT, 'scripts/_loader.cjs'), {
  interopDefault: true,
  esmResolve: true,
  cache: false,
  requireCache: false,
  extensions: ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.json'],
})

const { shouldShowTextFormattingGroup, computeSelectedBlockTypes, ATOM_MEDIA_BLOCK_TYPES, CODE_BLOCK_TYPES } = jiti(
  path.join(SRC, 'editor2/blocknote/toolbar/blockFilter.ts'),
)

let pass = 0
let fail = 0
const failures = []

function eq(label, actual, expected) {
  const ok = actual === expected
  if (ok) pass += 1
  else {
    fail += 1
    failures.push(`${label} — got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
  }
}

// ---------------------------------------------------------------- 군 정의 고정(회귀 방지)
eq('군 정의 — 원자·미디어 7종', ATOM_MEDIA_BLOCK_TYPES.length, 7)
for (const t of ['image', 'webEmbed', 'docEmbed', 'toc', 'divider', 'mathBlock', 'sourceFallback']) {
  eq(`군 정의 — 원자·미디어 포함(${t})`, ATOM_MEDIA_BLOCK_TYPES.includes(t), true)
}
eq('군 정의 — 코드 블록 1종', CODE_BLOCK_TYPES.length, 1)
eq('군 정의 — 코드 블록 = codeBlock', CODE_BLOCK_TYPES.includes('codeBlock'), true)

// ---------------------------------------------------------------- 규칙 4 — 빈 집합(도킹 미포커스)
eq('규칙4 — 빈 배열 → 표시', shouldShowTextFormattingGroup([]), true)

// ---------------------------------------------------------------- 규칙 1 — 전부 원자·미디어 → 숨김
for (const t of ATOM_MEDIA_BLOCK_TYPES) {
  eq(`규칙1 — 단일 원자(${t}) → 숨김`, shouldShowTextFormattingGroup([t]), false)
}
eq('규칙1 — 원자 여럿(혼합 원자) → 숨김', shouldShowTextFormattingGroup(['image', 'divider', 'toc']), false)
eq(
  '규칙1 — 원자 7종 전부 → 숨김',
  shouldShowTextFormattingGroup([...ATOM_MEDIA_BLOCK_TYPES]),
  false,
)

// ---------------------------------------------------------------- 규칙 2 — 전부 코드 블록 → 숨김
eq('규칙2 — 단일 코드 블록 → 숨김', shouldShowTextFormattingGroup(['codeBlock']), false)
eq('규칙2 — 코드 블록 여러 개(범위 선택) → 숨김', shouldShowTextFormattingGroup(['codeBlock', 'codeBlock']), false)

// ---------------------------------------------------------------- 규칙 3 — 혼합(텍스트 블록 포함) → 표시
eq('규칙3 — 텍스트 블록 단독(paragraph) → 표시', shouldShowTextFormattingGroup(['paragraph']), true)
for (const t of ['heading', 'bulletListItem', 'numberedListItem', 'checkListItem', 'quote', 'table', 'callout']) {
  eq(`규칙3 — 텍스트 블록 단독(${t}) → 표시`, shouldShowTextFormattingGroup([t]), true)
}
eq(
  '규칙3 — 원자 + 텍스트 혼합 → 표시',
  shouldShowTextFormattingGroup(['image', 'paragraph']),
  true,
)
eq(
  '규칙3 — 코드 블록 + 텍스트 혼합 → 표시',
  shouldShowTextFormattingGroup(['codeBlock', 'paragraph']),
  true,
)
// ---------------------------------------------------------------- 검토 반려 결함 6 — 규칙 일반화
// 종전에는 원자·코드 각 군을 따로 "every"로만 검사해 `['image','codeBlock']`(텍스트 블록 0개지만
// 두 군이 섞여 "전부 원자"도 "전부 코드"도 아님)이 표시로 새 나갔다. "텍스트를 실을 수 있는 블록이
// 하나도 없으면 숨김"으로 일반화한 뒤에는 이 조합도 숨겨야 한다.
eq(
  '규칙1 일반화 — 원자 + 코드 블록 혼합(텍스트 블록 0개 — 둘 다 텍스트 서식 불가군) → 숨김',
  shouldShowTextFormattingGroup(['image', 'codeBlock']),
  false,
)
eq(
  '규칙1 일반화 — 원자 여럿 + 코드 블록 혼합 → 숨김',
  shouldShowTextFormattingGroup(['image', 'divider', 'codeBlock']),
  false,
)

// ---------------------------------------------------------------- 검토 반려 결함 5 — 재현 케이스
// 실제 결함은 이 순수 함수가 아니라 입력 갱신 타이밍(훅 구독 이벤트 — 자세한 근거는
// `blockFilter.ts`의 `useSelectedBlockTypes` 주석)이었다. 이 스크립트는 React 훅을 실행할 수
// 없으므로(렌더 불가), 결함 체인의 나머지 절반인 `computeSelectedBlockTypes`의 입력 정규화만
// 여기서 고정한다: 코드 블록 커서(collapsed selection)에서 `editor.getSelection()`이 `undefined`를
// 반환해도 커서 블록으로 항상 폴백해야 한다(빈 배열로 새면 규칙3 "빈 집합→표시"가 오발동한다).
const fakeCollapsedSelectionEditor = {
  getSelection: () => undefined,
  getTextCursorPosition: () => ({ block: { type: 'codeBlock' } }),
}
eq(
  '항목5 재현 — collapsed 선택(getSelection=undefined)도 커서 블록 1개로 폴백',
  computeSelectedBlockTypes(fakeCollapsedSelectionEditor).length,
  1,
)
eq(
  '항목5 재현 — 폴백된 블록 타입 = codeBlock',
  computeSelectedBlockTypes(fakeCollapsedSelectionEditor)[0],
  'codeBlock',
)
const fakeThrowingEditor = {
  getSelection: () => {
    throw new Error('편집기 미마운트 — 드문 경우')
  },
}
eq(
  '규칙3 안전망 — 판정 중 예외 → 빈 배열(빈 집합 취급, 규칙3 표시로 안전하게 물러남)',
  computeSelectedBlockTypes(fakeThrowingEditor).length,
  0,
)

// ----------------------------------------------------------------

console.log(`s40 toolbar filter: ${pass} passed, ${fail} failed`)
for (const line of failures) console.log(`  FAIL ${line}`)
if (fail > 0) process.exitCode = 1
