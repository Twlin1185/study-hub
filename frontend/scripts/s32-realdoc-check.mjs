// S32 보조 검증 — **실문서 왕복**(stage-32 4-3/4-4. 게이트 아님, 보고용).
//
// 실행: node frontend/scripts/s32-realdoc-check.mjs [db경로]
//
// `study.db`의 `documents.content` / `documents.explanation` 전건을 md→블록→md 왕복시켜
//   ① 정규형 동등(s32-roundtrip-blocks.mjs와 같은 계약) ② 고정점 ③ fallback 발생 건수
// 를 집계한다. **읽기 전용이다 — DB에 단 한 바이트도 쓰지 않는다**(파일 잠금·WAL 초기화까지
// 피하려고 임시 복사본을 열고, 끝나면 지운다). 신규 prod 의존 0(node:sqlite 내장).
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { stable, countFallbacks, makeNormalize } from './s32-normalize.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FRONT = path.resolve(HERE, '..')
const require = createRequire(path.join(FRONT, 'package.json'))
const jiti = require('jiti')(path.join(FRONT, 'scripts/_loader.cjs'), {
  interopDefault: true,
  esmResolve: true,
  cache: false,
  requireCache: false,
})
const { markdownToBlocks, blocksToMarkdown, parseToMdast } = jiti(
  path.join(FRONT, 'src/editor2/transform/index.ts'),
)
const normalize = makeNormalize(parseToMdast)

// 워크트리에는 DB가 없다 — 인자 > 워크트리 루트 > 원본 체크아웃 순으로 찾는다.
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
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 's32-db-'))
const tmpDb = path.join(tmpDir, 'study.db')
for (const suffix of ['', '-wal', '-shm']) {
  if (fs.existsSync(`${DB_PATH}${suffix}`)) fs.copyFileSync(`${DB_PATH}${suffix}`, `${tmpDb}${suffix}`)
}

let rows = []
try {
  const db = new DatabaseSync(tmpDb, { readOnly: true })
  rows = db.prepare('SELECT id, doc_no, content, explanation FROM documents').all()
  db.close()
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true })
}

const texts = []
for (const row of rows) {
  if (typeof row.content === 'string' && row.content.trim() !== '') texts.push([`${row.doc_no}#content`, row.content])
  if (typeof row.explanation === 'string' && row.explanation.trim() !== '') {
    texts.push([`${row.doc_no}#explanation`, row.explanation])
  }
}

let normOk = 0
let fixedOk = 0
let fallbackTexts = 0
let fallbackNodes = 0
const fallbackTypes = new Map()
const failures = []

for (const [label, src] of texts) {
  const doc1 = markdownToBlocks(src)
  const md1 = blocksToMarkdown(doc1)
  const md2 = blocksToMarkdown(markdownToBlocks(md1))
  const okNorm = stable(normalize(src)) === stable(normalize(md1))
  const okFixed = md1 === md2
  if (okNorm) normOk += 1
  if (okFixed) fixedOk += 1
  if (!okNorm || !okFixed) failures.push(`${label} — 정규형=${okNorm} 고정점=${okFixed}`)
  const counts = countFallbacks(doc1.blocks)
  const total = counts.block + counts.inline
  if (total > 0) {
    fallbackTexts += 1
    fallbackNodes += total
    for (const [type, n] of counts.types) fallbackTypes.set(type, (fallbackTypes.get(type) ?? 0) + n)
  }
}

console.log(`DB: ${DB_PATH} (읽기 전용 임시 복사본으로 조회 — 원본 무변경)`)
console.log(`문서 ${rows.length}건 · 검사 텍스트 ${texts.length}건`)
console.log(`  정규형 동등: ${normOk}/${texts.length} · 고정점: ${fixedOk}/${texts.length}`)
console.log(
  `  fallback 발생 텍스트 ${fallbackTexts}건 / 노드 ${fallbackNodes}개 (${[...fallbackTypes].map(([k, v]) => `${k}=${v}`).join(' · ') || '없음'})`,
)
if (failures.length) {
  console.log('동등 실패 목록:')
  for (const line of failures.slice(0, 30)) console.log(`  - ${line}`)
  if (failures.length > 30) console.log(`  … 외 ${failures.length - 30}건`)
  process.exit(1)
}
