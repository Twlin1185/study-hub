import type { LlmJobItem, LlmJobKind, LlmJobRef } from '../api/types'

// 설계 §4.24 ⓓ(S22, F48) — kind→ref→화면 매핑 "상수 1곳". JobCenterPanel의 [화면으로 이동]과
// 재진입 복원 훅이 같은 표를 근거로 삼는다(개별 구현 금지). 모르는(미래) kind는 여기 없으므로
// jobCenterRoute()가 null을 반환해 호출부가 링크를 렌더하지 않는다(전방 호환 — alternatives 관례).
//
// convert·fetch·answer_key·applied_exam·improve_proposal·improve_regression은 화면 자체가
// 고정 라우트라 ref 없이도 이동 가능하다(그 화면 안에서 복원 훅·기존 localStorage가 구체 잡을
// 다시 찾는다). regenerate·explain만 문서별 화면이라 ref.document_id가 있어야 이동할 수 있다.
const JOB_KIND_ROUTES: Partial<Record<LlmJobKind, (ref: LlmJobRef) => string | null>> = {
  convert: () => '/import',
  fetch: () => '/import',
  answer_key: () => '/import?mode=answer_key',
  regenerate: (ref) => (ref.document_id != null ? `/docs/${ref.document_id}` : null),
  explain: (ref) => (ref.document_id != null ? `/docs/${ref.document_id}` : null),
  applied_exam: () => '/exam?mode=applied',
  improve_proposal: () => '/suggestions?tab=improve',
  improve_regression: () => '/suggestions?tab=improve',
  // S23(§4.25, F49) — split_id가 있으면 딥링크로 곧장 붙이고(위저드가 GET으로 상태를 이어
  // 받는다), 없어도 answer_key와 같은 kind-only 복원 관례로 화면은 연다(위저드 내부
  // useJobRecovery가 kind만으로 매칭해 splitId를 스스로 찾는다).
  split_analyze: (ref) =>
    ref.split_id
      ? `/import?mode=split_import&split_id=${encodeURIComponent(ref.split_id)}`
      : '/import?mode=split_import',
}

export function jobCenterRoute(item: Pick<LlmJobItem, 'kind' | 'ref'>): string | null {
  const fn = JOB_KIND_ROUTES[item.kind]
  if (!fn) return null
  return fn(item.ref ?? {})
}
