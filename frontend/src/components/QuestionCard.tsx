import type { ReactNode } from 'react'
import MarkdownView from './MarkdownView'
import type { FontScale } from '../api/types'

const CIRCLED_DIGITS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨']

interface QuestionCardProps {
  docNo: string
  content: string | null
  choices: string[] | null
  fontScale: FontScale
  selectedValue: string | null
  onSelect: (choiceIndex: number) => void
  headerRight?: ReactNode
}

// 모의고사 런 화면(설계 §5.12) 전용 문항 카드 — "QuizCard의 문항 렌더(지문 Markdown + 보기 버튼)를
// 재사용하되 채점 상호작용은 제거"(정오 색상·해설 없음, 보기 선택 = 답안 저장만·자유 변경).
// pages/QuizRun.tsx는 채점 결과 렌더가 얽혀 있어 그대로 재사용하기 어려워 시각 패턴만 공유하는
// 별도 컴포넌트로 뒀다(기존 퀴즈 화면은 완전 불변 유지) — 최종 보고 참고.
export default function QuestionCard({
  docNo,
  content,
  choices,
  fontScale,
  selectedValue,
  onSelect,
  headerRight,
}: QuestionCardProps) {
  return (
    <div className="mb-4 rounded-lg border border-border bg-surface p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="inline-block rounded bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
          {docNo}
        </span>
        {headerRight}
      </div>
      <MarkdownView content={content} scale={fontScale} />
      <div className="mt-4 flex flex-col gap-2">
        {(choices ?? []).map((choice, i) => {
          const value = String(i + 1)
          const isMine = selectedValue === value
          return (
            <button
              key={i}
              type="button"
              onClick={() => onSelect(i)}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                isMine
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-border bg-surface text-primary hover:bg-bg'
              }`}
            >
              <span className="font-medium">{CIRCLED_DIGITS[i] ?? `${i + 1}.`}</span>
              <span>{choice}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
