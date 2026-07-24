import { useWeakness } from '../../api/stats'
import WeaknessWidget from '../WeaknessWidget'

// 홈 위젯: 자꾸 틀리는 개념 Top 10 (설계 §5.1). 빈 상태 메시지는 WeaknessWidget이 자체 처리.
export default function WeaknessSectionWidget() {
  const { data, isLoading, isError } = useWeakness(null, 10)

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-primary">자꾸 틀리는 개념 Top 10</h2>
      {isLoading && <p className="text-sm text-muted">불러오는 중…</p>}
      {isError && <p className="text-sm text-wrong">약점 데이터를 불러오지 못했습니다.</p>}
      {data && <WeaknessWidget items={data} />}
    </section>
  )
}
