import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'

// 헤더 검색창 (설계 §5 도입부, S6) — 단축키 "/"로 포커스. 데스크톱 사이드바(항상 펼침)와
// 모바일 헤더(아이콘 → 확장) 두 변형을 지원한다. "/" 단축키는 실제로 보이는(offsetParent가
// 있는) 입력에만 적용되므로 두 변형이 동시에 마운트돼 있어도 충돌하지 않는다.
interface SearchBarProps {
  variant: 'sidebar' | 'mobile'
}

export default function SearchBar({ variant }: SearchBarProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const inputRef = useRef<HTMLInputElement>(null)
  const onSearchPage = location.pathname === '/search'

  const [value, setValue] = useState(onSearchPage ? (searchParams.get('q') ?? '') : '')
  const [mobileOpen, setMobileOpen] = useState(false)

  // /search 페이지에 머무는 동안 주소창 q와 입력값을 맞춘다 (뒤로가기 등으로 바뀔 수 있음).
  useEffect(() => {
    if (onSearchPage) setValue(searchParams.get('q') ?? '')
  }, [onSearchPage, searchParams])

  // 단축키 "/" — 입력 중이 아니고 모달이 열려 있지 않을 때 검색창으로 포커스 이동.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return
      if (document.querySelector('[role="dialog"]')) return
      const el = inputRef.current
      if (!el || el.offsetParent === null) return
      e.preventDefault()
      el.focus()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  function submit(e: FormEvent) {
    e.preventDefault()
    const q = value.trim()
    if (!q) return
    navigate(`/search?q=${encodeURIComponent(q)}`)
  }

  if (variant === 'mobile') {
    if (!mobileOpen) {
      return (
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="검색"
          className="rounded p-1.5 text-muted hover:bg-bg hover:text-primary"
        >
          🔍
        </button>
      )
    }
    return (
      <form onSubmit={submit} className="flex flex-1 items-center gap-1">
        <input
          ref={inputRef}
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => {
            if (!value.trim()) setMobileOpen(false)
          }}
          placeholder="검색…"
          className="w-full rounded border border-border bg-bg px-3 py-1.5 text-sm text-primary outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={() => {
            setValue('')
            setMobileOpen(false)
          }}
          aria-label="검색 닫기"
          className="shrink-0 rounded p-1.5 text-muted hover:bg-bg hover:text-primary"
        >
          ✕
        </button>
      </form>
    )
  }

  return (
    <form onSubmit={submit} className="relative mb-3">
      <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted">🔍</span>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="검색 ( / )"
        className="w-full rounded border border-border bg-bg py-1.5 pl-7 pr-2 text-sm text-primary outline-none focus:border-accent"
      />
    </form>
  )
}
