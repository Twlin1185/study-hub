import type { CategoryNode } from '../api/types'

export interface FlatCategory {
  id: number
  name: string
  depth: number
}

export function flattenCategories(nodes: CategoryNode[], depth = 0): FlatCategory[] {
  const out: FlatCategory[] = []
  for (const node of nodes) {
    out.push({ id: node.id, name: node.name, depth })
    out.push(...flattenCategories(node.children, depth + 1))
  }
  return out
}

export function findCategory(nodes: CategoryNode[], id: number): CategoryNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    const found = findCategory(node.children, id)
    if (found) return found
  }
  return null
}

// id 노드가 속한 형제 배열(같은 부모의 자식 목록)을 찾는다. 최상위면 nodes 자체.
export function findSiblingList(nodes: CategoryNode[], id: number): CategoryNode[] | null {
  if (nodes.some((n) => n.id === id)) return nodes
  for (const node of nodes) {
    const found = findSiblingList(node.children, id)
    if (found) return found
  }
  return null
}

// 같은 부모의 다음 형제 분류 id (학습 모드 "다음 챕터 ▶"용). 없으면 null.
export function findNextSiblingId(nodes: CategoryNode[], id: number): number | null {
  const siblings = findSiblingList(nodes, id)
  if (!siblings) return null
  const idx = siblings.findIndex((n) => n.id === id)
  const next = idx >= 0 ? siblings[idx + 1] : undefined
  return next ? next.id : null
}

// id 자신과 모든 자손 id 집합 (이동 시 순환 방지용 프론트 사전 검증 — 최종 판단은 서버 409)
export function collectDescendantIds(node: CategoryNode): Set<number> {
  const ids = new Set<number>([node.id])
  for (const child of node.children) {
    for (const id of collectDescendantIds(child)) ids.add(id)
  }
  return ids
}

// 루트부터 해당 분류까지 '/'로 이은 경로 문자열 (백엔드 tree_utils.category_path와 같은 규칙).
// 반입 분류 경로 지정(F40-③, §4.11 `category_path`)이 서버와 같은 형식을 보내야 하므로 구분자는
// 공백 없는 '/'다 — 표시용 collectLeafGroups(' / ')와 혼동하지 말 것.
export function findCategoryPath(nodes: CategoryNode[], id: number): string | null {
  for (const node of nodes) {
    if (node.id === id) return node.name
    const childPath = findCategoryPath(node.children, id)
    if (childPath) return `${node.name}/${childPath}`
  }
  return null
}

export interface LeafGroup {
  id: number
  name: string
  path: string
}

// 선택한 분류 노드 아래의 "리프"(하위가 없는) 분류들을 트리 순서 그대로 수집한다.
// 인쇄 뷰(§5.10)에서 study-track(챕터 단위 정렬)을 리프별로 호출해 목차·섹션을 구성하는 데 사용.
// 노드 자신이 리프면 자기 자신 1건을 반환한다.
//
// 핫픽스 — 리프만 모으면 자식 있는 컨테이너 노드에 직접 연결된 문서(합법적인 구성)가 인쇄에서
// 통째로 빠진다. 컨테이너 노드도 직속 문서(doc_count > 0)가 있으면 자기 자신을 별도 그룹으로
// 포함한다(study-track은 deep 미지정이라 해당 노드 직속 문서만 반환 — 하위 리프 그룹과 중복 없음).
export function collectLeafGroups(node: CategoryNode, parentPath = ''): LeafGroup[] {
  const path = parentPath ? `${parentPath} / ${node.name}` : node.name
  if (node.children.length === 0) return [{ id: node.id, name: node.name, path }]
  const ownDocGroup: LeafGroup[] = node.doc_count > 0 ? [{ id: node.id, name: node.name, path }] : []
  return [...ownDocGroup, ...node.children.flatMap((child) => collectLeafGroups(child, path))]
}
