import type { ComponentType } from 'react'
import type { WidgetId } from '../../utils/homeLayout'
import DailyStartWidget from './DailyStartWidget'
import ContinueWidget from './ContinueWidget'
import TodayReviewWidget from './TodayReviewWidget'
import DDayWidget from './DDayWidget'
import HeatmapWidget from './HeatmapWidget'
import ExamProgressWidget from './ExamProgressWidget'
import Recent7dWidget from './Recent7dWidget'
import AccuracyTrendWidget from './AccuracyTrendWidget'
import WeaknessSectionWidget from './WeaknessSectionWidget'
import BookmarksWidget from './BookmarksWidget'

// 위젯 id → 렌더 컴포넌트. 숨긴 위젯은 여기서 마운트하지 않으므로 해당 데이터 쿼리도
// 실행되지 않는다(React Query enabled:false와 동등 효과, 설계 §5.1).
export const WIDGET_COMPONENTS: Record<WidgetId, ComponentType> = {
  daily_start: DailyStartWidget,
  continue: ContinueWidget,
  today_review: TodayReviewWidget,
  dday: DDayWidget,
  heatmap: HeatmapWidget,
  exam_progress: ExamProgressWidget,
  recent7d: Recent7dWidget,
  accuracy_trend: AccuracyTrendWidget,
  weakness: WeaknessSectionWidget,
  bookmarks: BookmarksWidget,
}
