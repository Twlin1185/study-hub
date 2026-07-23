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

export interface LeafGroup {
  id: number
  name: string
  path: string
}

// 선택한 분류 노드 아래의 "리프"(하위가 없는) 분류들을 트리 순서 그대로 수집한다.
// 인쇄 뷰(§5.10)에서 study-track(챕터 단위 정렬)을 리프별로 호출해 목차·섹션을 구성하는 데 사용.
// 노드 자신이 리프면 자기 자신 1건을 반환한다.
export function collectLeafGroups(node: CategoryNode, parentPath = ''): LeafGroup[] {
  const path = parentPath ? `${parentPath} / ${node.name}` : node.name
  if (node.children.length === 0) return [{ id: node.id, name: node.name, path }]
  return node.children.flatMap((child) => collectLeafGroups(child, path))
}
