import { useSettings } from '../api/settings'
import type { FontScale } from '../api/types'

// 본문 글자 크기 3단계 (설계 §5.3·§5.11, F36-⑨) — settings:study.font_scale.
// 문서 상세·학습 모드 본문 Markdown 렌더에 공통 적용. 기본값 default.
export function useFontScale(): FontScale {
  const { data } = useSettings()
  const value = data?.['study.font_scale']
  return value === 'small' || value === 'large' ? value : 'default'
}
