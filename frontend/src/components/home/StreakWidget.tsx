import { useStreak } from '../../api/stats'

// 홈 위젯: 스트릭 (설계 §5.1, S10, F26). "N일 연속 학습" + 오늘 진행(목표 설정 시 게이지 +
// goal_met 달성 배지) + 최고 기록. 스트릭 0 그리고 목표 미설정이면 위젯 미표시(기존 0건 관례).
// 데이터는 서버 파생값을 그대로 표시만 한다 — 클라이언트 재계산 없음.
export default function StreakWidget() {
  const { data } = useStreak()
  if (!data) return null

  const hasGoal = data.today.goal.questions != null || data.today.goal.minutes != null
  if (data.current_streak <= 0 && !hasGoal) return null

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-primary">스트릭</h2>
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-2xl font-semibold text-primary">
            {data.current_streak}일 연속 학습
            {data.today.goal_met && (
              <span className="ml-2 rounded bg-correct px-1.5 py-0.5 align-middle text-xs font-medium text-on-accent">
                목표 달성
              </span>
            )}
          </p>
          <p className="text-xs text-muted">최고 {data.best_streak}일</p>
        </div>

        {hasGoal && (
          <div className="mt-3 flex flex-col gap-1.5">
            {data.today.goal.questions != null && (
              <GoalGauge label="문제" current={data.today.questions} goal={data.today.goal.questions} unit="개" />
            )}
            {data.today.goal.minutes != null && (
              <GoalGauge label="시간" current={data.today.minutes} goal={data.today.goal.minutes} unit="분" />
            )}
          </div>
        )}
      </div>
    </section>
  )
}

function GoalGauge({ label, current, goal, unit }: { label: string; current: number; goal: number; unit: string }) {
  const ratio = goal > 0 ? Math.min(1, current / goal) : 0
  const met = current >= goal
  return (
    <div>
      <div className="mb-0.5 flex items-center justify-between text-xs text-muted">
        <span>{label}</span>
        <span className={met ? 'text-correct' : 'text-muted'}>
          {current}
          {unit}/{goal}
          {unit}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg">
        <div
          className={`h-full rounded-full ${met ? 'bg-correct' : 'bg-accent'}`}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
    </div>
  )
}
