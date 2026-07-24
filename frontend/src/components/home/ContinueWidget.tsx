import { Link } from 'react-router-dom'
import { useDashboard } from '../../api/dashboard'
import ProgressBar from '../ProgressBar'

// 홈 위젯: 이어하기 (설계 §5.1). 데이터 0건이면 표시하지 않는다(기존 관례).
export default function ContinueWidget() {
  const { data } = useDashboard()
  if (!data || data.continue.length === 0) return null

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-primary">이어하기</h2>
      <div className="flex flex-col gap-2">
        {data.continue.slice(0, 3).map((card) => (
          <div key={card.category_id} className="rounded-lg border border-border bg-surface p-3">
            <p className="mb-1 truncate text-sm text-primary" title={card.path}>
              {card.path}
            </p>
            <div className="mb-2">
              <ProgressBar
                value={card.total > 0 ? card.done / card.total : 0}
                label={`${card.done}/${card.total}`}
              />
            </div>
            <Link
              to={`/study/${card.category_id}`}
              className="inline-block rounded bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90"
            >
              이어하기
            </Link>
          </div>
        ))}
      </div>
    </section>
  )
}
