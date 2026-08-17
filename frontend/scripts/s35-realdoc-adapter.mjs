// S35 실측 — stage-35(M34 `documents` 탑재) 착수 판정용 **실문서 어댑터 통과율** 조사.
// 구현 스크립트가 아니다 — 측정과 보고가 목적이다(어댑터 코드는 절대 수정하지 않는다. 호출만 한다).
//
// 실행: node frontend/scripts/s35-realdoc-adapter.mjs [db경로]
//
// `study.db`의 `documents.content` / `documents.explanation` 전건을
//   markdownToBlocks(md) → 앱 블록 문서 → toBlockNoteBlocks(doc) → { unsupported }
// 로 태워, 현재 계약(unsupported.length > 0 = 읽기 전용 폴백)에서 몇 건이 폴백으로
// 떨어지는지, 그리고 사유 코드별로 얼마나 걸리는지를 집계한다.
//
// **읽기 전용** — DB에 단 한 바이트도 쓰지 않는다(s32-realdoc-check.mjs 관례 계승: 임시
// 복사본을 열고 끝나면 지운다 — WAL/-shm 초기화 부작용까지 0). 신규 prod 의존 0
// (node:sqlite 내장). devDependency 추가도 없다.
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FRONT = path.resolve(HERE, '..')
const require = createRequire(path.join(FRONT, 'package.json'))
const jiti = require('jiti')(path.join(FRONT, 'scripts/_loader.cjs'), {
  interopDefault: true,
  esmResolve: true,
  cache: false,
  requireCache: false,
})
const { markdownToBlocks } = jiti(path.join(FRONT, 'src/editor2/transform/index.ts'))
const { toBlockNoteBlocks } = jiti(path.join(FRONT, 'src/editor2/adapter/index.ts'))

// 판정 대기 3종(R34) — 나머지는 "그 외" 버킷으로 집계한다.
const JUDGED_KINDS = ['listItem:spread', 'listItem:groupBreak', 'table:align']

// 워크트리에는 DB가 없다 — 인자 > 워크트리 루트 > 원본 체크아웃 순으로 찾는다(s32 관례 계승).
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

// 원본을 절대 열지 않는다: 임시 복사본만 읽는다(WAL/-shm 부작용 0).
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 's35-db-'))
const tmpDb = path.join(tmpDir, 'study.db')
for (const suffix of ['', '-wal', '-shm']) {
  if (fs.existsSync(`${DB_PATH}${suffix}`)) fs.copyFileSync(`${DB_PATH}${suffix}`, `${tmpDb}${suffix}`)
}

let rows = []
let hasIsActive = true
try {
  const db = new DatabaseSync(tmpDb, { readOnly: true })
  const cols = db.prepare("PRAGMA table_info(documents)").all().map((c) => c.name)
  hasIsActive = cols.includes('is_active')
  const selectCols = ['id', 'doc_no', 'title', 'content', 'explanation']
  if (hasIsActive) selectCols.push('is_active')
  rows = db.prepare(`SELECT ${selectCols.join(', ')} FROM documents`).all()
  db.close()
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true })
}

if (rows.length === 0) {
  console.log(`DB: ${DB_PATH} — documents 0건 (건너뜁니다)`)
  process.exit(0)
}

// 텍스트 필드 단위로 펼친다. active/inactive 구분(is_active 컬럼이 없으면 전부 active로 간주).
const texts = [] // { docId, docNo, title, field, active, src }
for (const row of rows) {
  const active = hasIsActive ? Number(row.is_active) !== 0 : true
  if (typeof row.content === 'string' && row.content.trim() !== '') {
    texts.push({ docId: row.id, docNo: row.doc_no, title: row.title, field: 'content', active, src: row.content })
  }
  if (typeof row.explanation === 'string' && row.explanation.trim() !== '') {
    texts.push({ docId: row.id, docNo: row.doc_no, title: row.title, field: 'explanation', active, src: row.explanation })
  }
}

// 문서 단위 집계(문서 = docId). 텍스트 필드 중 하나라도 걸리면 그 문서는 폴백.
const docKindSet = new Map() // docId -> Set(kind)
const docMeta = new Map() // docId -> { docNo, title, active }
const kindOccurrences = new Map() // kind -> count(건수, 텍스트필드 단위 발생 수)
const kindDocs = new Map() // kind -> Set(docId)
const errors = [] // 변환 중 예외

let activeTexts = 0
let inactiveTexts = 0
let activeDocsSeen = new Set()
let inactiveDocsSeen = new Set()

for (const t of texts) {
  if (t.active) {
    activeTexts += 1
    activeDocsSeen.add(t.docId)
  } else {
    inactiveTexts += 1
    inactiveDocsSeen.add(t.docId)
  }
  docMeta.set(t.docId, { docNo: t.docNo, title: t.title, active: t.active })

  let unsupported = []
  try {
    const doc = markdownToBlocks(t.src)
    const result = toBlockNoteBlocks(doc)
    unsupported = result.unsupported ?? []
  } catch (err) {
    errors.push(`${t.docNo}#${t.field} — 변환 예외: ${err?.message ?? err}`)
    continue
  }

  if (unsupported.length === 0) continue

  if (!docKindSet.has(t.docId)) docKindSet.set(t.docId, new Set())
  const kindSet = docKindSet.get(t.docId)

  for (const issue of unsupported) {
    const kind = issue.kind ?? '(unknown)'
    kindSet.add(kind)
    kindOccurrences.set(kind, (kindOccurrences.get(kind) ?? 0) + 1)
    if (!kindDocs.has(kind)) kindDocs.set(kind, new Set())
    kindDocs.get(kind).add(t.docId)
  }
}

// 문서 수 집계(활성/비활성 구분)
const activeDocs = [...activeDocsSeen]
const inactiveDocs = [...inactiveDocsSeen]
const allDocIdsWithText = new Set([...activeDocsSeen, ...inactiveDocsSeen])

function fallbackDocIds(kindFilter) {
  const out = []
  for (const [docId, kinds] of docKindSet) {
    const relevant = kindFilter ? [...kinds].filter((k) => kindFilter.has(k)) : [...kinds]
    if (relevant.length > 0) out.push(docId)
  }
  return out
}

const allFallbackDocs = fallbackDocIds(null)
const judgedSet = new Set(JUDGED_KINDS)
// "판정 3종만 제거"했을 때 남는 폴백 문서 = 판정 3종 외의 사유로도 걸린 문서.
const remainingAfterRemovingJudged = []
for (const [docId, kinds] of docKindSet) {
  const others = [...kinds].filter((k) => !judgedSet.has(k))
  if (others.length > 0) remainingAfterRemovingJudged.push(docId)
}

function splitActiveInactive(docIds) {
  let a = 0
  let i = 0
  for (const id of docIds) {
    if (activeDocsSeen.has(id)) a += 1
    else if (inactiveDocsSeen.has(id)) i += 1
  }
  return { active: a, inactive: i }
}

const allFallbackSplit = splitActiveInactive(allFallbackDocs)
const remainingSplit = splitActiveInactive(remainingAfterRemovingJudged)

// 표본: 판정 3종에 걸린 문서 중 최대 10건.
const sampleDocIds = []
for (const [docId, kinds] of docKindSet) {
  const judgedHit = [...kinds].filter((k) => judgedSet.has(k))
  if (judgedHit.length > 0) sampleDocIds.push({ docId, judgedHit })
  if (sampleDocIds.length >= 10) break
}

function snippetFor(docId, kinds) {
  // 해당 docId의 텍스트 중 하나에서 짧은 조각을 뽑는다(있는 그대로 — 가공 없음, 길이만 제한).
  const t = texts.find((x) => x.docId === docId)
  if (!t) return ''
  const lines = t.src.split(/\r?\n/).filter((l) => l.trim() !== '')
  return lines.slice(0, 2).join(' / ').slice(0, 120)
}

// ------------------------------------------------------------------ 출력
console.log(`DB: ${DB_PATH} (읽기 전용 임시 복사본으로 조회 — 원본 무변경)`)
console.log(`documents 전체 ${rows.length}건`)
console.log(
  `  텍스트 필드: 활성 ${activeTexts}건(문서 ${activeDocs.length}개) · 비활성 ${inactiveTexts}건(문서 ${inactiveDocs.length}개)` +
    (hasIsActive ? '' : ' (is_active 컬럼 없음 — 전부 활성으로 간주)'),
)
console.log('')

const fallbackPct = allDocIdsWithText.size > 0 ? ((allFallbackDocs.length / allDocIdsWithText.size) * 100).toFixed(1) : '0.0'
console.log(
  `unsupported 1건 이상(= 읽기 전용 폴백) 문서: ${allFallbackDocs.length}/${allDocIdsWithText.size}건 (${fallbackPct}%)` +
    ` — 활성 ${allFallbackSplit.active}건 · 비활성 ${allFallbackSplit.inactive}건`,
)
console.log('')

console.log('사유 코드별 집계 (판정 3종 우선, 그 외는 발생 순):')
const orderedKinds = [...JUDGED_KINDS, ...[...kindOccurrences.keys()].filter((k) => !judgedSet.has(k))]
for (const kind of orderedKinds) {
  const occ = kindOccurrences.get(kind) ?? 0
  const docs = kindDocs.get(kind)?.size ?? 0
  const tag = judgedSet.has(kind) ? '[판정 3종]' : '[기타]'
  console.log(`  ${tag} ${kind} — 발생 ${occ}건 · 영향 문서 ${docs}개`)
}
console.log('')

console.log('판정 3종 제거 가정(= 손실 수용 시) 폴백 문서 변화:')
console.log(`  제거 전: ${allFallbackDocs.length}건 (활성 ${allFallbackSplit.active} · 비활성 ${allFallbackSplit.inactive})`)
console.log(
  `  제거 후: ${remainingAfterRemovingJudged.length}건 (활성 ${remainingSplit.active} · 비활성 ${remainingSplit.inactive})` +
    ` — 판정 3종만으로 폴백되던 문서 ${allFallbackDocs.length - remainingAfterRemovingJudged.length}건 해소`,
)
console.log('')

console.log(`판정 3종 표본(최대 10건):`)
if (sampleDocIds.length === 0) {
  console.log('  없음')
} else {
  for (const { docId, judgedHit } of sampleDocIds) {
    const meta = docMeta.get(docId)
    console.log(
      `  - ${meta.docNo} "${meta.title}" [${meta.active ? '활성' : '비활성'}] — 사유: ${judgedHit.join(', ')}`,
    )
    console.log(`      조각: ${snippetFor(docId, judgedHit)}`)
  }
}

if (errors.length > 0) {
  console.log('')
  console.log(`변환 예외(스크립트 진행에는 영향 없음, 해당 텍스트만 집계 제외) ${errors.length}건:`)
  for (const e of errors.slice(0, 20)) console.log(`  - ${e}`)
  if (errors.length > 20) console.log(`  … 외 ${errors.length - 20}건`)
}
