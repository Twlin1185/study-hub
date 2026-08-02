import type { ImproveCaseOrigin, ImproveProposalKind, ImproveRegressionOutcome } from '../../api/types'

// 설계 §4.22 — 반입 개선 루프 전용 라벨·색 매핑(공용). 색상은 전부 토큰 클래스만 사용한다
// (불변 규칙 5) — 여기서 하드코딩 색상 값을 두지 않는다.

export const ORIGIN_LABEL: Record<ImproveCaseOrigin, string> = {
  convert_job: '변환 실패',
  fetch_job: '수집 실패',
  gate: '신뢰 게이트 탈락',
  report: '오류 신고',
}

// kind는 origin별 error_info.kind(또는 게이트·신고 전용 값)를 그대로 담아 서버가 화이트리스트를
// 못박지 않는다(§4.22 ①) — 알려진 값만 한국어 라벨, 나머지는 원문 그대로 보여준다.
const KIND_LABEL: Record<string, string> = {
  parse_failed: '파싱 실패',
  unsupported_format: '미지원 형식',
  invalid_output: '출력 불완전',
  fabrication_suspect: '창작 의심(게이트)',
  user_report: '사용자 신고',
}

export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind
}

export const PROPOSAL_KIND_LABEL: Record<ImproveProposalKind, string> = {
  casebook: '사례집 추가',
  prompt_edit: '프롬프트 수정',
  code_issue: '코드 수정 필요',
}

export const PROPOSAL_KIND_BADGE_CLASS: Record<ImproveProposalKind, string> = {
  casebook: 'bg-accent-soft text-accent',
  prompt_edit: 'bg-warning text-on-accent',
  code_issue: 'bg-wrong text-on-accent',
}

export const REGRESSION_OUTCOME_LABEL: Record<ImproveRegressionOutcome, string> = {
  passed: '통과(재발 없음)',
  still_failing: '재발(같은 유형)',
  failed_differently: '다르게 실패',
  unavailable: '원본 접근 불가',
}

export const REGRESSION_OUTCOME_BADGE_CLASS: Record<ImproveRegressionOutcome, string> = {
  passed: 'bg-correct text-on-accent',
  still_failing: 'bg-wrong text-on-accent',
  failed_differently: 'bg-warning text-on-accent',
  unavailable: 'border border-border text-muted',
}
