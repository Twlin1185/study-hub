import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { api } from '../api/client'

// 이미 열려 있는 탭은 서버를 재시작하고 새로 빌드해도 옛 JS를 계속 실행한다 —
// 사용자가 직접 새로고침하기 전까지 화면만 구버전이다(2026-07-26 실사용 확인:
// "새로고침 이후에 되고 있어"). 서버가 지금 서빙하는 번들 파일명(`/api/app-version`)과
// 이 탭이 실행 중인 번들 파일명을 비교해 새 빌드를 감지한다 — 빌드마다 해시가 바뀌므로
// 별도의 버전 상수·빌드 스탬프가 필요 없다(설계 §4.16).
//
// 감지 시 동작:
//   · 이 서버 빌드로 아직 새로고침한 적 없으면 → 자동으로 1회 새로고침(한방에 최신 화면).
//   · 이미 한 번 새로고침했는데도 계속 다르면(비정상) → 무한 새로고침 대신 배너로 알린다.
const RELOAD_GUARD_KEY = 'study-hub:reloaded-for-asset'
const POLL_INTERVAL_MS = 60_000
const RELOAD_AFTER_LEAVE_MS = 1_500

function runningAssetName(): string | null {
  const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>('script[src]'))
  const main = scripts.map((s) => s.src).find((src) => src.includes('/assets/index-'))
  return main ? (main.split('/').pop() ?? null) : null
}

// 자동 새로고침 보류 라우트(FB-38ⓓ) — 풀이·편집 중 입력/세션이 날아가지 않게 한다. 정확 일치만
// (접두 비교 금지: `/review-notes`가 `/review`에, `/notes`·`/docs/<id>`가 걸리지 않게).
const DEFERRED_EXACT = new Set(['/quiz/run', '/exam/run', '/review', '/flashcards', '/docs/new'])
const DEFERRED_PATTERNS = [/^\/study\/[^/]+$/, /^\/notes\/[^/]+$/, /^\/docs\/[^/]+\/edit$/]

export function isReloadDeferredPath(pathname: string): boolean {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  return DEFERRED_EXACT.has(p) || DEFERRED_PATTERNS.some((re) => re.test(p))
}

export function useAppUpdate(): { updateAvailable: boolean } {
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const { pathname } = useLocation()
  const pathRef = useRef(pathname)
  pathRef.current = pathname
  // 보호 라우트에서 감지해 보류 중인 서버 자산명 — 보호 라우트를 벗어나면 1회 새로고침.
  const pendingAssetRef = useRef<string | null>(null)

  useEffect(() => {
    if (!pendingAssetRef.current || isReloadDeferredPath(pathname)) return
    // 이탈하는 화면이 같은 순간에 보내는 확정 요청(복습 뒤집기 flush·노트 저장)이 언로드에
    // 잘리지 않게 잠깐 미룬다. 그 사이 다시 보호 라우트로 들어가면 취소되고 보류가 유지된다.
    const timer = window.setTimeout(() => {
      const pending = pendingAssetRef.current
      if (!pending) return
      pendingAssetRef.current = null
      window.sessionStorage.setItem(RELOAD_GUARD_KEY, pending)
      window.location.reload()
    }, RELOAD_AFTER_LEAVE_MS)
    return () => window.clearTimeout(timer)
  }, [pathname])

  useEffect(() => {
    let cancelled = false

    async function check() {
      const running = runningAssetName()
      if (!running) return // dev 서버 등 해시 자산이 없는 환경 — 확인 대상 아님
      let serverAsset: string | null = null
      try {
        const res = await api.get<{ asset: string | null }>('/app-version')
        serverAsset = res.asset
      } catch {
        return // 서버가 꺼져 있거나 응답 불가 — 조용히 넘어간다(다음 주기에 재시도)
      }
      if (cancelled || !serverAsset || serverAsset === running) return

      // 서버 빌드가 다르다 = 이 탭이 옛 화면이다.
      if (window.sessionStorage.getItem(RELOAD_GUARD_KEY) !== serverAsset) {
        if (isReloadDeferredPath(pathRef.current)) {
          // 풀이·편집 중 — 자동 새로고침 보류, 기존 배너로 알리고 이탈 시 새로고침.
          pendingAssetRef.current = serverAsset
          setUpdateAvailable(true)
          return
        }
        window.sessionStorage.setItem(RELOAD_GUARD_KEY, serverAsset)
        window.location.reload()
        return
      }
      setUpdateAvailable(true)
    }

    void check()
    const timer = window.setInterval(() => void check(), POLL_INTERVAL_MS)
    const onFocus = () => void check()
    window.addEventListener('focus', onFocus)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  return { updateAvailable }
}

