import { useEffect, useRef, useState } from 'react'
import type { JobPhase, JobProgress } from '../api/types'

// 설계 §4.11 "잡 진행 가시화" — convert/regenerate 폴링 응답의 progress를 렌더한다.
// 5단계 스텝(다운로드→준비→LLM 작업 중→결과 정리→미리보기) + 경과 시간 + 토큰/비용 라이브
// 카운터 + 대략 ETA + "새로고침해도 이어짐" 안내. last_activity_at이 STALE_MS 이상 갱신되지
// 않으면 "응답 지연" 배지를 보여준다(진짜 심장박동 신호).
const PHASE_LABELS: Record<JobPhase, string> = {
  fetching: '사이트 수집',
  downloading: '다운로드',
  preparing: '준비',
  llm_running: 'LLM 작업 중',
  parsing: '결과 정리',
  preview_building: '미리보기 준비',
}

const ALL_PHASES: JobPhase[] = ['fetching', 'downloading', 'preparing', 'llm_running', 'parsing', 'preview_building']

const STALE_MS = 30_000

function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return `${min}:${String(sec).padStart(2, '0')}`
}

function formatEta(ms: number): string {
  const min = Math.round(ms / 60000)
  if (min <= 0) return '곧 완료'
  return `약 ${min}분`
}

const KEEP_ALIVE_NOTE = '새로고침해도 작업은 서버에서 계속됩니다.'

interface LlmJobProgressProps {
  progress: JobProgress | null | undefined
  // URL 반입일 때만 '다운로드' 스텝을 보여준다 (파일 업로드·재생성은 다운로드 단계가 없음).
  includeDownloading?: boolean
  // 사이트에서 가져오기(S10, §4.13)일 때만 '사이트 수집' 스텝을 보여준다.
  includeFetching?: boolean
}

export default function LlmJobProgress({
  progress,
  includeDownloading = true,
  includeFetching = false,
}: LlmJobProgressProps) {
  const [tickMs, setTickMs] = useState(0)
  const baseRef = useRef<{ elapsed: number; at: number }>({ elapsed: 0, at: Date.now() })

  useEffect(() => {
    if (!progress) return
    baseRef.current = { elapsed: progress.elapsed_ms, at: Date.now() }
    setTickMs(0)
    const id = window.setInterval(() => {
      setTickMs(Date.now() - baseRef.current.at)
    }, 1000)
    return () => window.clearInterval(id)
    // elapsed_ms(서버에서 갱신되는 값)가 바뀔 때만 기준점을 다시 잡는다 — progress 객체 참조
    // 자체는 폴링마다 바뀌어도 elapsed_ms가 동일하면 재계산할 필요가 없다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress?.elapsed_ms])

  if (!progress) {
    return (
      <div className="flex flex-col gap-1.5 rounded-lg border border-accent bg-accent-soft p-3 text-sm text-accent">
        <span className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden />
          처리 준비 중…
        </span>
        <p className="text-xs text-muted">{KEEP_ALIVE_NOTE}</p>
      </div>
    )
  }

  const steps = ALL_PHASES.filter(
    (p) => (includeDownloading || p !== 'downloading') && (includeFetching || p !== 'fetching'),
  )
  const currentIndex = Math.max(0, steps.indexOf(progress.phase))
  const elapsedDisplay = formatElapsed(progress.elapsed_ms + tickMs)
  const stale = Date.now() - new Date(progress.last_activity_at).getTime() > STALE_MS

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-accent bg-accent-soft p-3 text-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        {steps.map((step, i) => {
          const state = i < currentIndex ? 'done' : i === currentIndex ? 'active' : 'pending'
          return (
            <span key={step} className="flex items-center gap-1.5">
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  state === 'done'
                    ? 'bg-correct text-on-accent'
                    : state === 'active'
                      ? 'bg-accent text-on-accent'
                      : 'bg-surface text-muted'
                }`}
              >
                {PHASE_LABELS[step]}
              </span>
              {i < steps.length - 1 && (
                <span className="text-muted" aria-hidden>
                  →
                </span>
              )}
            </span>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-primary">
        <span>경과 {elapsedDisplay}</span>
        {progress.usage && (
          <span>
            토큰 입력 {progress.usage.input_tokens.toLocaleString()} · 출력{' '}
            {progress.usage.output_tokens.toLocaleString()} · 합계{' '}
            {(progress.usage.input_tokens + progress.usage.output_tokens).toLocaleString()}
            {progress.usage.cost_usd != null && ` · 약 $${progress.usage.cost_usd.toFixed(3)}`}
          </span>
        )}
        {progress.eta_ms != null && <span>ETA {formatEta(progress.eta_ms)}</span>}
        {stale && (
          <span className="rounded bg-warning px-1.5 py-0.5 text-[11px] font-medium text-on-accent">응답 지연</span>
        )}
      </div>

      {progress.detail && <p className="text-xs text-muted">{progress.detail}</p>}

      <p className="text-xs text-muted">{KEEP_ALIVE_NOTE}</p>
    </div>
  )
}
