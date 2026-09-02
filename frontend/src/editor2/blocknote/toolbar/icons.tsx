// 툴바 **자체 인라인 아이콘**(stage-46 F-4 · 규약 B) — 밑줄·글자 크기 **2개뿐**이다.
//
// **왜 자체 SVG인가**: `react-icons`는 잠금 파일에 없다(BlockNote 0.54는 자체 번들 SVG를 쓴다).
// 아이콘 2개 때문에 신규 의존을 들이지 않는다(규약 B·F — 신규 의존 0 · D10 심사 회피).
// **왜 2개뿐인가**: 전면 아이콘화는 M35 종결 관례상 하지 않는다 — 나머지 방언 버튼(코드·형광펜·
// 스포일러·글자색·바탕색·참조 등)은 한글 텍스트 라벨 그대로다.
//
// 색은 전부 `currentColor` — SVG에 색 리터럴 0개다(불변 규칙 5). 버튼이 상속하는 글자색을 그대로
// 따라가므로 다크 모드·눌림(active) 상태도 토큰만으로 공짜로 맞는다.
// 결은 코어 기본 버튼(굵게·기울임 등 스트로크 계열 24px 글리프)에 맞춰 `viewBox="0 0 24 24"` ·
// `stroke-width 2` · 둥근 끝으로 통일한다.

const COMMON = {
  viewBox: '0 0 24 24',
  width: '1em',
  height: '1em',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
} as const

/** 밑줄 — "U" 획 + 아래 밑줄 바. */
export function UnderlineIcon() {
  return (
    <svg {...COMMON}>
      <path d="M7 4v7a5 5 0 0 0 10 0V4" />
      <path d="M5 20h14" />
    </svg>
  )
}

/** 글자 크기 — 큰 "A"와 작은 "A"(크기 대비 자체가 기능 설명이다). */
export function TextSizeIcon() {
  return (
    <svg {...COMMON}>
      <path d="M2 19 8 5l6 14" />
      <path d="M4.2 14.4h7.6" />
      <path d="M15 19l3.5-8.5L22 19" />
      <path d="M16.3 16.2h4.4" />
    </svg>
  )
}
