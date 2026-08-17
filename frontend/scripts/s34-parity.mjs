// S34(stage-34) G-12 — 현행 기능 패리티 체크리스트 **기계 검증**.
//
// 실행: node frontend/scripts/s34-parity.mjs
//   (s33 관례 계승 — jiti + `@blocknote/server-util` + `.tsx` 트랜스파일 + `.css` 스텁. 신규 설치 0.)
//
// 목적: stage-34 문서 G-12 체크리스트("현행 기능 패리티 체크리스트 작성·실행")의 **기계로 확인
// 가능한 항목**을 항목 1줄 = 검사 1건 이상으로 대응시켜, 각 항목마다 다음 경로를 전부 돌린다:
//
//   방언 Markdown(원문)
//     → markdownToBlocks            (앱 블록)
//     → toBlockNoteBlocks           (BN 블록 + sidecar)
//     → 실제 noteSchema로 ProseMirror 문서 적재 → 되읽기   (= s33 계열 ⑤와 같은 방식)
//     → fromBlockNoteBlocks(…, sidecar)                    (앱 블록)
//     → blocksToMarkdown            (프로젝션 Markdown)
//
// 항목마다 3종 검사:
//   (a) 블록 동등     — id 제외 앱 블록이 원본과 같은가
//   (b) 프로젝션 일치 — 재투영 Markdown이 M32 정규형(N)으로 원본과 동등한가
//                       (= 체크리스트의 "저장→새로고침→프로젝션 미리보기 일치")
//   (c) 미지원 보고   — 방언 팔레트 항목은 0건이어야 한다. **2026-08-17 R34 판정**으로 종전
//                       판정 대기 3종(`listItem:spread`·`listItem:groupBreak`·`table:align`)도
//                       사이드카 흡수가 확정돼 **보고 0건이 기대값**이 됐다(손실 수용하지 않음).
//                       그래서 이 항목들도 (a)(b)를 정상적으로 돈다.
//                       (checkMd의 expectUnsupported 경로는 구조적 사유용으로 남겨 둔다.)
//
// 마크다운 원문이 없는 항목(사이드카 전용 — 블록 메타·이미지 height 등)은 앱 블록을 직접 구성해
// checkBlock()으로 (a)(c)만 검사한다(비고에 "마크다운 표현 없음"으로 남긴다).
//
// 붙여넣기(Word/웹 표본 2종) 항목은 이 스크립트가 재구현하지 않는다 — `s34-paste-check.mjs`가
// 이미 검증하며, 그 결과를 패리티 표에 그대로 인용한다(작업 지시 §2).
import Module, { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { ServerBlockNoteEditor } from '@blocknote/server-util'
import { stable, stripIds, makeNormalize } from './s32-normalize.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FRONT = path.resolve(HERE, '..')
const SRC = path.join(FRONT, 'src')

// math-block CJS 엔트리의 katex CSS require를 스크립트 전용으로 무마(s33과 동일 사유).
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
const { toBlockNoteBlocks, fromBlockNoteBlocks } = adapter
const schemaModule = jiti(path.join(SRC, 'editor2/blocknote/schema.ts'))
const { noteSchema, asEditorBlocks, asAdapterBlocks } = schemaModule

const normalize = makeNormalize(parseToMdast)
const server = ServerBlockNoteEditor.create({ schema: noteSchema })

function throughSchema(blocks) {
  const pmNode = server._blocksToProsemirrorNode(asEditorBlocks(blocks))
  return asAdapterBlocks(server._prosemirrorNodeToBlocks(pmNode))
}

let pass = 0
let fail = 0
const failures = []
/** 결과 표 행 — 최종 Markdown 표 조립에 쓴다. */
const rows = []

function check(label, ok, detail) {
  if (ok) pass += 1
  else {
    fail += 1
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
  }
  return ok
}

function kindSet(unsupported) {
  return stable([...new Set(unsupported.map((u) => u.kind))].sort())
}

/**
 * 마크다운 원문이 있는 항목의 전체 경로 검사(방언/코어 공통).
 * expectUnsupported가 비어 있지 않으면 판정 대기 항목 — (c)만 검사하고 (a)(b)는 건너뛴다.
 */
function checkMd(label, src, { expectUnsupported = [], note = '' } = {}) {
  const doc1 = markdownToBlocks(src)
  const { blocks: bn, unsupported, sidecar } = toBlockNoteBlocks(doc1)
  const expectKey = stable([...expectUnsupported].sort())
  const gotKey = kindSet(unsupported)
  const cOk = check(
    `${label} (c)미지원 보고`,
    gotKey === expectKey,
    `기대=${expectKey} 실제=${gotKey}`,
  )

  if (expectUnsupported.length > 0) {
    rows.push({ label, method: 'md 왕복(판정 대기)', result: cOk ? '보고 유지(설계대로)' : '실패', note })
    return { pending: true, doc1, bn, unsupported, sidecar }
  }

  let doc2
  try {
    doc2 = fromBlockNoteBlocks(throughSchema(bn), sidecar)
  } catch (error) {
    check(`${label} (a)블록 동등`, false, `실제 스키마 적재 실패: ${error?.message ?? error}`)
    rows.push({ label, method: 'md→BN→실제 스키마→md', result: '실패(스키마 적재)', note })
    return { pending: false, doc1 }
  }
  const want = stable(stripIds(doc1.blocks))
  const got = stable(stripIds(doc2.blocks))
  const aOk = check(`${label} (a)블록 동등`, want === got, want === got ? '' : `원본=${want.slice(0, 300)} 왕복=${got.slice(0, 300)}`)

  const md2 = blocksToMarkdown(doc2)
  const a = stable(normalize(src))
  const b = stable(normalize(md2))
  const bOk = check(`${label} (b)프로젝션 일치`, a === b, a === b ? '' : `원본N=${a.slice(0, 300)} 투영N=${b.slice(0, 300)} 투영md=${JSON.stringify(md2)}`)

  const ok = aOk && bOk && cOk
  rows.push({ label, method: 'md→BN→실제 스키마→md', result: ok ? 'PASS' : '실패', note })
  return { pending: false, doc1, doc2, md2 }
}

/**
 * 마크다운 원문이 없는(사이드카 전용) 항목 — 앱 블록을 직접 구성해 (a)(c)만 검사한다.
 */
function checkBlock(label, block, { expectUnsupported = [], note = '마크다운 표현 없음(사이드카 전용) — (b) 해당 없음' } = {}) {
  const doc1 = { version: 1, blocks: [block] }
  const { blocks: bn, unsupported, sidecar } = toBlockNoteBlocks(doc1)
  const expectKey = stable([...expectUnsupported].sort())
  const gotKey = kindSet(unsupported)
  const cOk = check(`${label} (c)미지원 보고`, gotKey === expectKey, `기대=${expectKey} 실제=${gotKey}`)

  let doc2
  try {
    doc2 = fromBlockNoteBlocks(throughSchema(bn), sidecar)
  } catch (error) {
    check(`${label} (a)블록 동등`, false, `실제 스키마 적재 실패: ${error?.message ?? error}`)
    rows.push({ label, method: '블록 직접구성→BN→실제 스키마→블록', result: '실패(스키마 적재)', note })
    return
  }
  const want = stable(stripIds(doc1.blocks))
  const got = stable(stripIds(doc2.blocks))
  const aOk = check(`${label} (a)블록 동등`, want === got, want === got ? '' : `원본=${want.slice(0, 300)} 왕복=${got.slice(0, 300)}`)
  const ok = aOk && cOk
  rows.push({ label, method: '블록 직접구성→BN→실제 스키마→블록', result: ok ? 'PASS' : '실패', note })
}

const t = (text, styles) => (styles ? { type: 'text', text, styles } : { type: 'text', text })
const p = (content) => ({ id: 'x', type: 'paragraph', content })

// ================================================================== F52 방언 전항

console.log('== F52 방언 전항 ==')

checkMd('F52 밑줄(++)', '++밑줄 친 부분++ 뒤 평문')

for (const color of ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray']) {
  checkMd(`F52 형광 7색 — ${color}`, `:t[형광 ${color}]{bg=${color}} 뒤 평문`)
}
checkMd('F52 형광 기본(==)', '==형광펜 부분== 뒤 평문')
checkMd('F52 스포일러(||)', '||가려진 정답|| 뒤 평문')

for (const color of ['red', 'blue', 'green']) {
  checkMd(`F52 글자색 — ${color}`, `:t[글자 ${color}]{c=${color}} 뒤 평문`)
}
checkMd('F52 글자색 — #rrggbb', ':t[자유 글자색]{c=#3366ff} 뒤 평문')
checkMd('F52 바탕색 — #rrggbb', ':t[자유 바탕색]{bg=#ffee88} 뒤 평문')

for (const size of ['small', 'large', 'xl']) {
  checkMd(`F52 크기 3종 — ${size}`, `:t[크기 ${size}]{s=${size}} 뒤 평문`)
}

checkMd('F52 콜아웃 — note(제목 없음)', ':::note\n라벨 없는 콜아웃\n:::')
checkMd('F52 콜아웃 — warn(제목 있음)', ':::warn[주의]\n첫 문단 **굵게**\n\n- 항목 하나\n- 항목 둘\n:::')
checkMd('F52 콜아웃 — tip(제목 있음)', ':::tip[힌트]\n```js\nconst a = 1\n```\n:::')
checkMd('F52 콜아웃 — fold(제목 있음)', ':::fold[더 보기]\n숨은 내용 ==형광==\n:::')
checkMd('F52 콜아웃 — fold(제목 없음)', ':::fold\n숨은 내용 **굵게**\n:::')
checkMd('F52 콜아웃 — hide(제목 있음)', ':::hide[정답]\n숨김 내용 ++밑줄++\n:::')
checkMd('F52 콜아웃 — hide(제목 없음)', ':::hide\n숨김 내용\n:::')

// ================================================================== F43 참조 3종

console.log('== F43 참조 3종 ==')

checkMd('F43 링크 칩 — 별칭 없음', '앞 [[DOC-0012]] 뒤')
checkMd('F43 링크 칩 — 별칭 있음', '앞 [[DOC-0012|다른 이름]] 뒤')
checkMd('F43 앵커 — 별칭 없음', '앞 [[#절 제목]] 뒤')
checkMd('F43 앵커 — 별칭 있음', '앞 [[#절 제목|보이는 이름]] 뒤')
checkMd('F43 임베드(블록) — 별칭 없음', '![[DOC-0007]]')
checkMd('F43 임베드(블록) — 별칭 있음', '![[DOC-0007|다른 이름]]')

// ================================================================== 수식

console.log('== 수식 ==')

checkMd('수식 — 인라인', '수식 $a^2 + b^2$ 이 있는 문단')
checkMd('수식 — 블록(단순)', '$$\na^2\n$$')
checkMd('수식 — 블록(여러 줄)', '$$\n\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}\n$$')

// ================================================================== 표

console.log('== 표 ==')

checkMd('표 — 헤더 행', '| a | b |\n| --- | --- |\n| 1 | 2 |')
{
  // R34 판정(2026-08-17) — 사이드카 흡수 확정. 값이 왕복하므로 보고가 0건이고, 전체 경로(a)(b)를 돈다.
  checkMd('표 — 정렬', '| 왼쪽 | 가운데 | 오른쪽 |\n| :--- | :---: | ---: |\n| a | b | c |')
  // 마크다운 왕복과 별개로 **사이드카 자체의 보존**도 못박는다(열 수 불변 조건).
  const table = { id: 'tb', type: 'table', align: ['left', 'center', 'right'], rows: [[[t('왼쪽')], [t('가운데')], [t('오른쪽')]], [[t('a')], [t('b')], [t('c')]]] }
  const { blocks, sidecar } = toBlockNoteBlocks({ version: 1, blocks: [table] })
  const back = fromBlockNoteBlocks(blocks, sidecar)
  const ok = check(
    '표 — 정렬(사이드카 보존)',
    stable(back.blocks[0].align) === stable(['left', 'center', 'right']),
    `실제=${stable(back.blocks[0].align)}`,
  )
  rows.push({ label: '표 — 정렬(사이드카 보존)', method: '블록 직접구성(사이드카 왕복)', result: ok ? 'PASS' : '실패', note: '열 수가 바뀌면 되살리지 않음은 s33이 별도 검증' })
}

// ================================================================== 목록

console.log('== 목록 ==')

checkMd('목록 — 글머리', '- 첫 항목 **굵게**\n- 둘째 항목 `코드`\n- 셋째 ==형광==')
checkMd('목록 — 번호', '1. 하나 *기울임*\n2. 둘 [[DOC-0003]]\n3. 셋')
checkMd('목록 — 체크박스', '- [ ] 안 한 일\n- [x] 한 일 **굵게**')
checkMd('목록 — 중첩', '- 상위\n  - 하위 **굵게**\n- 상위2')
checkMd('목록 — 시작 번호', '3. 셋\n4. 넷\n5. 다섯')
// R34 판정(2026-08-17) — 사이드카 흡수 확정. 보고 0건 + 전체 경로(a)(b) 통과가 기대값이다.
checkMd('목록 — 느슨한 목록(spread, 사이드카 흡수)', '- 하나\n\n- 둘')
checkMd('목록 — 느슨한 목록 3항목', '- 하나\n\n- 둘\n\n- 셋')
checkMd('목록 — 인접 목록 분리(groupBreak, 사이드카 흡수)', '- 하나\n\n* 둘')
checkMd('목록 — 인접 순서 목록 분리(구분자 변경)', '1. 하나\n\n1) 둘')
checkMd('목록 — 느슨한 목록 + 인접 분리 혼합', '- 하나\n\n- 둘\n\n* 셋')
// 실측 폴백 3건의 실제 모양 — 기출 풀이의 물음 목록(1), 2) …) 사이에 빈 줄이 든 느슨한 목록.
checkMd('목록 — 물음 목록(실문서 폴백 표본 모양)', '1) 첫 물음\n\n2) 둘째 물음\n\n3) 셋째 물음')

// ================================================================== 코드 블록

console.log('== 코드 블록 ==')

checkMd('코드 블록 — lang 지정', '```js\nconst a = 1\n```')
checkMd('코드 블록 — lang 없음', '```\n평범한 코드\n```')
checkMd('코드 블록 — 펜스 info 문자열 보존', '```js title="a b" {1,3}\nx\n```')

// ================================================================== 인용/구분선

console.log('== 인용 · 구분선 ==')

checkMd('인용 — 여러 줄', '> 첫 줄\n> 둘째 줄 ==형광==')
checkMd('인용 — 중첩', '> 바깥\n>\n> > 안쪽 **굵게**')
checkMd('구분선', '앞 문단\n\n---\n\n뒤 문단')

// ================================================================== 이미지

console.log('== 이미지 ==')

checkMd('이미지 — 블록', '![캡션](/images/2026/08/x.png)')
checkMd('이미지 — {w=400} 크기 왕복', '![캡션](/images/2026/08/x.png){w=400}')
checkMd('이미지 — 인라인(문단 안)', '앞 문장 ![캡션](/images/2026/08/x.png) 뒤 문장')
checkMd('이미지 — title 보존', '![캡션](/images/x.png "이미지 제목")')
checkBlock(
  '이미지 — height 보존',
  { id: 'x', type: 'image', url: '/images/x.png', alt: '캡션', title: '제목', width: 400, height: 300 },
  { note: 'height는 표준 Markdown 이미지 구문에 자리가 없다(§규약 E는 w=만 표기) — prop 확장 왕복만 검증' },
)

// ================================================================== 규약 I 흡수 7종

console.log('== 규약 I 흡수 7종(2026-08-17 R34 판정으로 3종 추가) ==')

checkMd('규약I — 경성 줄바꿈', '첫 줄  \n둘째 줄')
checkMd('규약I — link title', '[제목 달린](https://example.com "타이틀") 링크')
checkMd('규약I — image title(재확인)', '![캡션](/images/x.png "이미지 제목")')
checkBlock(
  '규약I — block meta(사이드카)',
  { id: 'x', type: 'paragraph', content: [t('a')], meta: { provenance: { kind: 'ocr', capturedAt: '2026-08-16T00:00:00Z' } } },
)

// R34 흡수 3종 — **실제 스키마를 거친 뒤에도** 런 단위 복원이 서는가(사이드카 키 = 블록 id가
// 진짜 편집기 왕복에서 살아남는지 함께 확인된다). 구조 편집 내성은 s33이 별도로 못박는다.
{
  const li = (id, extra) => ({ id, type: 'listItem', ordered: false, content: [t(id)], ...extra })
  const cases = [
    ['규약I — 느슨한 목록(실제 스키마 왕복)', [li('a', { spread: true }), li('b', { spread: true })]],
    ['규약I — 목록 그룹 경계(실제 스키마 왕복)', [li('a'), li('b', { groupBreak: true })]],
    [
      '규약I — 느슨함 + 경계 혼합(실제 스키마 왕복)',
      [li('a', { spread: true }), li('b', { spread: true }), li('c', { groupBreak: true })],
    ],
  ]
  for (const [label, blocks] of cases) {
    const doc1 = { version: 1, blocks }
    const { blocks: bn, unsupported, sidecar } = toBlockNoteBlocks(doc1)
    const cOk = check(`${label} (c)미지원 보고`, kindSet(unsupported) === stable([]), `실제=${kindSet(unsupported)}`)
    const doc2 = fromBlockNoteBlocks(throughSchema(bn), sidecar)
    const want = stable(stripIds(doc1.blocks))
    const got = stable(stripIds(doc2.blocks))
    const aOk = check(`${label} (a)블록 동등`, want === got, `원본=${want.slice(0, 300)} 왕복=${got.slice(0, 300)}`)
    rows.push({
      label,
      method: '블록 직접구성→BN→실제 스키마→블록',
      result: aOk && cOk ? 'PASS' : '실패',
      note: '사이드카 흡수(R34 판정 2026-08-17) — 복원은 런 단위',
    })
  }
}

// ---------------------------------------------------------------- 결과

console.log('')
console.log(`총 ${pass + fail}건 · 통과 ${pass} · 실패 ${fail}`)
if (fail) {
  console.log('실패 목록:')
  for (const line of failures) console.log(`  - ${line}`)
}

console.log('')
console.log('== 결과 표(요약 — 최종 보고 표 조립용) ==')
for (const row of rows) {
  console.log(`| ${row.label} | ${row.method} | ${row.result} | ${row.note} |`)
}

if (fail) process.exit(1)
