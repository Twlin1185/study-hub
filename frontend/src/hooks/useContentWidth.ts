import { useCallback, useLayoutEffect, useState } from 'react'

// 콘텐츠 영역 실측 폭 훅 (설계 §5.1 v1.6) — max-w 적용 전 바깥 래퍼(w-full)를 관측한다.
// 뷰포트가 아닌 '사이드바 제외 가용 폭'을 재므로 창 리사이즈뿐 아니라
// 사이드바 접기/펼치기(±192px)에도 열 수가 실시간 반응한다.
//
// 콜백 ref 패턴을 쓰는 이유: 관측 대상 래퍼가 로딩 조기 반환 뒤(데이터 도착 후)에야
// 마운트되는 경우가 있어, useRef + useLayoutEffect([])는 최초 커밋 시 ref가 null이라
// ResizeObserver가 영영 부착되지 않는다. 콜백 ref는 노드가 나타나는 순간 관측을 시작한다.
export function useContentWidth(): {
  ref: (el: HTMLDivElement | null) => void
  width: number
} {
  const [node, setNode] = useState<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)

  const ref = useCallback((el: HTMLDivElement | null) => setNode(el), [])

  useLayoutEffect(() => {
    if (!node) return
    // 첫 페인트 전에 동기 측정해 깜빡임(1열→다열)을 방지한다.
    setWidth(node.clientWidth)
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width)
    })
    ro.observe(node)
    return () => ro.disconnect()
  }, [node])

  return { ref, width }
}
