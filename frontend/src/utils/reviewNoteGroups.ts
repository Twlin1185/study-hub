import type { ReviewNote } from '../api/types'

export const UNCATEGORIZED = '미분류'

export interface SubGroup {
  subheading: string
  notes: ReviewNote[]
}

export interface TopGroup {
  header: string
  subgroups: SubGroup[]
  count: number
}

// 설계 §5.8 — 분류 경로(category_path) 기준 계층 그룹. 상위 단위(대단위) 헤더 → 하위 단위 소제목.
// 서버가 이미 "선택 범위 안 경로 우선, 없으면 첫 연결 경로" 규칙으로 1개 경로만 계산해 내려주므로
// 프론트는 그 문자열을 '/'로 분해해 표시만 담당한다. 분류 연결이 없으면 "미분류" 그룹.
// 오답노트 화면(§5.8)과 오답노트 인쇄 뷰(§5.10) 양쪽에서 공용으로 사용한다.
export function groupByCategoryPath(notes: ReviewNote[]): TopGroup[] {
  const order: string[] = []
  const map = new Map<string, Map<string, ReviewNote[]>>()

  for (const note of notes) {
    const path = note.document.category_path
    const segments = path ? path.split('/').filter(Boolean) : []
    const header = segments[0] ?? UNCATEGORIZED
    const subheading = segments.length > 1 ? segments.slice(1).join(' / ') : header

    if (!map.has(header)) {
      map.set(header, new Map())
      order.push(header)
    }
    const sub = map.get(header)!
    if (!sub.has(subheading)) sub.set(subheading, [])
    sub.get(subheading)!.push(note)
  }

  order.sort((a, b) => (a === UNCATEGORIZED ? 1 : b === UNCATEGORIZED ? -1 : 0))

  return order.map((header) => {
    const subMap = map.get(header)!
    const subgroups = [...subMap.entries()].map(([subheading, ns]) => ({ subheading, notes: ns }))
    const count = subgroups.reduce((sum, g) => sum + g.notes.length, 0)
    return { header, subgroups, count }
  })
}
