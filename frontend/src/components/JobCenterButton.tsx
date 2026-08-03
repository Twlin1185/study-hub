import { activeJobCount, useLlmJobs } from '../api/llm'

interface JobCenterButtonProps {
  onClick: () => void
  // 접힘 레일(사이드바 collapsed) — 아이콘 + title 툴팁 + 배지 점(숫자 아님, 설계 §5·§4.24 ⑥).
  compact?: boolean
}

// 설계 §5 공통 레이아웃·§4.24 ⑥(S22, F48) — "LLM 작업" 진입점. 사이드바(펼침/접힘)·모바일 좌측
// 드로어가 이 컴포넌트 하나를 공유한다. 라우트 이동이 아니라 전역 패널을 여는 버튼이라
// NavLink가 아닌 button — F39 도움말 항목 배치 관례상 그 바로 위에 둔다.
export default function JobCenterButton({ onClick, compact }: JobCenterButtonProps) {
  const jobsQuery = useLlmJobs()
  const count = activeJobCount(jobsQuery.data)

  if (compact) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={count > 0 ? `LLM 작업 (${count})` : 'LLM 작업'}
        aria-label="LLM 작업"
        className="relative flex items-center justify-center rounded px-2 py-2 text-sm text-muted hover:bg-bg hover:text-primary"
      >
        <span aria-hidden>🧠</span>
        {count > 0 && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-wrong" aria-hidden />}
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 rounded px-3 py-2 text-left text-sm text-muted transition-colors hover:bg-bg hover:text-primary"
    >
      <span aria-hidden>🧠</span>
      <span>LLM 작업</span>
      {count > 0 && (
        <span className="ml-auto rounded-full bg-wrong px-1.5 py-0.5 text-[10px] font-semibold leading-none text-on-accent">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  )
}
