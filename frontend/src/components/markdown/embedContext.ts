// 임베드 렌더 컨텍스트 — 깊이·방문 집합·해석 캐시를 트리 아래로 전달한다 (설계 §4.19 ④).
//
// depth     : 이 컨텍스트가 감싸는 본문의 깊이(루트 본문 = 0). 임베드 카드가 +1 해서 자식에게 준다.
// ancestors : 렌더 경로의 방문 집합(루트 문서 doc_no 포함) — 조상 체인에 있는 doc_no를 다시
//             임베드하면 순환 자리표시자. 자기 자신 임베드도 같은 처리(최소 사례).
import { createContext, useCallback, useContext, useEffect, useSyncExternalStore } from 'react'
import type { EmbedResolver, EmbedEntry } from './embedResolver'

export interface EmbedRenderCtx {
  resolver: EmbedResolver
  depth: number
  ancestors: readonly string[]
}

export const EmbedRenderContext = createContext<EmbedRenderCtx | null>(null)

export function useEmbedRenderCtx(): EmbedRenderCtx | null {
  return useContext(EmbedRenderContext)
}

// doc_no 1건의 해석 상태를 구독한다. enabled=false면 요청 자체를 보내지 않는다
// (순환 자리표시자처럼 대상 정보가 필요 없는 경우 — 무한 fetch 0).
export function useEmbedEntry(
  resolver: EmbedResolver | null,
  docNo: string | null,
  enabled = true,
): EmbedEntry | undefined {
  useEffect(() => {
    if (!resolver || !docNo || !enabled) return
    resolver.request(docNo)
  }, [resolver, docNo, enabled])

  const subscribe = useCallback(
    (listener: () => void) => (resolver ? resolver.subscribe(listener) : () => {}),
    [resolver],
  )
  const getSnapshot = useCallback(
    () => (resolver && docNo ? resolver.peek(docNo) : undefined),
    [resolver, docNo],
  )
  // 3번째 인자(서버 스냅샷)는 이 앱에 SSR이 없어도 넘겨 둔다 — 없으면 서버 렌더 시 예외.
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
