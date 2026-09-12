// 최소 서비스 워커 (설계 F18, PWA) — 앱 셸만 캐시한다. 로컬 서버 전용 앱이라 오프라인에서
// 데이터를 보여줄 의미가 없으므로 /api/* 요청은 항상 네트워크로만 보낸다(캐시하지 않음).
const CACHE_NAME = 'study-hub-shell-v1'
const APP_SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  // 데이터 요청(API)은 절대 캐시하지 않는다 — network-only.
  if (url.pathname.startsWith('/api/')) return

  // 같은 origin의 정적 자산(앱 셸) — network-first, 실패 시 캐시로 폴백.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
        }
        return response
      })
      .catch(async () => {
        const cached = await caches.match(request)
        if (cached) return cached
        // 내비게이션 요청은 최후에 앱 셸(index.html)로 폴백
        if (request.mode === 'navigate') {
          const shell = await caches.match('/')
          if (shell) return shell
        }
        return Response.error()
      }),
  )
})
