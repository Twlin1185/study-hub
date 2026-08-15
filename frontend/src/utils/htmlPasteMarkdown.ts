// HTML 붙여넣기 화이트리스트 변환기 (설계 §5.3 S30 ⓒⓓ, F56 결정 ④·④-2).
//
// 붙여넣긴 clipboard의 text/html을 브라우저 내장 DOMParser로 파싱해 이 앱의 방언 Markdown
// 문자열로 **단방향** 변환한다. 파싱한 DOM은 어디에도 삽입하지 않는다(순수 문자열 변환 —
// DOMParser 문서는 스크립트를 실행하지 않지만, script/style/iframe/object/embed/svg는
// 내용까지 완전히 제거해 텍스트 유출도 막는다).
//
// 결과 문자열은 평소의 타이핑 입력과 동일하게 취급되어 기존 remark 파이프라인을 그대로
// 탄다 — 신규 해석 경로 0, turndown류 신규 의존 0. React·전역 상태 참조 없는 순수 함수만
// export한다. 아직 어디에도 연결(wiring)하지 않는다 — 다음 단계가 배선.
//
// 매핑(설계 ⓒ 표):
//   b/strong -> **…**            i/em -> *…*                 u -> ++…++
//   s/del/strike -> ~~…~~        mark -> ==…==                code -> `…`
//   a[href] -> [텍스트](URL)      h1~h6 -> #~###### + 빈 줄     ul/ol/li -> 목록(중첩 2칸)
//   blockquote -> "> " 줄 접두   p/div -> 빈 줄 구분 문단      br -> 줄바꿈 1회
//   table/tr/th/td -> GFM 표(헤더 행 없으면 첫 행을 헤더로)
//   매핑 밖 태그(span/font 등) -> 텍스트만 남김(태그 소멸, 자식은 계속 재귀 처리)
//   script/style/iframe/object/embed/svg -> 노드째 제거(내부 텍스트도 버림)
//
// 속성은 전부 폐기 — 취하는 것은 a[href]와 인라인 style의 color/background-color(색 2종)뿐.
// 색은 hex(3·6자리) 또는 rgb(r,g,b)로 읽히면 소문자 6자리 #rrggbb로 정규화해
// :t[…]{c=#rrggbb}·:t[…]{bg=#rrggbb}(둘 다 있으면 :t[…]{c=… bg=…} 1회 병합)로 감싼다.
// #000000·#ffffff처럼 사실상 무의미한 색은 버린다(웹 본문 전체가 :t로 도배되는 것 방지).
//
// **텍스트 노드 이스케이프(검토 경미-2 대응)**: DOM 텍스트 노드에서 뽑은 리터럴 문자열은 태그
// 변환으로 만든 마커(`**`·`==`·목록 기호·`:t[...]{...}` 등)와 섞이기 전에 `inlineSerialize.ts`의
// `escapeInlineText`(WYSIWYG 인라인 모델이 쓰는 것과 동일한 이스케이프 표)를 거친다 — 그래야
// 웹 본문의 리터럴 `**강조**`·`<b>` 같은 문자열이 붙여넣기 후 서식으로 재해석되거나(CommonMark
// 코어 파서가 굵게·원시 HTML로 삼킴) rehype-raw 기각으로 렌더에서 사라지는 것을 막는다. 이스케이프는
// 리프(텍스트 노드) 단계에서만 적용하고, 그 위에서 태그가 붙이는 마커는 이스케이프 대상이 아니다.
//
// **알려진 한계(수정 불가 — 이 파일 밖 구조 문제)**: `[[DOC-0001]]`처럼 이 앱의 참조 문법과 모양이
// 같은 리터럴 텍스트는 이스케이프해도 여전히 참조 칩으로 바뀐다. `remarkStudy.ts`의 참조 매칭
// (`nextRefMatch`)은 파싱이 끝난 텍스트 노드 `value`를 정규식으로 재스캔할 뿐 이스케이프 마스크를
// 보지 않는다(마이크로 3종 `++`·`==`·`||`만 마스크를 확인한다) — 게다가 `\[`·`\]`는 CommonMark
// 코어 단계에서 이스케이프가 소비되어 값 자체가 "[[DOC-0001]]"로 동일해지므로 소스에 백슬래시를
// 남겨도 이 재스캔 단계에는 정보가 전달되지 않는다. 이는 **일반 타이핑에서도 동일한 기존 동작**
// (`[[DOC-0001]]`를 그냥 입력해도 칩이 된다)이라 붙여넣기만의 회귀는 아니다 — 완전한 수정은
// `remarkStudy.ts`(현재 병렬 작업 중이라 이 파일에서는 손대지 않는다) 쪽 변경이 필요하다.
import { escapeInlineText } from '../components/markdown/inlineSerialize'

const REMOVE_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg'])

function clampChannel(value: number): number {
  if (Number.isNaN(value)) return 0
  return Math.min(255, Math.max(0, Math.round(value)))
}

type Rgb = [number, number, number]

// hex(3/6자리) 또는 rgb(r,g,b)만 인식해 [r,g,b] 채널(0~255)로 돌려준다. rgba()·hsl()·색 이름
// 키워드·currentcolor 등은 버린다(매핑 규칙 밖 — 정규화 결과의 신뢰도를 3종 표기로만 좁힌다).
// 색 리터럴을 코드에 직접 적지 않기 위해 결과는 항상 채널 숫자로만 다룬다(불변 규칙 5 —
// hex 문자열은 사용자가 붙여넣은 런타임 데이터에서만 나온다).
function parseColorChannels(raw: string | null | undefined): Rgb | null {
  if (!raw) return null
  const value = raw.trim().toLowerCase()
  if (!value) return null

  const hex3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(value)
  if (hex3) {
    const [, r, g, b] = hex3
    return [parseInt(r + r, 16), parseInt(g + g, 16), parseInt(b + b, 16)]
  }

  const hex6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(value)
  if (hex6) {
    const [, r, g, b] = hex6
    return [parseInt(r, 16), parseInt(g, 16), parseInt(b, 16)]
  }

  const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/.exec(value)
  if (rgb) {
    const [, r, g, b] = rgb
    return [clampChannel(Number(r)), clampChannel(Number(g)), clampChannel(Number(b))]
  }

  return null
}

function channelsToHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

// 채널이 전부 0(검정) 또는 전부 255(흰색)면 "사실상 무의미한 색"으로 본다 — 워드프로세서가
// 기본 검정 글자·흰 배경을 그대로 인라인 style로 굳혀 내보내는 습관 때문에, 이 두 극단값만은
// 사용자가 실제로 고른 색과 구분되지 않는다(웹 본문 전체가 :t로 도배되는 것 방지). 그 외 값은
// 사용자가 실제로 고른 색으로 보고 전부 보존한다.
function isMeaninglessChannels([r, g, b]: Rgb): boolean {
  return (r === 0 && g === 0 && b === 0) || (r === 255 && g === 255 && b === 255)
}

function readHexColor(raw: string | null | undefined): string | null {
  const channels = parseColorChannels(raw)
  if (!channels) return null
  if (isMeaninglessChannels(channels)) return null
  return channelsToHex(channels)
}

// 요소 자신의 인라인 style에서 color/background-color를 읽어 :t{} 속성 문자열로 만든다.
// 둘 다 있으면 한 번에 병합("c=... bg=...") — :t[:t[...]{c=..}]{bg=..} 같은 중첩을 만들지 않는다.
function extractColorAttrs(el: HTMLElement): string | null {
  const parts: string[] = []

  const ink = readHexColor(el.style.color)
  if (ink) parts.push(`c=${ink}`)

  const bg = readHexColor(el.style.backgroundColor)
  if (bg) parts.push(`bg=${bg}`)

  return parts.length ? parts.join(' ') : null
}

function wrapColor(el: HTMLElement, inner: string): string {
  if (!inner.trim()) return inner
  const attrs = extractColorAttrs(el)
  if (!attrs) return inner
  return `:t[${inner}]{${attrs}}`
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ')
}

// 인라인 문맥(제목·표 셀·목록 항목·링크 라벨 등)에서 쓴다 — CommonMark가 애초에 블록을
// 품을 수 없는 자리이므로 남은 개행은 전부 공백으로 접어도 안전하다.
function normalizeInline(text: string): string {
  return collapseWhitespace(text).trim()
}

// 블록 문맥(p/div/blockquote)에서 쓴다 — 중첩 블록이 만든 "\n\n" 구조는 보존하고, 앞뒤
// 공백과 3개 이상 연속 개행(과도한 빈 줄)만 정리한다.
function normalizeBlock(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '')
}

function isSafeHref(href: string): boolean {
  const trimmed = href.trim()
  if (!trimmed) return false
  const schemeMatch = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed)
  if (!schemeMatch) return true // 상대 경로·앵커(#…) 등 스킴이 없는 참조는 허용
  const scheme = schemeMatch[1].toLowerCase()
  return scheme === 'http' || scheme === 'https'
}

// href 속성값은 HTML 안에서 임의의 텍스트일 수 있다(따옴표로만 구분되고 마크다운 문법을 전혀
// 모른다) — `href="https://x) ![](https://evil/..."` 같은 값이 그대로 `[텍스트](URL)`에 꽂히면
// `)`로 링크를 조기에 닫고 그 뒤 문자열이 새 마크다운 구문(`![...](...)` 등)으로 살아난다
// (검토 경미-1). `(`·`)`·공백·`<`·`>`는 마크다운 링크 목적지 구문을 열고 닫을 수 있는 문자라
// 반드시 퍼센트 인코딩한다. encodeURI가 대부분(공백·`[`·`]`·`<`·`>` 등)을 이미 인코딩하지만
// `(`·`)`는 URI 상 유효 문자라 encodeURI가 보존하므로 별도로 인코딩한다(링크 구문 탈출 원천 차단
// — 사용자가 URL에 실제로 괄호를 썼더라도 안전 쪽으로 퍼센트 인코딩한다. 대다수 서버는 %28/%29를
// 정상 디코딩하므로 링크 자체는 대개 계속 동작한다).
function sanitizeHref(href: string): string {
  let out: string
  try {
    out = encodeURI(href)
  } catch {
    out = href
  }
  return out.replace(/[()<> ]/g, (ch) => `%${ch.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase()}`)
}

function wrapCodeBackticks(text: string): string {
  const runs = text.match(/`+/g) ?? []
  const maxRun = runs.reduce((max, run) => Math.max(max, run.length), 0)
  const fence = '`'.repeat(maxRun + 1)
  const needsPad = text.startsWith('`') || text.endsWith('`')
  const body = needsPad ? ` ${text} ` : text
  return `${fence}${body}${fence}`
}

function childrenToMarkdown(node: Node): string {
  let out = ''
  node.childNodes.forEach((child) => {
    out += nodeToMarkdown(child)
  })
  return out
}

function inlineCellText(cell: HTMLElement): string {
  const raw = childrenToMarkdown(cell)
  const wrapped = wrapColor(cell, raw)
  return normalizeInline(wrapped).replace(/\|/g, '\\|')
}

function convertTable(tableEl: HTMLElement): string {
  const trList = Array.from(tableEl.querySelectorAll('tr'))
  if (!trList.length) return ''

  let headerRowIndex = -1
  const rows = trList.map((tr, idx) => {
    const cells = Array.from(tr.children).filter((c) =>
      c.tagName.toLowerCase() === 'td' || c.tagName.toLowerCase() === 'th'
    ) as HTMLElement[]
    if (headerRowIndex === -1 && cells.some((c) => c.tagName.toLowerCase() === 'th')) {
      headerRowIndex = idx
    }
    return cells.map((c) => inlineCellText(c))
  })

  if (!rows.some((row) => row.length)) return ''

  const header = headerRowIndex === -1 ? rows[0] : rows[headerRowIndex]
  const bodyRows = headerRowIndex === -1 ? rows.slice(1) : rows.filter((_, idx) => idx !== headerRowIndex)

  const colCount = Math.max(header.length, ...rows.map((row) => row.length))
  if (!colCount) return ''

  const pad = (row: string[]) => {
    const out = row.slice(0, colCount)
    while (out.length < colCount) out.push('')
    return out
  }

  const lines = [
    `| ${pad(header).join(' | ')} |`,
    `| ${Array.from({ length: colCount }, () => '---').join(' | ')} |`,
    ...bodyRows.map((row) => `| ${pad(row).join(' | ')} |`),
  ]

  return `\n\n${lines.join('\n')}\n\n`
}

function convertList(listEl: HTMLElement, depth: number): string {
  const ordered = listEl.tagName.toLowerCase() === 'ol'
  const items = Array.from(listEl.children).filter((c) => c.tagName.toLowerCase() === 'li') as HTMLElement[]
  const indent = '  '.repeat(depth)
  const lines: string[] = []

  items.forEach((li, idx) => {
    const marker = ordered ? `${idx + 1}. ` : '- '
    let inlineText = ''
    const nestedBlocks: string[] = []

    li.childNodes.forEach((child) => {
      if (
        child.nodeType === Node.ELEMENT_NODE &&
        (['ul', 'ol'].includes((child as HTMLElement).tagName.toLowerCase()))
      ) {
        const nested = convertList(child as HTMLElement, depth + 1)
        if (nested) nestedBlocks.push(nested)
      } else {
        inlineText += nodeToMarkdown(child)
      }
    })

    const itemContent = normalizeInline(wrapColor(li, inlineText))
    lines.push(`${indent}${marker}${itemContent}`)
    nestedBlocks.forEach((nested) => lines.push(nested))
  })

  return lines.join('\n')
}

function nodeToMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    // 리프에서만 이스케이프한다 — 태그가 위에서 붙이는 마커(`**`·`==`·`:t[...]{...}` 등)는
    // 이 시점 이후에 조립되므로 이스케이프 대상이 아니다.
    return escapeInlineText(collapseWhitespace(node.textContent ?? ''))
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return ''

  const el = node as HTMLElement
  const tag = el.tagName.toLowerCase()

  if (REMOVE_TAGS.has(tag)) return ''

  switch (tag) {
    case 'br':
      return '\n'

    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const level = Number(tag[1])
      const inner = normalizeInline(wrapColor(el, childrenToMarkdown(el)))
      return inner ? `\n\n${'#'.repeat(level)} ${inner}\n\n` : ''
    }

    case 'p':
    case 'div': {
      const raw = wrapColor(el, childrenToMarkdown(el))
      const cleaned = normalizeBlock(raw)
      return cleaned ? `\n\n${cleaned}\n\n` : ''
    }

    case 'blockquote': {
      const raw = wrapColor(el, childrenToMarkdown(el))
      const cleaned = normalizeBlock(raw)
      if (!cleaned) return ''
      const lines = cleaned.split('\n').map((line) => (line.length ? `> ${line}` : '>'))
      return `\n\n${lines.join('\n')}\n\n`
    }

    case 'ul':
    case 'ol': {
      const body = convertList(el, 0)
      return body ? `\n\n${body}\n\n` : ''
    }

    case 'li': {
      // 정상적인 경우 li는 convertList가 직접 처리한다 — 부모 ul/ol 없이 나타나는
      // 비정상 HTML(단독 li) 방어 차원의 폴백만 여기서 담당한다.
      const text = normalizeInline(wrapColor(el, childrenToMarkdown(el)))
      return text ? `- ${text}\n` : ''
    }

    case 'table':
      return convertTable(el)

    case 'b':
    case 'strong': {
      const inner = wrapColor(el, childrenToMarkdown(el))
      return inner.trim() ? `**${inner}**` : ''
    }

    case 'i':
    case 'em': {
      const inner = wrapColor(el, childrenToMarkdown(el))
      return inner.trim() ? `*${inner}*` : ''
    }

    case 'u': {
      const inner = wrapColor(el, childrenToMarkdown(el))
      return inner.trim() ? `++${inner}++` : ''
    }

    case 's':
    case 'del':
    case 'strike': {
      const inner = wrapColor(el, childrenToMarkdown(el))
      return inner.trim() ? `~~${inner}~~` : ''
    }

    case 'mark': {
      const inner = wrapColor(el, childrenToMarkdown(el))
      return inner.trim() ? `==${inner}==` : ''
    }

    case 'code': {
      const text = (el.textContent ?? '').trim()
      return text ? wrapCodeBackticks(text) : ''
    }

    case 'a': {
      const inner = normalizeInline(wrapColor(el, childrenToMarkdown(el)))
      if (!inner) return ''
      const href = el.getAttribute('href')
      if (href && isSafeHref(href)) return `[${inner}](${sanitizeHref(href.trim())})`
      return inner
    }

    default:
      // 매핑 밖 태그(span·font 등) — 태그는 소멸하고 텍스트(및 색 속성)만 남긴다.
      return wrapColor(el, childrenToMarkdown(el))
  }
}

/**
 * 클립보드의 text/html 문자열을 이 앱의 방언 Markdown 문자열로 변환한다(단방향·순수 함수).
 * DOMParser로만 파싱하며 결과 DOM은 어떤 문서에도 삽입하지 않는다.
 */
export function htmlToDialectMarkdown(html: string): string {
  if (!html || !html.trim()) return ''

  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  const body = doc.body
  if (!body) return ''

  return normalizeBlock(childrenToMarkdown(body))
}
