// S37(M35) 신규 커스텀 블록 검증 — stage-37 F-1·F-2(`::toc`·`::web`).
//
// 실행: node frontend/scripts/s37-custom-blocks.mjs [db경로]
//   (프론트 유틸이라 pytest 대상이 아니다 — 불변 규칙 7의 "실행 스모크". TS 모듈은 s30 이후
//    관례 그대로 jiti로 불러온다 — 신규 설치 0.)
//
// 검사 5계열(stage-37 규약 A·B·E):
//   ① 정규형        : `::toc`·`::web{url…}`·`::web{url… title…}` 표본이 md→블록→md에서
//                     **바이트 동일**(정규형 = 직렬화 고정점)이고 블록 왕복이 동형인가.
//   ② 정규화 수용   : 무인용 속성·속성 순서·여분 공백 등 비정규 **표기**는 파싱이 수용하고
//                     직렬화가 정규형으로 수렴시키되 **방언 의미(name+속성)는 1비트도 안 바뀌는가**.
//   ③ 폴백          : 속성 동반 `::toc{…}`·라벨 동반·url 부재·미지 속성 동반은 스키마에 흡수되지
//                     않고 **원문 보존**(sourceFallback)으로 가는가 + 재출력이 원문 그대로인가.
//   ④ 어댑터        : 블록 ↔ BlockNote JSON 왕복(원자 커스텀 2종) — **meta prop 완전 왕복**과
//                     **사이드카 불요**(사이드카를 통째로 버려도 결과가 같다)를 기계로 고정 +
//                     **화면이 쓰는 실제 `noteSchema`로 적재 왕복**(F-3·F-4 편집 표면 스펙 등재 이후
//                     인계 ⓒ — s33-adapter-roundtrip ⑤와 같은 `throughSchema` 관례).
//   ⑤ 실문서 코퍼스 : 신규 방언이 **부재**함을 실측하고(= 기존 문서 변환 diff 0의 전제) 산출
//                     블록에 toc/webEmbed가 0건인가 + 프로젝션 고정점(읽기 전용 — DB 무접촉).
import Module, { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { ServerBlockNoteEditor } from '@blocknote/server-util'
import { stable, stripIds } from './s32-normalize.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FRONT = path.resolve(HERE, '..')
const SRC = path.join(FRONT, 'src')

// `@blocknote/math-block`(schema.ts가 불러온다)은 CJS 엔트리에서 `katex/dist/katex.min.css`를
// require한다 — Node/jiti는 CSS를 JS로 파싱하려다 깨진다. s33-adapter-roundtrip과 같은 스텁
// (이 스크립트 전용 — 런타임 번들에는 영향 0).
Module._extensions['.css'] = (mod) => {
  mod.exports = {}
}

const require = createRequire(path.join(FRONT, 'package.json'))
// 커스텀 스펙은 `.tsx`(React 렌더 컴포넌트) — jiti 1.x 기본 변환은 JSX를 모른다. s33과 같은 방식으로
// `.tsx`만 devDependency `typescript`로 직접 트랜스파일한다(스크립트 전용 배선).
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
// F-3·F-4가 등재한 실제 화면 스키마(toc·webEmbed 스펙 포함) — 별도 구성이면 스펙 회귀를 못 잡는다
// (s33-adapter-roundtrip 계열 ⑤ 머리말과 같은 이유).
const { noteSchema, asEditorBlocks, asAdapterBlocks } = jiti(path.join(SRC, 'editor2/blocknote/schema.ts'))

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

const sections = []
let marked = 0
function mark(label) {
  const total = pass + fail
  sections.push({ label, count: total - marked })
  marked = total
}

/** 블록 트리 순회(중첩 children 포함). */
function walkBlocks(blocks, fn) {
  for (const block of blocks ?? []) {
    fn(block)
    walkBlocks(block.children, fn)
  }
}

function countTypes(blocks) {
  const out = { toc: 0, webEmbed: 0, sourceFallback: 0 }
  walkBlocks(blocks, (block) => {
    if (block.type in out) out[block.type] += 1
  })
  return out
}

/**
 * 방언 의미의 독립 관측 — 변환기를 통하지 않고 **mdast에서 직접** leaf directive의 이름·속성을
 * 훑는다(변환기가 정보를 흘리면 양쪽이 똑같이 흘려 통과하는 공허한 검사를 피한다 — s32 관례).
 */
function dialectShape(md) {
  const root = parseToMdast(md)
  const out = []
  const walk = (node) => {
    if (node.type === 'leafDirective') {
      out.push({ name: node.name ?? '', attrs: { ...(node.attributes ?? {}) } })
    }
    for (const child of node.children ?? []) walk(child)
  }
  if (root) walk(root)
  return stable(out)
}

const eq = (a, b) => stable(stripIds(a)) === stable(stripIds(b))

// ---------------------------------------------------------------- ① 정규형 왕복·고정점

const WEB = 'https://example.com/a?x=1'
/** 무인용 속성 표본용 — 인용 없이 실을 수 있는 도메인(remark-directive 실측: `=`·공백에서 깨진다). */
const WEB_BARE = 'https://example.com/a'

const CANON = [
  ['목차 단독', '::toc'],
  ['임베드 url만', `::web{url="${WEB}"}`],
  ['임베드 url+title', `::web{url="${WEB}" title="예시 문서"}`],
  ['제목·본문 혼합', `# 제목\n\n::toc\n\n첫 문단입니다.\n\n::web{url="${WEB}" title="카드"}\n\n## 절 제목\n\n마지막 문단.`],
  ['인용 안 목차', '> ::toc'],
  ['목록 항목 안 임베드', `- 항목\n\n  ::web{url="${WEB}"}`],
  ['콜아웃 안 목차', ':::note[안내]\n::toc\n:::'],
  ['연속 2개', `::toc\n\n::web{url="${WEB}"}`],
]

for (const [label, md] of CANON) {
  const blocks = markdownToBlocks(md)
  const md1 = blocksToMarkdown(blocks)
  const blocks2 = markdownToBlocks(md1)
  const md2 = blocksToMarkdown(blocks2)
  const counts = countTypes(blocks.blocks)
  check(`[정규형] ${label} — 직렬화 = 원문 바이트 동일`, md1 === md, `투영=${JSON.stringify(md1)}`)
  check(`[정규형] ${label} — 블록 왕복 동형`, eq(blocks.blocks, blocks2.blocks))
  check(`[정규형] ${label} — 고정점(2차 투영 동일)`, md1 === md2)
  check(`[정규형] ${label} — 원문 보존 폴백 0건`, counts.sourceFallback === 0, `fallback=${counts.sourceFallback}`)
  check(`[정규형] ${label} — 스키마 버전 1 유지`, blocks.version === 1, `version=${blocks.version}`)
}

// 스키마 형태 못 박기(prop 도메인이 조용히 넓어지지 않게 한다 — TOC prop 0 · web은 3필드까지만).
{
  const toc = markdownToBlocks('::toc').blocks[0]
  check('[정규형] TOC 블록 = { id, type } 뿐(저장 데이터 0)', stable(Object.keys(toc).sort()) === stable(['id', 'type']), `키=${Object.keys(toc)}`)
  const bare = markdownToBlocks(`::web{url="${WEB}"}`).blocks[0]
  check('[정규형] 임베드(url만) 키 = id,type,url', stable(Object.keys(bare).sort()) === stable(['id', 'type', 'url']), `키=${Object.keys(bare)}`)
  check('[정규형] 임베드 url 값 보존', bare.url === WEB, `url=${bare.url}`)
  const titled = markdownToBlocks(`::web{url="${WEB}" title="예시 문서"}`).blocks[0]
  check('[정규형] 임베드(title 동반) 키 = id,title,type,url', stable(Object.keys(titled).sort()) === stable(['id', 'title', 'type', 'url']), `키=${Object.keys(titled)}`)
  check('[정규형] 임베드 title 값 보존', titled.title === '예시 문서', `title=${titled.title}`)
  // 메타는 **프로젝션 비대상**(명문화된 강등) — 직렬화에 새어 나오지 않는가.
  const withMeta = blocksToMarkdown({
    version: 1,
    blocks: [{ id: 'b1', type: 'webEmbed', url: WEB, title: 'T', meta: { description: '설명', siteName: '사이트' } }],
  })
  check('[정규형] 메타 캐시는 프로젝션에 실리지 않는다', withMeta === `::web{url="${WEB}" title="T"}`, `투영=${withMeta}`)
}
mark('① 정규형 왕복·고정점')

// ---------------------------------------------------------------- ② 비정규 **표기** 정규화 수용

const NORMALIZED = [
  ['무인용 url', `::web{url=${WEB_BARE}}`, `::web{url="${WEB_BARE}"}`],
  ['속성 순서 뒤바뀜', `::web{title="제목" url="${WEB}"}`, `::web{url="${WEB}" title="제목"}`],
  ['여분 공백', `::web{url="${WEB}"    title="제목"}`, `::web{url="${WEB}" title="제목"}`],
  ['무인용 title', `::web{url=${WEB_BARE} title=제목}`, `::web{url="${WEB_BARE}" title="제목"}`],
  ['공백 포함 title', `::web{url="${WEB}" title="두 낱말"}`, `::web{url="${WEB}" title="두 낱말"}`],
  // 빈 제목은 담을 정보가 없다 — `''` ⇔ 부재 관례로 접힌다(속성 자체가 사라진다).
  // 빈 제목은 담을 정보가 없다 — `''` ⇔ 부재 관례로 접힌다(속성 자체가 사라진다 · 의미 동일).
  ['빈 title 접힘', `::web{url="${WEB}" title=""}`, `::web{url="${WEB}"}`, false],
]

for (const [label, md, expected, sameShape = true] of NORMALIZED) {
  const md1 = blocksToMarkdown(markdownToBlocks(md))
  const md2 = blocksToMarkdown(markdownToBlocks(md1))
  check(`[정규화] ${label} — 정규형 수렴`, md1 === expected, `투영=${JSON.stringify(md1)}`)
  if (sameShape) {
    check(`[정규화] ${label} — 방언 의미(name+속성) 무변`, dialectShape(md) === dialectShape(md1), `원본=${dialectShape(md)} 투영=${dialectShape(md1)}`)
  }
  check(`[정규화] ${label} — 고정점`, md1 === md2)
}
mark('② 비정규 표기 정규화 수용')

// ---------------------------------------------------------------- ③ 폴백(원문 보존)

const FALLBACK = [
  ['TOC 속성 동반', '::toc{depth=2}'],
  ['TOC 클래스 축약', '::toc{.compact}'],
  ['TOC 라벨 동반', '::toc[목차]'],
  ['임베드 속성 없음', '::web'],
  ['임베드 url 값 없음', '::web{url}'],
  ['임베드 빈 url', '::web{url=""}'],
  ['임베드 미지 속성', `::web{url="${WEB}" ratio="16:9"}`],
  ['임베드 id 축약 동반', `::web{url="${WEB}" #card}`],
  ['임베드 라벨 동반', `::web[라벨]{url="${WEB}"}`],
  ['미지 leaf directive', '::tocx{a=1}'],
]

for (const [label, md] of FALLBACK) {
  const doc = markdownToBlocks(md)
  const first = doc.blocks[0]
  const counts = countTypes(doc.blocks)
  const md1 = blocksToMarkdown(doc)
  const md2 = blocksToMarkdown(markdownToBlocks(md1))
  check(`[폴백] ${label} — sourceFallback으로 보존`, first?.type === 'sourceFallback', `타입=${first?.type}`)
  check(`[폴백] ${label} — 원문 슬라이스 그대로`, first?.markdown === md, `보존=${JSON.stringify(first?.markdown)}`)
  check(`[폴백] ${label} — 신규 블록으로 흡수 0`, counts.toc === 0 && counts.webEmbed === 0, JSON.stringify(counts))
  check(`[폴백] ${label} — 재출력 = 원문`, md1 === md, `투영=${JSON.stringify(md1)}`)
  check(`[폴백] ${label} — 고정점`, md1 === md2)
}
// 평문 보호 — 사용자가 **본문 텍스트로** 적은 `::toc`가 다음 저장에서 목차 블록으로 바뀌지 않는가
// (조용한 본문 변형 0 — 이스케이프 계약 A-3의 신규 방언 몫).
for (const plain of ['::toc', '::web{url="x"}', '::tocx']) {
  const doc = { version: 1, blocks: [{ id: 'b1', type: 'paragraph', content: [{ type: 'text', text: plain }] }] }
  const md1 = blocksToMarkdown(doc)
  const back = markdownToBlocks(md1)
  const md2 = blocksToMarkdown(back)
  check(`[평문] ${plain} — 문단으로 되살아난다`, back.blocks[0]?.type === 'paragraph', `타입=${back.blocks[0]?.type}`)
  check(`[평문] ${plain} — 텍스트 1문자도 안 바뀐다`, eq(back.blocks, doc.blocks), stable(stripIds(back.blocks)))
  check(`[평문] ${plain} — 고정점`, md1 === md2)
}
mark('③ 비정규형 폴백(원문 보존)·평문 보호')

// ---------------------------------------------------------------- ④ 어댑터 왕복(원자 2종)

const META_FULL = {
  description: '예시 설명',
  siteName: 'Example',
  image: 'https://example.com/og.png',
  favicon: 'https://example.com/favicon.ico',
  fetchedAt: '2026-08-21T09:30:00Z',
}

const ADAPTER = [
  ['목차', [{ id: 'b1', type: 'toc' }]],
  ['임베드 url만', [{ id: 'b1', type: 'webEmbed', url: WEB }]],
  ['임베드 url+title', [{ id: 'b1', type: 'webEmbed', url: WEB, title: '예시 문서' }]],
  ['임베드 + 메타 전건', [{ id: 'b1', type: 'webEmbed', url: WEB, title: 'T', meta: { ...META_FULL } }]],
  [
    '임베드 + 메타 null 혼재',
    [{ id: 'b1', type: 'webEmbed', url: WEB, meta: { description: null, siteName: '사이트', image: null, favicon: null, fetchedAt: '2026-08-21T00:00:00Z' } }],
  ],
  ['임베드 + 빈 메타 객체', [{ id: 'b1', type: 'webEmbed', url: WEB, meta: {} }]],
  ['임베드 + provenance 동거', [{ id: 'b1', type: 'webEmbed', url: WEB, meta: { provenance: { kind: 'llm' }, description: '설명' } }]],
  [
    '문서 혼합(문단·목차·임베드)',
    [
      { id: 'b1', type: 'heading', level: 2, content: [{ type: 'text', text: '절' }] },
      { id: 'b2', type: 'toc' },
      { id: 'b3', type: 'paragraph', content: [{ type: 'text', text: '본문' }] },
      { id: 'b4', type: 'webEmbed', url: WEB, title: '카드', meta: { ...META_FULL } },
    ],
  ],
  ['인용 안 목차', [{ id: 'b1', type: 'quote', children: [{ id: 'b2', type: 'toc' }] }]],
  [
    '목록 항목 안 임베드',
    [{ id: 'b1', type: 'listItem', ordered: false, content: [{ type: 'text', text: '항목' }], children: [{ id: 'b2', type: 'webEmbed', url: WEB, meta: { ...META_FULL } }] }],
  ],
]

for (const [label, blocks] of ADAPTER) {
  const doc = { version: 1, blocks }
  const fwd = toBlockNoteBlocks(doc)
  const back = fromBlockNoteBlocks(fwd.blocks, fwd.sidecar)
  // **사이드카 불요** — 사이드카를 통째로 버려도 결과가 같아야 한다(meta는 자기 prop이 싣는다).
  const bare = fromBlockNoteBlocks(fwd.blocks)
  check(`[어댑터] ${label} — 미지원 보고 0`, fwd.unsupported.length === 0, JSON.stringify(fwd.unsupported))
  check(`[어댑터] ${label} — 블록 왕복 동형(id 포함)`, stable(back.blocks) === stable(blocks), `복원=${stable(back.blocks).slice(0, 300)}`)
  check(`[어댑터] ${label} — 사이드카 없이도 동일(사이드카 불요)`, stable(bare.blocks) === stable(back.blocks))
  // 신규 2종은 사이드카 항목을 만들지 않는다(다른 블록이 만든 항목까지 금지하지는 않는다).
  const newIds = []
  walkBlocks(blocks, (block) => {
    if (block.type === 'toc' || block.type === 'webEmbed') newIds.push(block.id)
  })
  check(
    `[어댑터] ${label} — 신규 2종의 사이드카 항목 0`,
    newIds.every((id) => fwd.sidecar[id] === undefined),
    `사이드카=${JSON.stringify(fwd.sidecar)}`,
  )
}

// prop 도메인 고정 — BlockNote 쪽 표현이 조용히 넓어지지 않게 한다(F-3·F-4 스펙 등재의 계약).
{
  const fwd = toBlockNoteBlocks({
    version: 1,
    blocks: [
      { id: 'b1', type: 'toc' },
      { id: 'b2', type: 'webEmbed', url: WEB, title: 'T', meta: { ...META_FULL } },
    ],
  })
  const [toc, web] = fwd.blocks
  check('[어댑터] BN toc = 원자·prop 0', toc.type === 'toc' && toc.props === undefined, JSON.stringify(toc))
  check('[어댑터] BN webEmbed prop = meta,title,url', stable(Object.keys(web.props).sort()) === stable(['meta', 'title', 'url']), `키=${Object.keys(web.props)}`)
  check('[어댑터] BN webEmbed meta = 통짜 JSON 문자열', typeof web.props.meta === 'string' && stable(JSON.parse(web.props.meta)) === stable(META_FULL))
  // `''` ⇔ undefined 관례(규약 C 전례) 확인.
  const plain = toBlockNoteBlocks({ version: 1, blocks: [{ id: 'b1', type: 'webEmbed', url: WEB }] }).blocks[0]
  check('[어댑터] title/meta 없음 = 빈 문자열', plain.props.title === '' && plain.props.meta === '')
  const restored = fromBlockNoteBlocks([{ id: 'b1', type: 'webEmbed', props: { url: WEB, title: '', meta: '' } }])
  check('[어댑터] 빈 문자열 = 키 부재로 복원', stable(restored.blocks) === stable([{ id: 'b1', type: 'webEmbed', url: WEB }]), stable(restored.blocks))
  // 깨진 meta prop은 저장 경로를 막지 않는다(관대한 복원 — decodeAttrPairs 관례).
  const broken = fromBlockNoteBlocks([{ id: 'b1', type: 'webEmbed', props: { url: WEB, title: '', meta: '{깨짐' } }])
  check('[어댑터] 깨진 meta prop 무시(저장 경로 유지)', broken.blocks[0]?.type === 'webEmbed' && broken.blocks[0].meta === undefined)
}

// md → 블록 → BN → 블록 → md 통합 왕복(화면 저장 경로와 같은 순서).
for (const [label, md] of CANON) {
  const doc = markdownToBlocks(md)
  const fwd = toBlockNoteBlocks(doc)
  const back = fromBlockNoteBlocks(fwd.blocks, fwd.sidecar)
  check(`[어댑터·통합] ${label} — md→블록→BN→블록→md 동일`, blocksToMarkdown(back) === md, `투영=${JSON.stringify(blocksToMarkdown(back))}`)
}

// ④-e 실제 스키마 적재 왕복(인계 ⓒ) — 어댑터가 낸 JSON을 **화면이 쓰는 그 `noteSchema`**로
// ProseMirror 문서에 실제로 얹었다가 되읽는다. 여기까지 통과해야 다음이 동시에 보증된다:
//   · `blocknote/schema.ts`에 toc·webEmbed 스펙이 **등재**돼 있다(F-3·F-4의 실제 이행).
//   · 스펙 propSchema가 어댑터 표현(`BnToc`·`BnWebEmbed`)과 **1:1**이라 값이 안 깎인다.
//   · 실제 로드 후 되읽은 결과가 원래 앱 블록과 **동형**이다(사이드카 불요 재확인 — 실제 적재 경로).
const server = ServerBlockNoteEditor.create({ schema: noteSchema })
function throughSchema(blocks) {
  const pmNode = server._blocksToProsemirrorNode(asEditorBlocks(blocks))
  return asAdapterBlocks(server._prosemirrorNodeToBlocks(pmNode))
}

let schemaLoadPass = 0
for (const [label, blocks] of ADAPTER) {
  const doc = { version: 1, blocks }
  const fwd = toBlockNoteBlocks(doc)
  let back
  try {
    back = fromBlockNoteBlocks(throughSchema(fwd.blocks), fwd.sidecar)
  } catch (error) {
    check(`[스키마적재] ${label}`, false, `적재 실패: ${error?.message ?? error}`)
    continue
  }
  const ok = stable(back.blocks) === stable(blocks)
  if (ok) schemaLoadPass += 1
  check(`[스키마적재] ${label} — noteSchema 적재 후 동형`, ok, `복원=${stable(back.blocks).slice(0, 300)}`)
}
console.log(`  실제 스키마 적재 왕복: ${schemaLoadPass}/${ADAPTER.length}`)

// 스키마 팔레트에 toc·webEmbed가 실제로 있는가(등재 자체를 못 박는다 — 이 검사가 없으면 위 루프가
// try/catch로 조용히 통과할 위험이 있다).
{
  const blockTypes = Object.keys(noteSchema.blockSchema).sort()
  check('[스키마적재] noteSchema에 toc 등재', blockTypes.includes('toc'), `팔레트=${blockTypes.join(',')}`)
  check('[스키마적재] noteSchema에 webEmbed 등재', blockTypes.includes('webEmbed'), `팔레트=${blockTypes.join(',')}`)
}
mark('④ 어댑터 왕복(meta prop·사이드카 불요·noteSchema 적재)')

// ---------------------------------------------------------------- ⑤ 실문서 코퍼스(읽기 전용)

const CANDIDATES = [process.argv[2], path.resolve(FRONT, '../study.db')].filter(Boolean)
const DB_PATH = CANDIDATES.find((p) => fs.existsSync(p))

let surfaces = []
if (DB_PATH) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 's37-'))
  const tmpDb = path.join(tmpDir, 'study.db')
  try {
    for (const suffix of ['', '-wal', '-shm']) {
      if (fs.existsSync(`${DB_PATH}${suffix}`)) fs.copyFileSync(`${DB_PATH}${suffix}`, `${tmpDb}${suffix}`)
    }
    const db = new DatabaseSync(tmpDb, { readOnly: true })
    const cols = db.prepare('PRAGMA table_info(documents)').all().map((c) => c.name)
    const where = cols.includes('is_active') ? ' WHERE is_active = 1' : ''
    const rows = db.prepare(`SELECT doc_no, content, explanation FROM documents${where}`).all()
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

if (surfaces.length === 0) {
  console.log(`study.db를 찾지 못해 ⑤(실문서)를 건너뜁니다. (후보: ${CANDIDATES.join(' · ')})`)
} else {
  let dialectDocs = 0
  let leafColonDocs = 0
  let newBlocks = 0
  let fixedPoint = 0
  for (const surface of surfaces) {
    if (/^::(toc|web)\b/m.test(surface.md)) dialectDocs += 1
    // 줄머리 `::이름` 표기 전수(신규 방언 인접 표기의 실측 — 이스케이프 규칙 확장 판단 근거).
    if (/^::[A-Za-z]/m.test(surface.md)) leafColonDocs += 1
    const doc = markdownToBlocks(surface.md)
    const counts = countTypes(doc.blocks)
    newBlocks += counts.toc + counts.webEmbed
    const md1 = blocksToMarkdown(doc)
    if (md1 === blocksToMarkdown(markdownToBlocks(md1))) fixedPoint += 1
  }
  check(`[실문서] 신규 방언(::toc·::web) 부재`, dialectDocs === 0, `발견=${dialectDocs}표면`)
  check(`[실문서] 신규 블록 산출 0 (= 기존 문서 변환 diff 0)`, newBlocks === 0, `산출=${newBlocks}`)
  check(`[실문서] 프로젝션 고정점 전건`, fixedPoint === surfaces.length, `${fixedPoint}/${surfaces.length}`)
  console.log(`  실문서 표면 ${surfaces.length}건 · 줄머리 \`::이름\` 표기 ${leafColonDocs}표면`)
}
mark('⑤ 실문서 코퍼스(신규 방언 부재·diff 0)')

// ---------------------------------------------------------------- 결과

console.log('')
for (const section of sections) console.log(`계열 ${section.label}: ${section.count}건`)
console.log(`총 ${pass + fail}건 · 통과 ${pass} · 실패 ${fail}`)
if (fail) {
  console.log('실패 목록:')
  for (const line of failures) console.log(`  - ${line}`)
  process.exit(1)
}
