import { NavLink } from 'react-router-dom'

const TABS = [
  { to: '/quiz', label: '일반 퀴즈' },
  { to: '/exam', label: '실전 모의고사' },
]

// 퀴즈 설정 화면 상단 탭(설계 §5.6, §5.12) — 일반 퀴즈(즉시 채점)와 실전 모의고사(일괄 제출)는
// 경로가 완전히 분리된 별도 흐름이라 탭은 라우트 전환만 담당한다.
export default function QuizExamTabs() {
  return (
    <div className="mb-4 flex gap-1 rounded-lg border border-border bg-surface p-1">
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end
          className={({ isActive }) =>
            `flex-1 rounded-md px-3 py-2 text-center text-sm font-medium transition-colors ${
              isActive ? 'bg-accent text-on-accent' : 'text-muted hover:bg-bg hover:text-primary'
            }`
          }
        >
          {t.label}
        </NavLink>
      ))}
    </div>
  )
}
