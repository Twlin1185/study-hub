import { useState } from 'react'
import type { ReactNode } from 'react'

interface SettingsSectionProps {
  id: string
  title: string
  children: ReactNode
}

// 설정 화면 6그룹 골격(stage-8 plan §4, F38 선행분). 데스크톱(≥768px)은 좌측 목차 + 콘텐츠 항상
// 펼침(앵커 스크롤), 모바일(<768px)은 그룹별 아코디언 — 그룹 콘텐츠는 한 번만 렌더하고 CSS로
// 보이기/숨기기만 전환한다(중복 마운트로 인한 네트워크 재조회·id 중복을 피하기 위함).
export default function SettingsSection({ id, title, children }: SettingsSectionProps) {
  const [open, setOpen] = useState(true)

  return (
    <section id={id} className="scroll-mt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mb-2 flex w-full items-center justify-between gap-2 border-b border-border pb-2 text-left md:cursor-default"
      >
        <h2 className="text-base font-semibold text-primary">{title}</h2>
        <span className="text-muted md:hidden" aria-hidden>
          {open ? '▲' : '▼'}
        </span>
      </button>
      <div className={`${open ? 'flex' : 'hidden'} flex-col gap-4 md:flex`}>{children}</div>
    </section>
  )
}
