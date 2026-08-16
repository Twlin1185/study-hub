// S34(stage-34) 붙여넣기 변환 경로 검증 — G-10 DoD 6.
//
// 실행: node frontend/scripts/s34-paste-check.mjs
//   (s33 관례 계승 — TS 모듈은 jiti로 불러온다. 신규 설치 0.)
//
// 검사 대상은 **순수 함수 3단** 뿐이다(에디터 인스턴스 불필요 — `paste.ts`의 실제 삽입 로직은
// BlockNote 편집기가 있어야 하므로 이 스크립트로는 검증하지 않는다. `collapseMicroMarks` 자체의
// 정확성은 이미 s33이 961건으로 검증한다):
//
//   htmlToDialectMarkdown(html) → markdownToBlocks(md) → toBlockNoteBlocks(doc)
//
// Word 표본·웹 표본 2종으로 돌려 3가지를 확인한다:
//   ⓐ 서식이 방언 Markdown으로 보존되는가(굵게/기울임/밑줄/형광펜/코드/링크/목록/인용/표/색)
//   ⓑ 매핑 밖 태그(span·font·head·style·o:p 등)는 텍스트로만 남고 태그 자체는 사라지는가
//   ⓒ 원시 HTML 문자열이 결과 어디에도(방언 Markdown 문자열 · 어댑터 블록 JSON · 그 블록을 다시
//     투영한 Markdown) 들어가지 않는가 — script 태그 내용물까지 포함해서.
import { createRequire } from 'node:module'
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

const require = createRequire(path.join(FRONT, 'package.json'))
const jiti = require('jiti')(path.join(FRONT, 'scripts/_loader.cjs'), {
  interopDefault: true,
  esmResolve: true,
  cache: false,
  requireCache: false,
})

const { htmlToDialectMarkdown } = jiti(path.join(SRC, 'utils/htmlPasteMarkdown.ts'))
const { markdownToBlocks, blocksToMarkdown } = jiti(path.join(SRC, 'editor2/transform/index.ts'))
const { toBlockNoteBlocks } = jiti(path.join(SRC, 'editor2/adapter/index.ts'))

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

console.log(`\n총 ${pass + fail}건 · 통과 ${pass} · 실패 ${fail}`)
if (fail > 0) {
  console.log('\n실패 목록:')
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
