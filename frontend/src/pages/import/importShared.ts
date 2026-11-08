import { ApiError } from '../../api/client'
import type {
  ImportAction,
  ImportItem,
  ImportItemOverride,
  ImportItemWarning,
} from '../../api/types'

export type WizardStep = 'select' | 'preview' | 'result'

export interface ItemDecisionState {
  action: ImportAction
  // number = 기존 분류 category_id(exists:true) · string = 생성 승인할 경로(exists:false)
  approvedCategoryIds: (number | string)[]
  approvedRelationIds: number[]
  // stage-42(B3, §4.3) — 검토 단계 편집분. 값을 가진 필드만 채워진다(전체 undefined = 미편집).
  override?: ImportItemOverride
}

export const TYPE_LABEL: Record<string, string> = {
  concept: '개념',
  question: '문제',
  past_question: '기출',
  flashcard: '카드',
}

export function errMsg(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback
}

export function toggleValue<T>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value]
}

// stage-42(B3, §4.3) — choices는 문자열 배열 또는 객체 배열(text/content/label 중 하나) 둘 다
// 올 수 있어 방어적으로 해석한다. 알 수 없는 형태는 JSON 문자열로 표시(조용한 누락 금지).
export function choiceLabel(choice: unknown): string {
  if (typeof choice === 'string') return choice
  if (choice && typeof choice === 'object') {
    const obj = choice as Record<string, unknown>
    const val = obj.text ?? obj.content ?? obj.label
    if (typeof val === 'string') return val
  }
  try {
    return JSON.stringify(choice)
  } catch {
    return String(choice)
  }
}

// 분류 제안 승인 식별키 — 기존 분류면 category_id, 생성 제안이면 path 문자열
export function categoryApprovalKey(sc: { category_id: number | null; path: string }): number | string {
  return sc.category_id ?? sc.path
}

// S15(설계 §4.17⑤·⑥) — solved_answer(정답을 LLM이 풀어 채움)·fabrication_suspect(원문 대조
// 실패)는 기본 반입 제외(체크 해제) 대상. match_unavailable(대조 불가)은 배지·안내만이고 기본
// 포함을 유지한다(이미지 PDF 경로 전체가 막히지 않게).
export function hasExclusionWarning(warnings: ImportItemWarning[] | undefined): boolean {
  return warnings?.some((w) => w === 'solved_answer' || w === 'fabrication_suspect') ?? false
}

export function buildInitialDecisions(items: ImportItem[]): Record<number, ItemDecisionState> {
  const initial: Record<number, ItemDecisionState> = {}
  for (const item of items) {
    if (item.status === 'error') continue
    initial[item.index] = {
      action: item.status === 'duplicate_suspect' || hasExclusionWarning(item.warnings) ? 'skip' : 'new',
      // 분류 제안은 기존/생성 제안 모두 기본 체크 — 단, 컨테이너(자식이 있는 중간 노드) 제안은
      // stage-42(B4-S8) 기본 미체크(하위 분류에 연결하는 편이 나아 강제하지 않되 유도).
      approvedCategoryIds: item.suggest_categories
        .filter((sc) => !sc.container)
        .map(categoryApprovalKey),
      approvedRelationIds: item.suggest_relations
        .filter((r) => r.found && r.document_id != null)
        .map((r) => r.document_id as number),
    }
  }
  return initial
}
