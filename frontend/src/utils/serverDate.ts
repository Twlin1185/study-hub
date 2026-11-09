// 서버 시각 표기 2종 (stage-57 FB-33 실측 분류)
// - UTC naive = DB 컬럼 유래(notes·documents·review_notes 등 current_timestamp) + import_runs
//   -> `parseServerDate`로 해석한다.
// - 서버 로컬 naive = 인메모리 잡(created_at·started_at·finished_at·progress.last_activity_at)·
//   LLM 상태(resets_at·last_success_at)·improve 파일(created_at·last_seen_at·run_at·decided_at)
//   -> `new Date(iso)` 그대로(브라우저 로컬 해석이 맞다. parseServerDate 적용 금지).
// - DATE 키(히트맵 등) = 서버 로컬 날짜 -> `toLocalDateKey`.

/**
 * 서버 시각 문자열 → Date.
 *
 * `notes` 응답의 `created_at`/`updated_at`은 **타임존 표기 없는 UTC naive ISO**다
 * (§4.28 ② 예시 `"2026-08-16T21:03:11"`). 브라우저는 그런 문자열을 **로컬 시각**으로 해석하므로
 * KST(+9) 환경에서 9시간 과거로 읽힌다(2026-08-16 통합 스모크 실측 — "9시간 전"으로 표시됨).
 * 오프셋(`Z`·`+09:00`·`+0900`)이 이미 붙어 있으면 그대로 둔다(서버 포맷이 바뀌어도 안전).
 */
export function parseServerDate(iso: string | null | undefined): Date {
  const text = (iso ?? '').trim()
  if (!text) return new Date(Number.NaN)
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)
  return new Date(hasZone ? text : `${text}Z`)
}

/** 로컬 달력 날짜 `YYYY-MM-DD` (toISOString의 UTC 날짜 직렬화 결함 회피). */
export function toLocalDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
