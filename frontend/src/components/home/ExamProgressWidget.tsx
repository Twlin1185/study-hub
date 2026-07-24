import { useCategoryTree } from '../../api/categories'
import ExamProgressDonut from '../ExamProgressDonut'

// 홈 위젯: 시험별 진도 도넛 (설계 §5.1). 진도 값이 있는 최상위 분류가 없으면 표시하지 않는다.
export default function ExamProgressWidget() {
  const { data } = useCategoryTree()
  const items = (data ?? []).filter((n) => n.progress != null)
  if (items.length === 0) return null

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-primary">시험별 진도</h2>
      <div className="flex flex-wrap gap-3">
        {items.map((n) => (
          <ExamProgressDonut key={n.id} name={n.name} progress={n.progress ?? 0} />
        ))}
      </div>
    </section>
  )
}
