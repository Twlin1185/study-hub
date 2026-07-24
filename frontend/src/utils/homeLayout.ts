// 홈 위젯 레이아웃 (설계 §4.10 home.layout 규격 · §5.1 위젯 레지스트리) — S7/F31.
// 서버는 검증 없이 문자열로 저장하므로 파싱·정규화 책임은 전적으로 프론트에 있다.

export type WidgetId =
  | 'continue'
  | 'today_review'
  | 'dday'
  | 'heatmap'
  | 'exam_progress'
  | 'recent7d'
  | 'accuracy_trend'
  | 'weakness'
  | 'bookmarks'

export type ColumnsSetting = 'auto' | 1 | 2 | 3

export interface WidgetLayout {
  id: WidgetId
  visible: boolean
  col: number
}

// order는 배열 인덱스로 표현한다(전역 순서). 렌더는 col로 버킷팅 후 배열 순서를 유지한다.
export interface HomeLayout {
  columns: ColumnsSetting
  widgets: WidgetLayout[]
}

// 위젯 레지스트리 9종 — 설계 §5.1. 순서 = 기본 레이아웃 순서(기존 Home.tsx 섹션 순서).
export const WIDGET_REGISTRY: { id: WidgetId; title: string }[] = [
  { id: 'continue', title: '이어하기' },
  { id: 'today_review', title: '오늘의 복습' },
  { id: 'dday', title: 'D-Day' },
  { id: 'heatmap', title: '학습 히트맵' },
  { id: 'exam_progress', title: '시험별 진도' },
  { id: 'recent7d', title: '최근 7일' },
  { id: 'accuracy_trend', title: '최근 정답률 추이' },
  { id: 'weakness', title: '자꾸 틀리는 개념 Top 10' },
  { id: 'bookmarks', title: '북마크 모아보기' },
]

const KNOWN_IDS = new Set<string>(WIDGET_REGISTRY.map((w) => w.id))

export function defaultLayout(): HomeLayout {
  return {
    columns: 'auto',
    widgets: WIDGET_REGISTRY.map((w) => ({ id: w.id, visible: true, col: 0 })),
  }
}

export function widgetTitle(id: WidgetId): string {
  return WIDGET_REGISTRY.find((w) => w.id === id)?.title ?? id
}

function normalizeColumns(value: unknown): ColumnsSetting {
  if (value === 1 || value === 2 || value === 3) return value
  if (value === '1') return 1
  if (value === '2') return 2
  if (value === '3') return 3
  return 'auto'
}

// 저장된 home.layout(임의 문자열)을 안전하게 정규화한다.
// - 파싱 실패·규격 이탈 → 기본 레이아웃(콘솔 경고만)
// - 알 수 없는 id는 무시, 누락 id는 기본값(표시·마지막 순서)으로 보충 (전방 호환, §4.10)
export function parseHomeLayout(raw: unknown): HomeLayout {
  if (raw == null) return defaultLayout()

  let obj: unknown = raw
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw)
    } catch {
      console.warn('[homeLayout] home.layout JSON 파싱 실패 — 기본 레이아웃으로 폴백')
      return defaultLayout()
    }
  }

  if (typeof obj !== 'object' || obj === null || !Array.isArray((obj as { widgets?: unknown }).widgets)) {
    console.warn('[homeLayout] home.layout 규격 이탈 — 기본 레이아웃으로 폴백')
    return defaultLayout()
  }

  const source = obj as { columns?: unknown; widgets: unknown[] }
  const seen = new Set<WidgetId>()
  const parsed: (WidgetLayout & { order: number })[] = []

  source.widgets.forEach((item, idx) => {
    if (typeof item !== 'object' || item === null) return
    const w = item as { id?: unknown; visible?: unknown; col?: unknown; order?: unknown }
    if (typeof w.id !== 'string' || !KNOWN_IDS.has(w.id) || seen.has(w.id as WidgetId)) return
    const id = w.id as WidgetId
    seen.add(id)
    const col = typeof w.col === 'number' && w.col >= 0 && w.col <= 2 ? Math.floor(w.col) : 0
    // order 필드가 있으면 그것을 우선(권위 있는 정렬 키), 없으면 배열 인덱스로 대체.
    const order = typeof w.order === 'number' ? w.order : idx
    parsed.push({ id, visible: w.visible !== false, col, order })
  })

  parsed.sort((a, b) => a.order - b.order)
  const widgets: WidgetLayout[] = parsed.map(({ id, visible, col }) => ({ id, visible, col }))

  // 누락 id는 표시·마지막 순서로 보충
  for (const reg of WIDGET_REGISTRY) {
    if (!seen.has(reg.id)) widgets.push({ id: reg.id, visible: true, col: 0 })
  }

  return { columns: normalizeColumns(source.columns), widgets }
}

// 저장 규격(§4.10)으로 직렬화. 배열 index를 order로 확정해 내보낸다.
// 백엔드 settings는 값을 json.dumps로 저장하므로(ddays.custom과 동일) 객체 그대로 전송한다.
export interface StoredHomeLayout {
  columns: ColumnsSetting
  widgets: { id: WidgetId; visible: boolean; order: number; col: number }[]
}

export function toStoredLayout(layout: HomeLayout): StoredHomeLayout {
  return {
    columns: layout.columns,
    widgets: layout.widgets.map((w, i) => ({ id: w.id, visible: w.visible, order: i, col: w.col })),
  }
}

// 콘텐츠 영역 실측 폭 기준 실제 렌더 열 수 (설계 §5.1 v1.6 — 뷰포트가 아닌 가용 폭).
// 승격 임계값을 이전 단계 max-w보다 크게 잡아, N열 승격 순간부터 (콘텐츠 폭 − max-w)만큼
// 좌우 여백이 생겨 가운데 정렬이 보이게 한다(1024~1280 사각지대 제거).
// - 'auto': <704→1 · 704~1343→2(max-w-5xl 1024) · ≥1344→3(max-w-7xl 1280)
// - 고정 1/2/3: 그대로. 단 콘텐츠 폭 <640px는 항상 1열로 강등.
export function effectiveColumns(columns: ColumnsSetting, contentWidth: number): number {
  if (columns === 'auto') {
    if (contentWidth >= 1344) return 3
    if (contentWidth >= 704) return 2
    return 1
  }
  if (contentWidth < 640) return 1
  return columns
}

// 다열 시 컨테이너 최대 폭 (설계 §5.1 v1.6).
// 현실적 콘텐츠 폭 대비 max-w를 좁혀 대부분의 창에서 가운데 정렬 여백이 체감되게 한다
// (1열 672 · 2열 896 · 3열 1152 — 열 폭 2열 ~430px, 3열 ~365px).
export function containerMaxWidthClass(cols: number): string {
  if (cols >= 3) return 'max-w-6xl'
  if (cols === 2) return 'max-w-4xl'
  return 'max-w-2xl'
}

// 표시할 열 배열로 분배 (설계 §5.1 v1.6).
// - 표시 위젯의 col이 전원 동일(distinct ≤ 1, 기본 레이아웃의 전원 0이 대표)이고 cols>1이면
//   명시 col을 무시하고 배열(우선순위) 순서대로 라운드로빈(index % cols)으로 자동 분배한다.
//   → 기본 레이아웃이 넓은 창에서 1열에만 쌓이지 않고 각 열에 고르게 퍼지며 열 상단이 우선순위 순.
// - 서로 다른 col이 존재하면(사용자 편집으로 지정) 기존 로직 그대로: clamp(col, cols-1) 배정.
// - 1열이면 표시 위젯 전체를 배열 순서대로 평탄화.
export function distributeColumns(widgets: WidgetLayout[], cols: number): WidgetLayout[][] {
  const result: WidgetLayout[][] = Array.from({ length: cols }, () => [])
  const visible = widgets.filter((w) => w.visible)
  const distinctCols = new Set(visible.map((w) => w.col))
  const auto = cols > 1 && distinctCols.size <= 1
  visible.forEach((w, i) => {
    const c = auto ? i % cols : Math.min(Math.max(w.col, 0), cols - 1)
    result[c].push(w)
  })
  return result
}

// 라운드로빈 자동 분배를 명시 col로 실체화(materialize)한다 — 편집 모드가 보던 화면 그대로
// ▲▼◀▶·드래그로 조작되도록. 표시 위젯은 배열 순서대로 index%cols, 숨긴 위젯은 col 0(자동 상태).
export function roundRobinColumns(widgets: WidgetLayout[], cols: number): WidgetLayout[] {
  let vi = 0
  return widgets.map((w) => {
    if (!w.visible) return { ...w, col: 0 }
    const c = cols > 1 ? vi % cols : 0
    vi += 1
    return { ...w, col: c }
  })
}
