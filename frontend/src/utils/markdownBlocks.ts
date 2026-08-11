// 편집 가능 미리보기(F55 / S27)용 최상위 블록 스캐너 — **순수 함수**.
//
// 계약(설계 §5.3 S27 ⓑ · stage-27 1-1/1-2, 리스크 R28):
//  ① 결과는 원본 문자열의 `{start,end}` 반개구간 목록뿐이다. 소비자는 항상 `source.slice(start,end)`로
//     읽고, 편집은 `source.slice(0,start) + draft + source.slice(end)`로만 한다 —
//     **블록 텍스트를 이어 붙여 문서를 재구성하는 코드는 어디에도 두지 않는다**(스캐너가 틀려도
//     편집하지 않은 문서는 1바이트도 바뀌지 않는다).
//  ② 분해 = 빈 줄(`trim() === ''`) 구분. 단 코드 펜스(``` / ~~~)와 `:::` 컨테이너는 내부 빈 줄을
//     포함해 **원자 블록**이며, 닫히지 않은 펜스·컨테이너는 문서 끝까지 한 블록으로 본다
//     (보수적 원자화 — 구조 한가운데를 갈라 놓지 않는 쪽이 항상 안전하다).
//  ③ 경계는 줄 단위 — start는 줄 시작 오프셋, end는 마지막 줄의 끝(개행 문자 앞).
//     블록 사이의 빈 줄·개행은 어느 블록에도 속하지 않는다(구간 치환이므로 그대로 보존된다).

export interface BlockRange {
  start: number
  end: number
}

interface SourceLine {
  /** 줄 시작 오프셋 */
  start: number
  /** 줄 끝 오프셋(개행 문자 앞 — 개행은 포함하지 않는다) */
  end: number
  text: string
}

interface FenceInfo {
  char: '`' | '~'
  len: number
}

// 여는 펜스: 들여쓰기 3칸까지 허용(CommonMark), 백틱/틸드 3개 이상.
const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})/
// `:::`(3개 이상) — 뒤에 이름이 남아 있으면 여는 줄, 아무것도 없으면 닫는 줄(remark-directive 관례).
const DIRECTIVE_RE = /^ {0,3}(:{3,})(.*)$/

function splitLines(source: string): SourceLine[] {
  const lines: SourceLine[] = []
  let pos = 0
  while (pos <= source.length) {
    const nl = source.indexOf('\n', pos)
    const end = nl === -1 ? source.length : nl
    lines.push({ start: pos, end, text: source.slice(pos, end) })
    if (nl === -1) break
    pos = nl + 1
  }
  return lines
}

function isBlank(line: SourceLine): boolean {
  return line.text.trim() === ''
}

function matchFenceOpen(text: string): FenceInfo | null {
  const m = FENCE_OPEN_RE.exec(text)
  if (!m) return null
  const marker = m[1]
  return { char: marker[0] as '`' | '~', len: marker.length }
}

function isFenceClose(text: string, fence: FenceInfo): boolean {
  const m = FENCE_OPEN_RE.exec(text)
  if (!m) return false
  const marker = m[1]
  // 같은 문자 · 여는 펜스 이상의 길이 + 뒤에 다른 내용이 없어야 닫는 펜스다.
  if (marker[0] !== fence.char || marker.length < fence.len) return false
  return text.slice(m[0].length).trim() === ''
}

function matchDirective(text: string): 'open' | 'close' | null {
  const m = DIRECTIVE_RE.exec(text)
  if (!m) return null
  return m[2].trim() === '' ? 'close' : 'open'
}

/** 여는 펜스 줄(startIdx)부터 닫는 펜스 줄까지 소비하고, 그 다음 줄 인덱스를 돌려준다. */
function consumeFence(lines: SourceLine[], startIdx: number, fence: FenceInfo): number {
  let i = startIdx + 1
  while (i < lines.length) {
    if (isFenceClose(lines[i].text, fence)) return i + 1
    i += 1
  }
  return lines.length // 닫히지 않음 → 문서 끝까지
}

/** 여는 `:::` 줄(startIdx)부터 짝이 되는 닫는 줄까지 소비하고, 그 다음 줄 인덱스를 돌려준다. */
function consumeContainer(lines: SourceLine[], startIdx: number): number {
  let depth = 1
  let i = startIdx + 1
  while (i < lines.length) {
    const text = lines[i].text
    // 펜스 안의 `:::`는 컨테이너로 세지 않는다(코드 예시가 깊이를 흐트러뜨리지 않게).
    const fence = matchFenceOpen(text)
    if (fence) {
      i = consumeFence(lines, i, fence)
      continue
    }
    const dir = matchDirective(text)
    if (dir === 'open') depth += 1
    else if (dir === 'close') {
      depth -= 1
      if (depth === 0) return i + 1
    }
    i += 1
  }
  return lines.length // 닫히지 않음 → 문서 끝까지
}

/**
 * 최상위 블록 목록. 항상 오름차순·비중첩이며, 블록 밖에 남는 문자는 공백·개행뿐이다.
 */
export function scanBlocks(source: string): BlockRange[] {
  if (!source) return []
  const lines = splitLines(source)
  const blocks: BlockRange[] = []
  let i = 0

  while (i < lines.length) {
    if (isBlank(lines[i])) {
      i += 1
      continue
    }
    const start = lines[i].start
    let end = lines[i].end

    // 빈 줄을 만날 때까지 한 블록. 도중에 펜스·컨테이너가 열리면 그 구조 전체를 통째로 삼킨다
    // (문단 바로 다음 줄에서 펜스가 시작하는 경우에도 구조가 갈라지지 않는다).
    while (i < lines.length && !isBlank(lines[i])) {
      const fence = matchFenceOpen(lines[i].text)
      if (fence) {
        i = consumeFence(lines, i, fence)
        end = lines[i - 1].end
        continue
      }
      if (matchDirective(lines[i].text) === 'open') {
        i = consumeContainer(lines, i)
        end = lines[i - 1].end
        continue
      }
      end = lines[i].end
      i += 1
    }

    blocks.push({ start, end })
  }

  return blocks
}
