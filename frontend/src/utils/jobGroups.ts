import type { LlmJobItem } from '../api/types'

export type JobEntry =
  | { type: 'single'; item: LlmJobItem }
  | { type: 'group'; runId: number; label: string; items: LlmJobItem[] }

// stage-57 규약 G — 같은 run의 잡이 2개 이상일 때만 그룹. 서버 순서 보존,
// 그룹은 그 run의 첫 항목 자리에 1번 놓는다.
export function groupJobsByRun(items: LlmJobItem[]): JobEntry[] {
  const counts = new Map<number, number>()
  for (const it of items) {
    if (it.run_id != null) counts.set(it.run_id, (counts.get(it.run_id) ?? 0) + 1)
  }
  const out: JobEntry[] = []
  const groups = new Map<number, Extract<JobEntry, { type: 'group' }>>()
  for (const it of items) {
    const rid = it.run_id
    if (rid == null || (counts.get(rid) ?? 0) < 2) {
      out.push({ type: 'single', item: it })
      continue
    }
    let g = groups.get(rid)
    if (!g) {
      g = { type: 'group', runId: rid, label: '', items: [] }
      groups.set(rid, g)
      out.push(g)
    }
    g.items.push(it)
  }
  for (const g of groups.values()) {
    const named = g.items.find((i) => i.run_label != null)
    g.label = named?.run_label ?? g.items[0].label
  }
  return out
}
