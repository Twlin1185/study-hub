// 짧은 한 줄 필드(문제 보기 `choices` · 오답노트 메모)의 인라인 방언 렌더 (stage-36 규약 C).
//
// 저장 계약은 무변 — 이 필드들은 여전히 평문 문자열이다(`documents.choices`·`review_notes.note`
// — DDL 0·API 0). 편집 UI도 기존 폼(텍스트 입력·textarea) 그대로 두고, 여기서는 **공용
// MarkdownView를 그대로 재사용**(신규 파서·보기 전용 신규 렌더 경로 0)해 F51/F52 인라인 방언
// (밑줄·형광펜·글자색/크기·인라인 스포일러·굵게 등)만 해석한다.
//
// MarkdownView는 항상 블록 래퍼(`<div class="markdown-body">…<p>…</p></div>`)를 낸다 — 이 파일은
// 그 컴포넌트를 수정하지 않고(불변 규칙 — MarkdownView 본체 수정 금지) **바깥에서 CSS로만**
// 버튼·목록 항목 한 줄에 자연스럽게 끼워 넣는다:
//   · `!text-inherit` — 루트 div가 스스로 지정하는 `text-primary`를 지운다. 그래야 이 텍스트를
//     감싸는 상위 요소의 상태색(정답=correct·오답=wrong 등)이 그대로 비친다. `:t[]{c=…}` 같은
//     명시적 잉크 지정은 그 노드 자신이 색을 다시 선언하므로 이 규칙에 영향받지 않는다(자식 요소만
//     타깃 — `*` 전체 하위가 아니라 루트 1곳).
//   · `!m-0` · `!inline` — 문단의 기본 세로 여백·블록 표시를 없애 한 줄 흐름에 맞춘다.
// breaks는 **항상 false** — 방언 문법이 없는 기존 문자열은 개행 삽입 하나 없이 예전 `<span>` 렌더와
// 정확히 같은 문자만 보여야 한다("렌더 diff 0" 계약, 원래 <span> 렌더도 개행을 시각적으로 살리지
// 않았다).
import MarkdownView from '../MarkdownView'
import type { MarkdownScale } from '../../api/types'

interface InlineRichTextProps {
  content: string | null | undefined
  // 호출부의 주변 글자 크기와 맞춘다(S28 문서 스타일 확대 등) — 지정하지 않으면 MarkdownView
  // 기본값(default = text-sm)을 쓴다.
  scale?: MarkdownScale
}

const WRAPPER_CLASS =
  '[&_.markdown-body]:inline [&_.markdown-body]:!text-inherit [&_.markdown-body_p]:!m-0 [&_.markdown-body_p]:!inline'

export default function InlineRichText({ content, scale }: InlineRichTextProps) {
  if (!content) return null
  return (
    <span className={WRAPPER_CLASS}>
      <MarkdownView content={content} scale={scale} breaks={false} />
    </span>
  )
}
