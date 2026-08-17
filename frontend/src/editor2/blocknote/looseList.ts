// 붙여넣기 전처리 — **느슨한 목록(loose list)의 HTML 표식을 Markdown이 읽을 수 있는 형태로 편다**
// (결함 U-3 "항목 사이 빈 줄이 가끔 사라진다").
//
// 왜 필요한가:
//   붙여넣기 경로는 `text/html` → `htmlToDialectMarkdown` → Markdown → 블록이다. 그런데 CommonMark
//   렌더러(웹 문서 대부분·이 앱의 `MarkdownView` 포함)는 **느슨한 목록의 항목 내용을 `<p>`로 감싸
//   내보낸다** — 그것이 HTML에 남는 유일한 "느슨함" 표식이다(CommonMark spec §5.3 "loose list":
//   느슨한 목록은 항목 내용을 문단으로 감싸 렌더한다). `htmlToDialectMarkdown`은 `<li>` 안의
//   `<p>`를 한 줄로 접으므로(`convertList` → `normalizeInline`) 그 표식이 사라지고, 결과 Markdown이
//   **tight 목록**이 되어 빈 줄이 조용히 없어진다.
//
//   반대로 `<ul>` 두 벌을 붙여넣는 경우(항목 사이가 아니라 목록 사이가 갈라진 형태)는 변환기가
//   목록 사이에 빈 줄을 넣어 방출하므로 이미 loose로 살아난다 — 그래서 사용자에게는 "**가끔**
//   사라진다"로 보였다(stage-34 사용자 확인 항목 "붙여넣기 느슨한 목록").
//
// 무엇을 하는가:
//   느슨한 목록으로 판정된 `<ul>`/`<ol>`을 **항목당 한 벌씩**의 형제 목록으로 쪼갠다. 그러면
//   기존 변환기가 각 목록 사이에 빈 줄을 넣어 방출하고("- A\n\n- B"), CommonMark가 그것을
//   **빈 줄로 갈라진 한 개의 느슨한 목록**으로 되읽는다(같은 마커라 새 목록으로 끊기지 않는다 —
//   stage-34 §"목록 그룹 경계" 참조). 변환기 자체(`utils/htmlPasteMarkdown.ts`)는 1바이트도
//   건드리지 않는다(D9 격리 계약 — editor2는 그 모듈을 import만 한다).
//
// 판정에서 **제외**하는 것: `<p class="bn-inline-content">` — BlockNote 자신이 내보내는 외부 HTML의
//   인라인 컨테이너다(편집기 안에서 복사하면 tight·loose를 가리지 않고 항상 이 모양이 나온다).
//   근거로 삼으면 편집기 안 복사·붙여넣기마다 없던 빈 줄이 생긴다. 즉 **편집기 내부 복사본은
//   느슨함 정보를 담지 못한다**(느슨함은 사이드카에만 있다) — 이 전처리의 알려진 한계다.

/** BlockNote 외부 HTML의 인라인 컨테이너 표식 — 느슨함의 근거로 쓰지 않는다(위 머리말). */
const BN_INLINE_CLASS = 'bn-inline-content'

function tagOf(el: Element): string {
  return el.tagName.toLowerCase()
}

/** 이 항목이 "내용을 문단으로 감싼" 형태인가 = CommonMark 렌더러가 남긴 느슨함 표식. */
function hasParagraphChild(li: Element): boolean {
  for (const child of Array.from(li.children)) {
    if (tagOf(child) !== 'p') continue
    if (child.classList.contains(BN_INLINE_CLASS)) continue
    return true
  }
  return false
}

function directItems(list: Element): Element[] {
  return Array.from(list.children).filter((child) => tagOf(child) === 'li')
}

/**
 * 느슨한 목록을 항목당 한 벌의 목록으로 쪼갠다. 쪼갠 목록은 원본과 **같은 태그·같은 속성**이라
 * 변환기가 같은 마커(`- ` / `1. `)로 방출한다 — CommonMark가 한 개의 느슨한 목록으로 되읽는
 * 조건이다. 항목이 1개뿐이면 "항목 사이"가 없으므로 손대지 않는다(Markdown으로 표현할 수도 없다).
 */
function splitLooseList(list: Element): boolean {
  const items = directItems(list)
  if (items.length < 2) return false
  if (!items.some(hasParagraphChild)) return false
  const parent = list.parentNode
  if (!parent) return false

  for (const li of items) {
    // 얕은 복제 = 같은 태그 + 같은 속성, 자식 없음. 항목을 옮겨 담으면 중첩 목록도 함께 따라온다.
    const holder = list.cloneNode(false) as Element
    holder.appendChild(li)
    parent.insertBefore(holder, list)
  }
  // 원본에는 이제 항목이 아닌 잔여 노드(공백 텍스트 등)만 남는다 — 통째로 걷어낸다.
  parent.removeChild(list)
  return true
}

/**
 * 클립보드 HTML 문자열 전처리 — 느슨한 목록을 항목당 한 벌의 목록으로 편 HTML을 돌려준다.
 * 바꿀 것이 없으면 **원본 문자열을 그대로** 돌려준다(변환 경로에 불필요한 재직렬화를 넣지 않는다).
 */
export function expandLooseLists(html: string): string {
  if (!html || !html.trim()) return html
  // 목록 표식이 아예 없으면 파싱조차 하지 않는다(붙여넣기 대부분이 여기서 끝난다).
  if (!/<li[\s>]/i.test(html)) return html

  const doc = new DOMParser().parseFromString(html, 'text/html')
  const body = doc.body
  if (!body) return html

  // 중첩 목록도 각자 판정한다 — 부모를 쪼개도 자식 목록은 항목 안에 그대로 실려 따라간다.
  let changed = false
  for (const list of Array.from(body.querySelectorAll('ul, ol'))) {
    if (splitLooseList(list)) changed = true
  }
  return changed ? body.innerHTML : html
}
