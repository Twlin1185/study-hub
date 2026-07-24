import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useDashboard } from '../../api/dashboard'
import DDayBadge from '../DDayBadge'
import DDayManager from '../DDayManager'
import Modal from '../Modal'

// 홈 위젯: D-Day (설계 §5.1, F32). 다른 위젯과 달리 데이터 0건이어도(visible이면)
// "등록된 D-Day 없음 + [추가]"로 표시 — 홈에서 첫 등록이 가능해야 하기 때문.
// 헤더 연필 → 설정 §5.11의 DDayManager 컴포넌트를 그대로 재사용한다(새 로직 없음).
export default function DDayWidget() {
  const { data } = useDashboard()
  const [open, setOpen] = useState(false)
  const qc = useQueryClient()

  function closeModal() {
    setOpen(false)
    // 팝업에서 exam_date·ddays.custom을 바꿨을 수 있으므로 배지를 즉시 갱신한다.
    qc.invalidateQueries({ queryKey: ['dashboard'] })
  }

  const ddays = data?.ddays ?? []

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-primary">D-Day</h2>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="D-Day 관리"
          title="D-Day 관리"
          className="rounded p-1 text-muted hover:bg-bg hover:text-primary"
        >
          ✏️
        </button>
      </div>

      {ddays.length === 0 ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2.5">
          <span className="text-sm text-muted">등록된 D-Day가 없습니다.</span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="shrink-0 rounded bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90"
          >
            + 추가
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {ddays.map((d) => (
            <DDayBadge key={`${d.kind}-${d.category_id ?? d.id}`} name={d.name} dDay={d.d_day} kind={d.kind} />
          ))}
        </div>
      )}

      {open && (
        <Modal title="D-Day 관리" onClose={closeModal} widthClass="max-w-lg">
          <DDayManager />
        </Modal>
      )}
    </section>
  )
}
