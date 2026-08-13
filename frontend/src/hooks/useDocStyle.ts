import { useFontScale } from './useFontScale'
import { resolveDocStyle } from '../utils/docStyle'
import type { ResolvedDocStyle } from '../utils/docStyle'
import type { DocumentStyle } from '../api/types'

export type { ResolvedDocStyle }

// 문서별 스타일 우선순위 해석 — 문서 지정값 > 전역 설정 > 기본 토큰(설계 §4.26 원칙·②-5).
// 적용 범위는 호출부 책임(그 문서의 본문 렌더 영역만 — DocViewer·학습·퀴즈 등 MarkdownView
// 래퍼 수준, 앱 크롬 불변). 임베드 카드 안에서는 이 훅을 호출하지 않는다(resolve-embeds 응답에
// style 자체가 없다 — §4.26 ②) + MarkdownView가 임베드 재귀 렌더에서 scale을 전역값으로
// 되돌리는 자체 방어까지 이중으로 걸려 있다.
export function useDocStyle(style: DocumentStyle | null | undefined): ResolvedDocStyle {
  const globalScale = useFontScale()
  return resolveDocStyle(style, globalScale)
}
