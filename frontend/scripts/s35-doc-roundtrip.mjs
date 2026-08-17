// S35(M34) documents 전환 왕복 검증 — stage-35 F-7(+ F-4 블록 id 충돌 재점검).
//
// 실행: node frontend/scripts/s35-doc-roundtrip.mjs [db경로]
//
// 검사하는 것 = **화면이 실제로 밟는 경로 그대로**(DocBlockEditor/BlockSurface):
//   ① 미전환 문서 로드→저장 : content → markdownToBlocks → toBlockNoteBlocks(+사이드카)
//                              → **실제 noteSchema** 적재·되읽기 → fromBlockNoteResult(사이드카)
//                              → 블록 동등(id 제외) + 프로젝션이 원본과 **M32 정규형 동등**
//                              + **조용한 손실 0**(unsupported·microMarkCollapses·tableAlignDrops 0)
//   ② 전환 문서 재로드      : ①이 저장했을 블록을 다시 열어 같은 왕복 — **id까지 보존**되고
//                              프로젝션이 1바이트도 바뀌지 않는가(두 번째 저장이 본문을 흔들지 않음)
//   ③ 사이드카 결선 대조    : 사이드카를 빼고 저장하면 **실제로 달라지는 실문서가 존재**하는가
//                              (규약 D 위반이 즉시 가시 변형이라는 사실의 실측 — 0건이면 이 검사가
//                               경고를 낸다: 대조가 성립하지 않으면 결선 회귀를 잡지 못한다)
//   ④ F-4 블록 id 충돌      : 문서 안 id 유일성 · **본문/해설 두 표면의 id 겹침** 실측 ·
//                              사이드카를 두 표면이 **공유하면** 실제로 오염이 나는가(분리 근거)
//
// **읽기 전용** — DB에 단 한 바이트도 쓰지 않는다(임시 복사본을 열고 끝나면 지운다 — s32/s35
// 관례 계승). 신규 의존 0(node:sqlite 내장 · jiti·typescript·@blocknote/server-util은 기존 devDep).
import Module, { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { ServerBlockNoteEditor } from '@blocknote/server-util'
import { stable, stripIds, makeNormalize } from './s32-normalize.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FRONT = path.resolve(HERE, '..')
const SRC = path.join(FRONT, 'src')

// `@blocknote/math-block`이 CJS 엔트리에서 katex CSS를 require한다 — 스크립트 전용 스텁(s33 전례).
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

const { markdownToBlocks, blocksToMarkdown, parseToMdast } = jiti(path.join(SRC, 'editor2/transform/index.ts'))
const { toBlockNoteBlocks, fromBlockNoteResult, describeUnsupported } = jiti(path.join(SRC, 'editor2/adapter/index.ts'))
const { noteSchema, asEditorBlocks, asAdapterBlocks } = jiti(path.join(SRC, 'editor2/blocknote/schema.ts'))

const normalize = makeNormalize(parseToMdast)
const server = ServerBlockNoteEditor.create({ schema: noteSchema })

/** 편집기 적재·되읽기 — 화면의 BlockNote 인스턴스가 하는 정규화를 그대로 통과시킨다. */
function throughSchema(blocks) {
  const pmNode = server._blocksToProsemirrorNode(asEditorBlocks(blocks))
  return asAdapterBlocks(server._prosemirrorNodeToBlocks(pmNode))
}

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

// ---------------------------------------------------------------- 실문서 적재(읽기 전용)
const CANDIDATES = [
  process.argv[2],
  path.resolve(FRONT, '../study.db'),
  path.resolve(FRONT, '../../../../study.db'),
].filter(Boolean)
const DB_PATH = CANDIDATES.find((p) => fs.existsSync(p))
if (!DB_PATH) {
  console.log(`study.db를 찾지 못했습니다 — 건너뜁니다. (후보: ${CANDIDATES.join(' · ')})`)
  process.exit(0)
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 's35-doc-'))
const tmpDb = path.join(tmpDir, 'study.db')
for (const suffix of ['', '-wal', '-shm']) {
  if (fs.existsSync(`${DB_PATH}${suffix}`)) fs.copyFileSync(`${DB_PATH}${suffix}`, `${tmpDb}${suffix}`)
}

let rows = []
try {
  const db = new DatabaseSync(tmpDb, { readOnly: true })
  const cols = db.prepare('PRAGMA table_info(documents)').all().map((c) => c.name)
  const where = cols.includes('is_active') ? ' WHERE is_active = 1' : ''
  rows = db.prepare(`SELECT id, doc_no, type, content, explanation FROM documents${where}`).all()
  db.close()
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true })
}

/** 표면 단위 검사 대상 — 화면의 본문·해설 2표면과 1:1이다. */
const surfaces = []
for (const row of rows) {
  if (typeof row.content === 'string' && row.content.trim() !== '') {
    surfaces.push({ label: `${row.doc_no}#content`, docNo: row.doc_no, kind: 'content', md: row.content })
  }
  if (typeof row.explanation === 'string' && row.explanation.trim() !== '') {
    surfaces.push({ label: `${row.doc_no}#explanation`, docNo: row.doc_no, kind: 'explanation', md: row.explanation })
  }
}

console.log(`DB: ${DB_PATH} (읽기 전용 임시 복사본 — 원본 무변경)`)
console.log(`문서 ${rows.length}건 · 편집 표면 ${surfaces.length}건`)

// ---------------------------------------------------------------- ① 미전환 문서 로드 → 저장
console.log('== ① 미전환 문서: md → 블록 → BN 적재·되읽기(사이드카) → 블록 → 프로젝션 ==')

const saved = new Map() // label → { blocks(앱 블록 문서), md(프로젝션) } — ②·③·④가 재사용
let fallbackCount = 0
const fallbackKinds = new Map()

for (const surface of surfaces) {
  const doc1 = markdownToBlocks(surface.md)
  const { blocks: bn, unsupported, sidecar } = toBlockNoteBlocks(doc1)

  // 미지원 보고 = 구 편집기 퇴로(F-1 게이트와 같은 계약) — 전수 0이어야 새 표면이 열린다.
  check(
    `[폴백0] ${surface.label}`,
    unsupported.length === 0,
    unsupported.length > 0 ? describeUnsupported(unsupported) : '',
  )
  if (unsupported.length > 0) {
    fallbackCount += 1
    for (const issue of unsupported) fallbackKinds.set(issue.kind, (fallbackKinds.get(issue.kind) ?? 0) + 1)
    continue
  }

  let result
  try {
    result = fromBlockNoteResult(throughSchema(bn), sidecar)
  } catch (error) {
    check(`[적재] ${surface.label}`, false, `적재 실패: ${error?.message ?? error}`)
    continue
  }

  // ⓐ 블록 동등(id 제외) — 편집기를 한 바퀴 돌아도 앱 블록이 그대로다.
  const want = stable(stripIds(doc1.blocks))
  const got = stable(stripIds(result.document.blocks))
  check(`[블록동등] ${surface.label}`, want === got, want === got ? '' : `원본=${want.slice(0, 300)} 왕복=${got.slice(0, 300)}`)

  // ⓑ 프로젝션 정규형 동등(M32 N) — 저장되는 Markdown이 원본과 같은 뜻인가.
  const md2 = blocksToMarkdown(result.document)
  const a = stable(normalize(surface.md))
  const b = stable(normalize(md2))
  check(`[정규형] ${surface.label}`, a === b, a === b ? '' : `원본N=${a.slice(0, 300)} 저장N=${b.slice(0, 300)}`)

  // ⓒ 조용한 손실 0 — 사용자가 아무것도 편집하지 않은 로드→저장에서 접힘·폐기가 나오면 안 된다.
  check(
    `[무손실] ${surface.label}`,
    result.microMarkCollapses.length === 0 && result.tableAlignDrops.length === 0,
    `마이크로마크접힘=${result.microMarkCollapses.join(',')} 표정렬폐기=${result.tableAlignDrops.length}`,
  )

  saved.set(surface.label, { blocks: result.document, md: md2 })
}
mark('① 미전환 로드→저장 왕복')

// ---------------------------------------------------------------- ② 전환 문서 재로드
console.log('== ② 전환 문서 재로드: 저장된 블록 → BN 적재·되읽기 → 블록/프로젝션 불변 ==')

for (const surface of surfaces) {
  const first = saved.get(surface.label)
  if (!first) continue
  const { blocks: bn, unsupported, sidecar } = toBlockNoteBlocks(first.blocks)
  check(`[재로드-폴백0] ${surface.label}`, unsupported.length === 0, describeUnsupported(unsupported))
  if (unsupported.length > 0) continue

  let result
  try {
    result = fromBlockNoteResult(throughSchema(bn), sidecar)
  } catch (error) {
    check(`[재로드-적재] ${surface.label}`, false, `적재 실패: ${error?.message ?? error}`)
    continue
  }
  // 전환 문서는 블록이 소스 오브 트루스다 — **id까지** 그대로 돌아와야 사이드카 키가 유지된다.
  const want = stable(first.blocks.blocks)
  const got = stable(result.document.blocks)
  check(`[재로드-동등] ${surface.label}`, want === got, want === got ? '' : `1차=${want.slice(0, 300)} 2차=${got.slice(0, 300)}`)
  const md2 = blocksToMarkdown(result.document)
  check(`[재로드-고정점] ${surface.label}`, md2 === first.md, md2 === first.md ? '' : '두 번째 저장의 프로젝션이 달라졌다')
}
mark('② 전환 문서 재로드 왕복')

// ---------------------------------------------------------------- ③ 사이드카 결선 대조
console.log('== ③ 사이드카 결선 대조: 사이드카를 빼면 실제로 달라지는 실문서가 있는가 ==')

let sidecarSensitive = 0
const sidecarSamples = []
for (const surface of surfaces) {
  const doc1 = markdownToBlocks(surface.md)
  const { blocks: bn, unsupported, sidecar } = toBlockNoteBlocks(doc1)
  if (unsupported.length > 0) continue
  if (Object.keys(sidecar).length === 0) continue
  const loaded = throughSchema(bn)
  const withSidecar = stable(fromBlockNoteResult(loaded, sidecar).document.blocks)
  const without = stable(fromBlockNoteResult(loaded, {}).document.blocks)
  if (withSidecar !== without) {
    sidecarSensitive += 1
    if (sidecarSamples.length < 5) sidecarSamples.push(surface.label)
  }
}
console.log(
  `  사이드카 유무로 저장 결과가 달라지는 표면: ${sidecarSensitive}건${
    sidecarSamples.length ? ` (예: ${sidecarSamples.join(' · ')})` : ''
  }`,
)
check(
  '[사이드카] 결선 누락이 실제 변형으로 이어지는 실문서가 존재한다(대조가 성립)',
  sidecarSensitive > 0,
  '대조 표본 0건 — 이 검사로는 결선 회귀를 잡을 수 없다(실DB 표본을 확인할 것)',
)
mark('③ 사이드카 결선 대조')

// ---------------------------------------------------------------- ④ F-4 블록 id 충돌 재점검
console.log('== ④ 블록 id 충돌 재점검(인계 9 · F-4) ==')

function collectIds(blocks, out = []) {
  for (const block of blocks) {
    if (block.id !== undefined) out.push(block.id)
    if (block.children?.length) collectIds(block.children, out)
  }
  return out
}

// ⓐ 한 표면 안에서 변환기 id는 유일한가(`nextId`는 seq 증가 — 같은 문서 안 충돌 0이 전제).
let dupInside = 0
for (const surface of surfaces) {
  const ids = collectIds(markdownToBlocks(surface.md).blocks)
  const unique = new Set(ids)
  if (ids.length !== unique.size) dupInside += 1
}
check('[id] 한 표면 안에서 변환기 발급 id는 전수 유일', dupInside === 0, `중복 표면=${dupInside}건`)

// ⓑ 본문·해설 **두 표면**은 각각 b1부터 발급하므로 id가 겹친다 — documents에서 새로 생긴 구도다.
//    (노트는 표면이 1개라 이 구도가 없었다.) 겹침 자체는 정상이며, 위험은 "사이드카를 두 표면이
//    공유할 때"만 생긴다. 그래서 화면은 **표면마다 사이드카를 따로** 들고 있다(BlockSurface).
let crossPairs = 0
let crossOverlap = 0
const overlapSamples = []
for (const row of rows) {
  const c = typeof row.content === 'string' && row.content.trim() !== '' ? row.content : null
  const e = typeof row.explanation === 'string' && row.explanation.trim() !== '' ? row.explanation : null
  if (!c || !e) continue
  crossPairs += 1
  const contentIds = new Set(collectIds(markdownToBlocks(c).blocks))
  const explIds = collectIds(markdownToBlocks(e).blocks)
  if (explIds.some((id) => contentIds.has(id))) {
    crossOverlap += 1
    if (overlapSamples.length < 5) overlapSamples.push(row.doc_no)
  }
}
console.log(
  `  본문·해설이 함께 있는 문서 ${crossPairs}건 중 두 표면의 블록 id가 겹치는 문서: ${crossOverlap}건${
    overlapSamples.length ? ` (예: ${overlapSamples.join(' · ')})` : ''
  }`,
)

// ⓒ **오염 재현** — 두 표면이 사이드카를 공유하면 실제로 잘못된 값이 붙는가.
//    붙으면(1건 이상) "표면별 분리"가 선택이 아니라 필수임이 실측으로 고정된다.
let contaminated = 0
const contaminatedSamples = []
for (const row of rows) {
  const c = typeof row.content === 'string' && row.content.trim() !== '' ? row.content : null
  const e = typeof row.explanation === 'string' && row.explanation.trim() !== '' ? row.explanation : null
  if (!c || !e) continue
  const contentDoc = markdownToBlocks(c)
  const explDoc = markdownToBlocks(e)
  const contentSide = toBlockNoteBlocks(contentDoc)
  const explSide = toBlockNoteBlocks(explDoc)
  if (contentSide.unsupported.length > 0 || explSide.unsupported.length > 0) continue
  const shared = { ...contentSide.sidecar, ...explSide.sidecar }
  const isolated = stable(fromBlockNoteResult(throughSchema(contentSide.blocks), contentSide.sidecar).document.blocks)
  const mixed = stable(fromBlockNoteResult(throughSchema(contentSide.blocks), shared).document.blocks)
  if (isolated !== mixed) {
    contaminated += 1
    if (contaminatedSamples.length < 5) contaminatedSamples.push(row.doc_no)
  }
}
console.log(
  `  사이드카를 두 표면이 공유했을 때 본문 저장 결과가 오염되는 문서: ${contaminated}건${
    contaminatedSamples.length ? ` (예: ${contaminatedSamples.join(' · ')})` : ''
  }`,
)

// ⓓ 편집기가 새로 만드는 id는 변환기 id와 형태가 다르다(BlockNote 기본 = UUID v4, 붙여넣기 =
//    `pasted-…` — s34-paste-check가 고정). 저장분을 다시 열 때 사이드카 키가 어긋나지 않으려면
//    **저장된 id가 그대로 돌아와야** 한다 — ②의 [재로드-동등]이 그것을 전수로 못박는다.
check(
  '[id] 전환 문서 재로드에서 저장 id가 보존된다(②가 전수 확인 — 사이드카 키 정합의 전제)',
  saved.size > 0,
  '재로드 표본 0건',
)
mark('④ 블록 id 충돌 재점검')

// ---------------------------------------------------------------- 보고
console.log('')
for (const section of sections) console.log(`  ${section.label}: ${section.count}건`)
console.log(`총 검사 ${pass + fail}건 · 실패 ${fail}건 (폴백 문서 ${fallbackCount}건)`)
if (fallbackKinds.size > 0) {
  console.log(`  폴백 사유: ${[...fallbackKinds].map(([k, v]) => `${k}=${v}`).join(' · ')}`)
}
if (failures.length > 0) {
  console.log('실패 목록:')
  for (const line of failures.slice(0, 30)) console.log(`  - ${line}`)
  if (failures.length > 30) console.log(`  … 외 ${failures.length - 30}건`)
  process.exit(1)
}
console.log('OK — documents 전환 왕복 실패 0')
