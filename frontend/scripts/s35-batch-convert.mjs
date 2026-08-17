// S35(M34) documents 배치 변환 — stage-35 F-5. **사용자가 손으로 실행하는 도구다.**
//
//   node frontend/scripts/s35-batch-convert.mjs                 # 드라이런(기본 — 아무것도 쓰지 않는다)
//   node frontend/scripts/s35-batch-convert.mjs --apply         # 실제 PATCH(전환 저장)
//   … --base http://localhost:8000  --ids 12,15  --limit 20  --content-only  --verbose
//
// 규약(지시서 F-5 · 규약 E · api §4.29 ③):
//   · **API 경유만** — 변환기(M32)는 프런트에만 있다. 서버에 변환기를 재구현하지 않는다.
//   · **드라이런이 기본** — `--apply`를 명시해야만 쓴다. 서버 기동·앱 로드·마이그레이션 어디에도
//     결선하지 않는다(R36 일괄 자동 변환 금지). 이 파일을 부르는 코드는 저장소에 0개다.
//   · **문서별 성공/실패(사유) 목록**을 출력하고, 실패는 건드리지 않는다(그 문서는 구 편집기 퇴로).
//
// 안전장치(변환이 본문을 바꾸면 쓰지 않는다):
//   ① 어댑터가 미지원을 보고하면 건너뛴다(= 화면에서도 구 편집기로 열리는 문서다)
//   ② 화면과 **같은 경로**로 만든다: md → 블록 → BN(실제 noteSchema) 적재·되읽기 → 블록 → 프로젝션
//      (사이드카 동반 — 규약 D)
//   ③ 그 프로젝션이 원본과 **M32 정규형 동등**하지 않으면 건너뛴다(조용한 변형 0)
//   ④ 이미 전환된 문서(`blocks_version` 있음)는 손대지 않는다
import Module, { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { ServerBlockNoteEditor } from '@blocknote/server-util'
import { stable, makeNormalize } from './s32-normalize.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FRONT = path.resolve(HERE, '..')
const SRC = path.join(FRONT, 'src')

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

function throughSchema(blocks) {
  const pmNode = server._blocksToProsemirrorNode(asEditorBlocks(blocks))
  return asAdapterBlocks(server._prosemirrorNodeToBlocks(pmNode))
}

// ---------------------------------------------------------------- 인자
const argv = process.argv.slice(2)
function flag(name) {
  return argv.includes(name)
}
function value(name, fallback) {
  const idx = argv.indexOf(name)
  return idx >= 0 && argv[idx + 1] ? argv[idx + 1] : fallback
}

const APPLY = flag('--apply')
const VERBOSE = flag('--verbose')
const CONTENT_ONLY = flag('--content-only')
const BASE = (value('--base', 'http://localhost:8000') ?? '').replace(/\/+$/, '')
const LIMIT = Number(value('--limit', '0')) || 0
const ONLY_IDS = (value('--ids', '') ?? '')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isInteger(n) && n > 0)

async function apiGet(pathname) {
  const res = await fetch(`${BASE}/api${pathname}`)
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`GET ${pathname} → HTTP ${res.status} ${body.slice(0, 200)}`)
  }
  return res.json()
}

async function apiPatch(pathname, body) {
  const res = await fetch(`${BASE}/api${pathname}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`PATCH ${pathname} → HTTP ${res.status} ${text.slice(0, 300)}`)
  }
  return res.json()
}

/** 한 표면(본문 또는 해설)의 변환 — 화면과 같은 경로 + 정규형 동등 확인. */
function convertSurface(markdown) {
  const doc1 = markdownToBlocks(markdown)
  const { blocks, unsupported, sidecar } = toBlockNoteBlocks(doc1)
  if (unsupported.length > 0) return { ok: false, reason: `미지원 서식 — ${describeUnsupported(unsupported)}` }
  let result
  try {
    result = fromBlockNoteResult(throughSchema(blocks), sidecar)
  } catch (error) {
    return { ok: false, reason: `편집기 스키마 적재 실패 — ${error?.message ?? error}` }
  }
  const projection = blocksToMarkdown(result.document)
  if (stable(normalize(markdown)) !== stable(normalize(projection))) {
    return { ok: false, reason: '프로젝션이 원본과 정규형 동등하지 않다(변환 보류)' }
  }
  if (result.microMarkCollapses.length > 0) {
    return { ok: false, reason: `마이크로 마크 접힘 발생(${result.microMarkCollapses.join(',')}) — 화면에서 확인 후 저장할 것` }
  }
  return { ok: true, blocks: result.document, projection }
}

async function main() {
  console.log(`대상 서버: ${BASE} · 모드: ${APPLY ? '**적용(PATCH)**' : '드라이런(쓰기 없음)'}`)

  let targets = []
  if (ONLY_IDS.length > 0) {
    targets = ONLY_IDS.map((id) => ({ id }))
  } else {
    let page = 1
    for (;;) {
      const data = await apiGet(`/documents?page=${page}&size=100`)
      targets.push(...data.items.map((item) => ({ id: item.id, doc_no: item.doc_no })))
      if (targets.length >= data.total || data.items.length === 0) break
      page += 1
    }
  }
  if (LIMIT > 0) targets = targets.slice(0, LIMIT)
  console.log(`대상 문서 ${targets.length}건`)

  const succeeded = []
  const skipped = []
  const failed = []

  for (const target of targets) {
    let doc
    try {
      doc = await apiGet(`/documents/${target.id}`)
    } catch (error) {
      failed.push({ id: target.id, doc_no: target.doc_no ?? '?', reason: `상세 조회 실패 — ${error.message}` })
      continue
    }
    const label = `${doc.doc_no} (id=${doc.id}) ${doc.title?.slice(0, 30) ?? ''}`

    if (doc.blocks_version != null) {
      skipped.push({ label, reason: '이미 전환됨' })
      continue
    }
    if (typeof doc.content !== 'string' || doc.content.trim() === '') {
      skipped.push({ label, reason: '본문이 비어 있음' })
      continue
    }

    const content = convertSurface(doc.content)
    if (!content.ok) {
      failed.push({ id: doc.id, doc_no: doc.doc_no, reason: `본문: ${content.reason}`, label })
      continue
    }

    const body = { content_blocks: content.blocks, content: content.projection }

    const hasExplanation = typeof doc.explanation === 'string' && doc.explanation.trim() !== ''
    if (hasExplanation && !CONTENT_ONLY) {
      const explanation = convertSurface(doc.explanation)
      if (!explanation.ok) {
        // 해설만 실패하면 **본문 전환은 그대로 진행**한다(두 쌍은 서로 독립 — §4.29 ②).
        // 해설은 미전환으로 남고, 편집 화면에서 메모리 변환으로 열린다.
        failed.push({ id: doc.id, doc_no: doc.doc_no, reason: `해설: ${explanation.reason} (본문만 전환)`, label })
      } else {
        body.explanation_blocks = explanation.blocks
        body.explanation = explanation.projection
      }
    }

    if (!APPLY) {
      succeeded.push({ label, note: body.explanation_blocks ? '본문+해설' : '본문' })
      continue
    }
    try {
      const saved = await apiPatch(`/documents/${doc.id}`, body)
      succeeded.push({
        label,
        note: `${body.explanation_blocks ? '본문+해설' : '본문'} · blocks_version=${saved.blocks_version}`,
      })
    } catch (error) {
      failed.push({ id: doc.id, doc_no: doc.doc_no, reason: `저장 실패 — ${error.message}`, label })
    }
  }

  console.log('')
  console.log(`성공(${APPLY ? '전환 저장' : '전환 가능'}): ${succeeded.length}건`)
  if (VERBOSE || !APPLY) {
    for (const item of succeeded.slice(0, VERBOSE ? succeeded.length : 20)) {
      console.log(`  + ${item.label} — ${item.note}`)
    }
    if (!VERBOSE && succeeded.length > 20) console.log(`  … 외 ${succeeded.length - 20}건 (--verbose로 전체)`)
  }
  console.log(`건너뜀: ${skipped.length}건`)
  for (const item of skipped.slice(0, VERBOSE ? skipped.length : 10)) console.log(`  · ${item.label} — ${item.reason}`)
  if (!VERBOSE && skipped.length > 10) console.log(`  … 외 ${skipped.length - 10}건`)
  console.log(`실패: ${failed.length}건`)
  for (const item of failed) console.log(`  - ${item.label ?? item.doc_no} — ${item.reason}`)

  if (!APPLY) {
    console.log('')
    console.log('드라이런입니다 — 아무것도 저장하지 않았습니다. 실제 전환은 `--apply`를 붙여 실행하세요.')
  }
}

main().catch((error) => {
  console.error(`실행 실패: ${error?.message ?? error}`)
  process.exit(1)
})
