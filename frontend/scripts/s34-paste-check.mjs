// S34(stage-34) 붙여넣기 변환 경로 검증 — G-10 DoD 6.
//
// 실행: node frontend/scripts/s34-paste-check.mjs
//   (s33 관례 계승 — TS 모듈은 jiti로 불러온다. 신규 설치 0.)
//
// 검사 두 갈래:
//   A. **순수 함수 3단**(에디터 인스턴스 불필요) — `collapseMicroMarks` 자체의 정확성은 이미
//      s33이 961건으로 검증하므로 여기서는 변환 파이프라인만 본다:
//        htmlToDialectMarkdown(html) → markdownToBlocks(md) → toBlockNoteBlocks(doc)
//      Word 표본·웹 표본 2종으로 돌려 3가지를 확인한다:
//        ⓐ 서식이 방언 Markdown으로 보존되는가(굵게/기울임/밑줄/형광펜/코드/링크/목록/인용/표/색)
//        ⓑ 매핑 밖 태그(span·font·head·style·o:p 등)는 텍스트로만 남고 태그 자체는 사라지는가
//        ⓒ 원시 HTML 문자열이 결과 어디에도(방언 Markdown 문자열 · 어댑터 블록 JSON · 그 블록을
//          다시 투영한 Markdown) 들어가지 않는가 — script 태그 내용물까지 포함해서.
//   B. **`createPasteHandler` 자체의 분기 회귀 고정**(검토 경미-1) — 가짜 `editor`·`clipboardData`
//      로 실제 핸들러 함수를 호출해, 비이미지 파일이 섞여도 같은 클립보드의 HTML/평문 본문이
//      조용히 버려지지 않는지를 확인한다(에디터 인스턴스 없이도 `createPasteHandler`가 순수하게
//      호출 가능한 함수이므로 실제 BlockNoteEditor를 띄우지 않고 duck-typing 목으로 검증한다).
import Module, { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { JSDOM } from 'jsdom'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FRONT = path.resolve(HERE, '..')
const SRC = path.join(FRONT, 'src')

// `htmlToDialectMarkdown`은 브라우저 내장 DOMParser를 쓴다(`utils/htmlPasteMarkdown.ts` 머리말).
// Node에는 전역이 없으므로 **이미 devDependency로 설치돼 있는** jsdom(`@blocknote/server-util`의
// 전이 의존 — s33 스크립트가 그 패키지 자체를 쓰는 것과 같은 "신규 설치 0" 원칙)의 DOMParser를
// 전역에 얹는다. 스크립트 전용 배선이며 런타임 번들에는 영향이 없다.
const jsdomWindow = new JSDOM('').window
global.DOMParser = jsdomWindow.DOMParser
// `nodeToMarkdown`은 `Node.TEXT_NODE`/`Node.ELEMENT_NODE` 상수도 참조한다 — 같은 창의 `Node`를 얹는다.
global.Node = jsdomWindow.Node

// `paste.ts`는 `./schema`(BlockNote 스키마 배선)를 실행 시점에 import한다 — 그 모듈이 커스텀
// 스펙(`.tsx`)·`@blocknote/math-block`(katex CSS)을 끌고 온다. s33 스크립트와 같은 이유로 같은
// 스텁·트랜스파일 배선이 필요하다(신규 설치 0 — 전부 이미 있는 devDependency).
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

const { htmlToDialectMarkdown } = jiti(path.join(SRC, 'utils/htmlPasteMarkdown.ts'))
const { markdownToBlocks, blocksToMarkdown } = jiti(path.join(SRC, 'editor2/transform/index.ts'))
const { toBlockNoteBlocks } = jiti(path.join(SRC, 'editor2/adapter/index.ts'))
const { createPasteHandler } = jiti(path.join(SRC, 'editor2/blocknote/paste.ts'))

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

// 태그 모양(`<…>`)이 결과 문자열 어디에도 남아 있지 않은지 — REMOVE_TAGS(script/style 등)의
// 내용물까지 사라졌는지도 이 정규식 하나로 같이 잡힌다(태그가 없으면 그 안의 텍스트도 태그와
// 함께 REMOVE_TAGS 경로로 통째 버려진다).
const TAG_SHAPE = /<\/?[a-zA-Z][^>]{0,80}>/

function assertNoRawHtml(label, text) {
  check(`${label}: 태그 모양 잔존 0`, !TAG_SHAPE.test(text), text.match(TAG_SHAPE)?.[0])
}

// ---------------------------------------------------------------- 표본 ① Word 붙여넣기 모사
//
// Word/오피스류가 흔히 내보내는 모양: 문서 전역 스타일 블록(<style>) · 네임스페이스 태그(<o:p>) ·
// mso 전용 span · 굵게/기울임/밑줄 혼용 문단 · 실제 <table>. REMOVE_TAGS(style) · 기본 폴백(o:p·
// span) · 코어 매핑(b/i/u/table) 세 경로를 한 표본에서 같이 검사한다.
const WORD_SAMPLE = `
<html xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<style>
<!-- p.MsoNormal { margin:0cm; font-family:"맑은 고딕"; } -->
</style>
</head>
<body>
<div class="WordSection1">
<p class="MsoNormal"><b>굵은 글씨</b>와 <i>기울임</i>과 <u>밑줄</u>이 섞인 문단입니다.<o:p></o:p></p>
<p class="MsoNormal"><span style="color:#FF0000">빨간 글씨</span> 그리고 <span class="mso-fake">평범한 span</span>입니다.<o:p></o:p></p>
<table class="MsoTableGrid" border="1" cellspacing="0" cellpadding="0">
<tr><td><p>헤더1</p></td><td><p>헤더2</p></td></tr>
<tr><td><p>값1</p></td><td><p>값2</p></td></tr>
</table>
</div>
</body>
</html>
`

// ---------------------------------------------------------------- 표본 ② 웹페이지 붙여넣기 모사
//
// 일반 웹 콘텐츠 복사 모양: 링크 · 형광펜 · 코드 · 중첩 목록 · 인용 · script(제거) · img(매핑 밖,
// 파일이 아니라 <img> 태그로만 온 경우이므로 조용히 텍스트 없음으로 사라져야 한다) · font 태그.
const WEB_SAMPLE = `
<div>
  <h2>제목입니다</h2>
  <p>이것은 <a href="https://example.com/page?a=1&amp;b=2">링크</a>와 <mark>형광펜</mark>, <code>코드조각</code>이 있는 문단입니다.</p>
  <ul>
    <li>목록 항목 A</li>
    <li>목록 항목 B
      <ul><li>중첩 항목</li></ul>
    </li>
  </ul>
  <blockquote>인용문입니다.</blockquote>
  <script>alert('xss-marker-should-not-survive')</script>
  <img src="https://example.com/x.png" alt="스크린샷">
  <font color="red">폰트 태그 색</font>
</div>
`

function runSample(label, html, expectedMarkers) {
  console.log(`== ${label} ==`)

  const md = htmlToDialectMarkdown(html)

  // ⓐ 서식이 방언 Markdown으로 보존되는가
  for (const [markerLabel, pattern] of expectedMarkers) {
    check(`${label} ⓐ ${markerLabel} 보존`, pattern.test(md), md)
  }

  // ⓑ 매핑 밖 태그는 텍스트만 남고, script 내용물은 완전히 사라진다(REMOVE_TAGS)
  check(`${label} ⓑ script 내용물(xss-marker) 미유출`, !md.includes('xss-marker-should-not-survive'))
  assertNoRawHtml(`${label} ⓑ 방언 Markdown`, md)

  // ⓒ 원시 HTML이 후속 파이프라인(블록 JSON · 재투영 Markdown) 어디에도 들어가지 않는가
  const doc = markdownToBlocks(md)
  const result = toBlockNoteBlocks(doc)
  const blocksJson = JSON.stringify(result.blocks)
  assertNoRawHtml(`${label} ⓒ 어댑터 블록 JSON`, blocksJson)
  check(`${label} ⓒ 어댑터 블록 JSON: script 내용물 미유출`, !blocksJson.includes('xss-marker-should-not-survive'))

  const projected = blocksToMarkdown(doc)
  assertNoRawHtml(`${label} ⓒ 재투영 Markdown`, projected)
  check(`${label} ⓒ 재투영 Markdown: script 내용물 미유출`, !projected.includes('xss-marker-should-not-survive'))

  check(`${label}: 미지원 보고 0건(코어 매핑 안에서만 구성한 표본)`, result.unsupported.length === 0, JSON.stringify(result.unsupported))

  console.log(`  md 미리보기:\n${md.trim().split('\n').map((l) => `    ${l}`).join('\n')}`)
}

runSample('Word 표본', WORD_SAMPLE, [
  ['굵게(**)', /\*\*굵은 글씨\*\*/],
  ['기울임(*)', /\*기울임\*/],
  ['밑줄(\\+\\+)', /\+\+밑줄\+\+/],
  ['색(:t c=)', /:t\[빨간 글씨\]\{c=#ff0000\}/],
  ['표(GFM)', /\|\s*헤더1\s*\|\s*헤더2\s*\|/],
])

runSample('웹 표본', WEB_SAMPLE, [
  ['제목(##)', /^## 제목입니다$/m],
  ['링크', /\[링크\]\(https:\/\/example\.com\/page\?a=1&b=2\)/],
  ['형광펜(==)', /==형광펜==/],
  ['코드(`)', /`코드조각`/],
  ['목록(-)', /^- 목록 항목 A$/m],
  ['중첩 목록(들여쓰기)', /^ {2}- 중첩 항목$/m],
  ['인용(>)', /^> 인용문입니다\.$/m],
])

// ---------------------------------------------------------------- B. createPasteHandler 분기 목 검증

/** 화면 없이 `createPasteHandler`를 호출하기 위한 최소 가짜 편집기 — 호출만 기록한다.
 * `anchor`를 지정하지 않으면 기본값(빈 문단)이다 — 중요-3(단일 문단→인라인 삽입) 검사는
 * "커서가 이미 텍스트가 있는 문단 한가운데"를 재현하려고 비어 있지 않은 anchor를 넘긴다. */
function makeFakeEditor({ anchor = { id: 'anchor', type: 'paragraph', content: [] } } = {}) {
  const calls = { replaceBlocks: [], insertBlocks: [], updateBlock: [], pasteText: [], insertInlineContent: [] }
  const blocks = new Map([[anchor.id, anchor]])
  const editor = {
    getTextCursorPosition: () => ({ block: blocks.get(anchor.id) }),
    replaceBlocks: (ids, newBlocks) => {
      calls.replaceBlocks.push({ ids, newBlocks })
      const inserted = newBlocks.map((b, i) => ({ id: `inserted-${i}`, ...b }))
      inserted.forEach((b) => blocks.set(b.id, b))
      return { insertedBlocks: inserted, removedBlocks: [] }
    },
    insertBlocks: (newBlocks, _ref, placement) => {
      calls.insertBlocks.push({ newBlocks, placement })
      const inserted = newBlocks.map((b, i) => ({ id: `inserted-${i}`, ...b }))
      inserted.forEach((b) => blocks.set(b.id, b))
      return inserted
    },
    updateBlock: (id, update) => {
      calls.updateBlock.push({ id, update })
      return { id, ...update }
    },
    getBlock: (id) => blocks.get(id),
    pasteText: (text) => {
      calls.pasteText.push(text)
      return true
    },
    insertInlineContent: (content) => {
      calls.insertInlineContent.push(content)
    },
  }
  return { editor, calls }
}

function makeClipboardData({ files = [], html = '', plain = '' }) {
  return {
    files,
    getData: (type) => (type === 'text/html' ? html : type === 'text/plain' ? plain : ''),
  }
}

function makeDeps() {
  const notices = []
  const uploadCalls = []
  return {
    notices,
    uploadCalls,
    deps: {
      runUpload: async (file) => {
        uploadCalls.push(file)
        return '/images/fake0123456789ab.png'
      },
      beginUploadBatch: () => {},
      onNotice: (message) => notices.push(message),
    },
  }
}

function insertedBlocksOf(calls) {
  return calls.replaceBlocks[0]?.newBlocks ?? calls.insertBlocks[0]?.newBlocks ?? []
}

console.log('== B. createPasteHandler 분기 회귀(검토 경미-1) ==')

// 경미-1 재현 표본: PDF 하나 + text/html 본문이 같은 클립보드에 실려 온 경우(일부 앱의
// "첨부+본문" 붙여넣기 모사) — 수정 전에는 이미지 분기가 무조건 `return true`로 이벤트를
// 끝내 HTML 본문이 통째로 사라졌다.
{
  const { editor, calls } = makeFakeEditor()
  const { deps, notices, uploadCalls } = makeDeps()
  const handler = createPasteHandler(deps)
  const pdfFile = new File(['pdf-bytes'], 'document.pdf', { type: 'application/pdf' })
  const clipboardData = makeClipboardData({
    files: [pdfFile],
    html: '<p><b>본문이 살아있어야 한다</b></p>',
  })
  let defaultCalled = false
  const result = handler({
    event: { clipboardData },
    editor,
    defaultPasteHandler: () => {
      defaultCalled = true
      return true
    },
  })

  check(
    '경미-1: 비이미지 파일이 섞여도 HTML 본문이 삽입된다',
    calls.replaceBlocks.length === 1 || calls.insertBlocks.length === 1,
  )
  check(
    '경미-1: 삽입된 블록에 본문 텍스트가 담긴다("본문이 살아있어야 한다")',
    JSON.stringify(insertedBlocksOf(calls)).includes('본문이 살아있어야 한다'),
  )
  check('경미-1: 이미지가 아니므로 업로드는 시도되지 않는다', uploadCalls.length === 0)
  check('경미-1: 건너뛴 파일 안내가 함께 뜬다', notices.some((n) => n.includes('건너뛰었습니다')))
  check('경미-1: 안내가 배너 1개로만 합쳐져 뜬다(여러 번 덮어쓰지 않는다)', notices.length === 1)
  check('경미-1: BlockNote 기본 처리(defaultPasteHandler)로 위임하지 않는다', !defaultCalled)
  check('경미-1: 핸들러가 이벤트를 스스로 처리했다고 보고한다', result === true)
}

// 같은 결함의 변형: HTML도 없이 비이미지 파일만 있는 경우 — 평문(text/plain)만은 직접 살리고,
// BlockNote 기본 Files 처리(스키마 밖 file 블록 시도 위험)로는 위임하지 않는다.
{
  const { editor, calls } = makeFakeEditor()
  const { deps, notices, uploadCalls } = makeDeps()
  const handler = createPasteHandler(deps)
  const pdfFile = new File(['pdf-bytes'], 'document.pdf', { type: 'application/pdf' })
  const clipboardData = makeClipboardData({ files: [pdfFile], plain: '파일명.pdf' })
  let defaultCalled = false
  const result = handler({
    event: { clipboardData },
    editor,
    defaultPasteHandler: () => {
      defaultCalled = true
      return true
    },
  })

  check('비이미지 단독(HTML 없음): text/plain을 직접 살린다', calls.pasteText[0] === '파일명.pdf')
  check('비이미지 단독(HTML 없음): 이미지가 아니므로 업로드는 시도되지 않는다', uploadCalls.length === 0)
  check(
    '비이미지 단독(HTML 없음): BlockNote 기본 Files 처리로 위임하지 않는다(스키마 밖 file 블록 회귀 방지)',
    !defaultCalled,
  )
  check('비이미지 단독(HTML 없음): 건너뜀 안내가 뜬다', notices.some((n) => n.includes('건너뛰었습니다')))
  check('비이미지 단독(HTML 없음): 핸들러가 이벤트를 스스로 처리했다고 보고한다', result === true)
}

// 대조군: 파일이 아예 없는 "진짜 평문 붙여넣기"는 여전히 기본 동작에 위임한다(Markdown 해석은 끈다).
{
  const { editor } = makeFakeEditor()
  const { deps } = makeDeps()
  const handler = createPasteHandler(deps)
  const clipboardData = makeClipboardData({ files: [], plain: '그냥 텍스트' })
  let capturedOpts
  const result = handler({
    event: { clipboardData },
    editor,
    defaultPasteHandler: (opts) => {
      capturedOpts = opts
      return true
    },
  })

  check('대조군(파일 없는 평문): 기본 동작에 위임한다', result === true && capturedOpts !== undefined)
  check(
    '대조군(파일 없는 평문): plainTextAsMarkdown:false로 위임한다(서식 오인 방지)',
    capturedOpts?.plainTextAsMarkdown === false,
  )
}

// ---------------------------------------------------------------- C. insertAtCursor 인라인/블록 분기

console.log('== C. insertAtCursor 인라인/블록 분기 회귀(검토 중요-3) ==')

// "커서가 이미 텍스트가 있는 문단 한가운데" 재현 — 빈 문단이 아니므로 ①(빈 문단 대체) 경로를
// 타지 않는다.
const nonEmptyAnchor = () => ({
  id: 'anchor',
  type: 'paragraph',
  content: [{ type: 'text', text: '기존 문장 ', styles: {} }],
})

// 단일 문단 HTML(서식 조각) — 수정 전에는 이 경우도 항상 새 블록(아랫줄)으로 떨어졌다(중요-3).
// 이제는 커서 위치에 인라인으로 들어가야 한다.
{
  const { editor, calls } = makeFakeEditor({ anchor: nonEmptyAnchor() })
  const { deps } = makeDeps()
  const handler = createPasteHandler(deps)
  const clipboardData = makeClipboardData({ html: '<b>굵게</b>' })
  const result = handler({ event: { clipboardData }, editor, defaultPasteHandler: () => true })

  check('중요-3: 단일 문단 HTML은 insertInlineContent로 들어간다', calls.insertInlineContent.length === 1)
  check('중요-3: 단일 문단 HTML은 insertBlocks를 타지 않는다', calls.insertBlocks.length === 0)
  check('중요-3: 단일 문단 HTML은 replaceBlocks도 타지 않는다(빈 문단 대체 경로가 아니다)', calls.replaceBlocks.length === 0)
  check(
    '중요-3: 인라인으로 들어간 내용에 서식 있는 텍스트("굵게")가 담긴다',
    JSON.stringify(calls.insertInlineContent[0] ?? []).includes('굵게'),
  )
  check('중요-3: 핸들러가 이벤트를 스스로 처리했다고 보고한다', result === true)
}

// 다중 블록 HTML(제목 + 문단) — 문단 경계를 넘으므로 여전히 블록 삽입이어야 한다.
{
  const { editor, calls } = makeFakeEditor({ anchor: nonEmptyAnchor() })
  const { deps } = makeDeps()
  const handler = createPasteHandler(deps)
  const clipboardData = makeClipboardData({ html: '<h2>제목</h2><p>문단</p>' })
  handler({ event: { clipboardData }, editor, defaultPasteHandler: () => true })

  check('중요-3: 다중 블록 HTML은 기존 insertBlocks 경로 그대로다', calls.insertBlocks.length === 1)
  check('중요-3: 다중 블록 HTML은 insertInlineContent를 타지 않는다', calls.insertInlineContent.length === 0)
}

// 단일 블록이지만 비문단(목록) — 문단이 아니므로 여전히 블록 삽입이어야 한다.
{
  const { editor, calls } = makeFakeEditor({ anchor: nonEmptyAnchor() })
  const { deps } = makeDeps()
  const handler = createPasteHandler(deps)
  const clipboardData = makeClipboardData({ html: '<ul><li>항목</li></ul>' })
  handler({ event: { clipboardData }, editor, defaultPasteHandler: () => true })

  check('중요-3: 단일 블록이라도 비문단(목록) HTML은 insertBlocks 경로 그대로다', calls.insertBlocks.length === 1)
  check('중요-3: 목록(비문단) HTML은 insertInlineContent를 타지 않는다', calls.insertInlineContent.length === 0)
}

// 빈 문단 앵커 — 기존 replaceBlocks 경로가 이번 수정으로 바뀌지 않았는지 회귀 고정.
{
  const { editor, calls } = makeFakeEditor() // 기본값 = 빈 문단 앵커
  const { deps } = makeDeps()
  const handler = createPasteHandler(deps)
  const clipboardData = makeClipboardData({ html: '<p>단어</p>' })
  handler({ event: { clipboardData }, editor, defaultPasteHandler: () => true })

  check('중요-3: 빈 문단 앵커는 여전히 replaceBlocks로 대체된다(무변)', calls.replaceBlocks.length === 1)
  check('중요-3: 빈 문단 앵커에서는 insertInlineContent를 타지 않는다', calls.insertInlineContent.length === 0)
  check('중요-3: 빈 문단 앵커에서는 insertBlocks를 타지 않는다', calls.insertBlocks.length === 0)
}

console.log(`\n총 ${pass + fail}건 · 통과 ${pass} · 실패 ${fail}`)
if (fail > 0) {
  console.log('\n실패 목록:')
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
