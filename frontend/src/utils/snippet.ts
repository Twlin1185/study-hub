// 검색 스니펫 렌더링 — 백엔드가 매칭 부분을 <mark>...</mark>로 감싸 내려준다고 가정(설계 §4.9,
// §5 "스니펫(매칭 부분 하이라이트)"). 전체를 이스케이프한 뒤 <mark>/</mark>만 되살려 그 외의
// 어떤 태그도 실행되지 않도록 한다 (XSS 안전 처리 — stage-6 지시).
export function safeSnippetHtml(raw: string): string {
  const escaped = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
  return escaped.replace(/&lt;mark&gt;/g, '<mark>').replace(/&lt;\/mark&gt;/g, '</mark>')
}
