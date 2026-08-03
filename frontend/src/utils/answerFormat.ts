// 정답 표기 공용 포맷터(stage-25, F51) — 화면마다 흩어져 있던 동일 로직을 이 모듈 1곳으로 수렴한다.
// 순수 번호("1"~"9")는 보기 마커(①②③…)로만 표기하고, 괄호 병기("① (1)")는 하지 않는다.
// 그 외 비어 있지 않은 값은 원문(trim)을, 빈 값은 화면별 기본 문구(empty)를 반환한다.

export const CIRCLED_DIGITS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨']

// 보기 목록 렌더용 마커(①~④ 행 머리) — 이 단계에서 동작 변경 없음(그대로 이관).
export function choiceMarker(index: number): string {
  return CIRCLED_DIGITS[index] ?? `${index + 1}.`
}

export function formatAnswer(answer: string | null | undefined, empty = '-'): string {
  if (!answer || !answer.trim()) return empty
  const trimmed = answer.trim()
  if (/^[1-9]$/.test(trimmed)) return CIRCLED_DIGITS[Number(trimmed) - 1] ?? trimmed
  return trimmed
}
