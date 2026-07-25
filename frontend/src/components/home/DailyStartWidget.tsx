import { useNavigate } from 'react-router-dom'
import { useDashboard } from '../../api/dashboard'

// 경로에서 마지막 1~2단계만 짧게 표기(예: "…/2과목/Ch.3" → "2과목 Ch.3").
function shortPath(path: string): string {
  const segs = path.split('/').filter(Boolean)
  return segs.slice(-2).join(' ')
}

// 홈 위젯: 원탭 데일리 세션 (설계 §5.1, F36-①). [오늘 공부 시작] + 분량 예고.
// 복습 잔여가 있으면 /review로, 없으면 곧장 이어하기(/study/:id)로. 복습 0·이어하기 0이면 미표시.
export default function DailyStartWidget() {
  const navigate = useNavigate()
  const { data } = useDashboard()
  if (!data) return null

  const reviewCount = data.today_review
  const cont = data.continue[0] ?? null
  if (reviewCount <= 0 && !cont) return null

  const minutes = data.today_review_minutes
  const parts: string[] = []
  if (reviewCount > 0) parts.push(`복습 ${reviewCount}`)
  if (cont) parts.push(`${shortPath(cont.path)} 이어하기`)
  const preview = parts.join(' + ') + (minutes != null && minutes > 0 ? ` · 예상 ${minutes}분` : '')

  function start() {
    if (reviewCount > 0) navigate('/review')
    else if (cont) navigate(`/study/${cont.category_id}`)
  }

  return (
    <section>
      <div className="rounded-lg border border-accent bg-accent-soft p-4">
        <p className="mb-1 text-sm font-semibold text-accent">오늘 공부</p>
        <p className="mb-3 text-sm text-primary">{preview}</p>
        <button
          type="button"
          onClick={start}
          className="w-full rounded bg-accent px-4 py-2.5 text-sm font-medium text-on-accent hover:opacity-90"
        >
          오늘 공부 시작 ▶
        </button>
      </div>
    </section>
  )
}
