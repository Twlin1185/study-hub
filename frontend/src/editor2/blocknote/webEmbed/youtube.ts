// iframe 화이트리스트 — **프론트 상수 1곳**(api §4.30 ③ · stage-37 규약 B). 1차 = YouTube만.
// 확장은 이 파일을 고치는 것으로 한다(settings 키 0 — 계약).
//
// 그 외 URL은 전부 카드로 남는다(`webEmbedBlock.tsx`가 이 함수의 반환값 유무로 분기한다).
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'])

/**
 * watch/short/이미 embed인 URL → **embed URL**. 대상이 아니거나 영상 id를 못 찾으면 `null`
 * (호출부는 null이면 카드로 유지한다). `youtube-nocookie.com`으로 삽입한다(프라이버시 강화 도메인
 * 사용은 구현 재량 — api §4.30 ③).
 */
export function resolveYoutubeEmbedUrl(rawUrl: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
  const host = parsed.hostname.toLowerCase()
  if (!YOUTUBE_HOSTS.has(host)) return null

  let videoId: string | null = null
  if (host === 'youtu.be') {
    videoId = parsed.pathname.split('/').filter(Boolean)[0] ?? null
  } else if (parsed.pathname.startsWith('/shorts/')) {
    videoId = parsed.pathname.split('/').filter(Boolean)[1] ?? null
  } else if (parsed.pathname.startsWith('/embed/')) {
    videoId = parsed.pathname.split('/').filter(Boolean)[1] ?? null
  } else if (parsed.pathname === '/watch') {
    videoId = parsed.searchParams.get('v')
  }
  if (!videoId) return null
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}`
}
