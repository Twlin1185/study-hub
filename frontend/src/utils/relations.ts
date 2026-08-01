// 문서 관계 목록 필터 (설계 §4.19 ⑦ — F43).
//
// `DocumentDetail.relations`에는 사용자가 만든 관계(explains·related·prerequisite)와
// **본문 임베드에서 자동 생성된 파생 행(relation='embeds', created_by='embed')** 이 함께 온다.
// 파생 행은 "기존 관계 목록에 섞어 표시하지 않는다"가 확정 계약이므로, 관계 목록을 소비하는
// 모든 화면(문서 상세·퀴즈 해설 등)이 이 유틸을 거쳐 같은 기준으로 걸러낸다 — 화면별 분기 금지.
//
// 판별 기준이 relation 값 하나인 이유: 백엔드 `DocumentRelationOut`에 created_by가 없다
// (backend/schemas/document.py 대조 완료). relation='embeds'는 파생 인덱스 전용 값이라
// 사용자가 직접 만들 수 없다(AddRelationModal 선택지 3종에 없음).
import type { RelatedDocument } from '../api/types'

export function isDerivedRelation(rel: RelatedDocument): boolean {
  return rel.relation === 'embeds'
}

// 사용자 관계만 — 관계 목록·연결 해제·후보 제외 대상.
export function pickManualRelations(relations: RelatedDocument[]): RelatedDocument[] {
  return relations.filter((rel) => !isDerivedRelation(rel))
}

// 이 문서를 임베드한 문서들 — 사용처 역참조 목록·삭제 경고 전용.
export function pickEmbeddedBy(relations: RelatedDocument[]): RelatedDocument[] {
  return relations.filter((rel) => isDerivedRelation(rel) && rel.direction === 'to')
}
