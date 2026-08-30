// 프론트 빌드 최신 여부 판정 — 소스 해시(단일 출처).
//
// FastAPI는 `frontend/dist`를 그대로 서빙하므로 dist가 소스보다 오래되면 "서버는 새것, 화면은 옛것"이
// 된다. 종전 `Dev_StartServer.bat`의 mtime 비교는 git 체크아웃/pull이 파일 시각을 통째로 바꿔 신뢰할 수
// 없었다(2026-08-30). 대신 **빌드에 들어가는 입력 파일의 내용 해시**를 `dist/.source-hash`에 남기고
// (`npm run build`의 `postbuild`), 시작 스크립트가 다시 계산해 비교한다. 줄끝은 LF로 정규화해
// autocrlf 설정이 다른 PC에서도 같은 해시가 나온다.
//
//   node scripts/source-hash.mjs --check   → exit 0 최신 / 1 빌드 없음 / 2 소스 변경(빌드 필요)
//   node scripts/source-hash.mjs --write   → dist/.source-hash 기록(빌드 직후)
//   node scripts/source-hash.mjs --print   → 해시만 출력
//
// 입력 = vite/tsc가 읽는 것 전부: src/**, public/**(vite가 dist로 복사), index.html, package.json,
// package-lock.json, vite/tsconfig/tailwind/postcss 설정. dist·node_modules·scripts는 제외.
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const FRONTEND = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(FRONTEND, 'dist')
const STAMP = join(DIST, '.source-hash')
const INPUT_DIRS = ['src', 'public']
const INPUT_FILES = [
  'index.html',
  'package.json',
  'package-lock.json',
  'vite.config.ts',
  'tsconfig.json',
  'tsconfig.app.json',
  'tsconfig.node.json',
  'tailwind.config.js',
  'postcss.config.js',
]

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

export function computeSourceHash() {
  const files = []
  for (const d of INPUT_DIRS) {
    const p = join(FRONTEND, d)
    if (existsSync(p)) walk(p, files)
  }
  for (const f of INPUT_FILES) {
    const p = join(FRONTEND, f)
    if (existsSync(p)) files.push(p)
  }
  const rel = files.map((p) => relative(FRONTEND, p).replace(/\\/g, '/')).sort()
  const h = createHash('sha256')
  for (const r of rel) {
    h.update(r)
    h.update('\0')
    h.update(readFileSync(join(FRONTEND, r)).toString('latin1').replace(/\r\n/g, '\n'), 'latin1')
    h.update('\0')
  }
  return { hash: h.digest('hex'), count: rel.length }
}

const mode = process.argv[2] ?? '--check'
const { hash, count } = computeSourceHash()

if (mode === '--print') {
  console.log(hash)
} else if (mode === '--write') {
  if (!existsSync(DIST)) {
    console.error('[source-hash] dist/ not found - build first')
    process.exit(1)
  }
  writeFileSync(STAMP, hash + '\n')
  console.log(`[source-hash] recorded ${hash.slice(0, 12)} (${count} input files)`)
} else if (mode === '--check') {
  if (!existsSync(join(DIST, 'index.html'))) {
    console.log('[source-hash] no build (dist/index.html missing)')
    process.exit(1)
  }
  const recorded = existsSync(STAMP) ? readFileSync(STAMP, 'utf8').trim() : ''
  if (recorded === hash) {
    console.log(`[source-hash] build is up to date (${hash.slice(0, 12)})`)
    process.exit(0)
  }
  console.log(
    recorded
      ? `[source-hash] source changed since last build (${recorded.slice(0, 12)} -> ${hash.slice(0, 12)})`
      : '[source-hash] no build stamp - build needed to record one',
  )
  process.exit(2)
} else {
  console.error(`usage: node scripts/source-hash.mjs [--check|--write|--print]`)
  process.exit(64)
}
