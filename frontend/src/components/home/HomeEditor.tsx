import { useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import {
  containerMaxWidthClass,
  defaultLayout,
  distributeColumns,
  effectiveColumns,
  roundRobinColumns,
  widgetTitle,
} from '../../utils/homeLayout'
import type { ColumnsSetting, HomeLayout, WidgetLayout } from '../../utils/homeLayout'
import { useContentWidth } from '../../hooks/useContentWidth'

interface HomeEditorProps {
  initial: HomeLayout
  saving: boolean
  onDone: (layout: HomeLayout) => void
  onCancel: () => void
}

const COLUMN_OPTIONS: { value: ColumnsSetting; label: string }[] = [
  { value: 'auto', label: '자동' },
  { value: 1, label: '1' },
  { value: 2, label: '2' },
  { value: 3, label: '3' },
]

interface DragState {
  id: string
  offsetX: number
  offsetY: number
  width: number
  height: number
  pointerX: number
  pointerY: number
}

// 드롭 대상: 그리드의 특정 열·인덱스, 또는 하단 "숨긴 위젯" 영역.
type DropTarget = { type: 'grid'; col: number; index: number } | { type: 'hidden' }

// 위젯 배열(index = 전역 order)에서 지정 열(clamp 적용)의 표시 위젯을 배열 순서대로 반환.
function membersOfColumn(widgets: WidgetLayout[], col: number, cols: number, excludeId?: string) {
  return widgets.filter(
    (w) => w.visible && Math.min(Math.max(w.col, 0), cols - 1) === col && w.id !== excludeId,
  )
}

// 홈 편집 모드 (설계 §5.1, F31) — Pointer Events 직접 구현 드래그 + 폴백 ▲▼◀▶ 버튼.
export default function HomeEditor({ initial, saving, onDone, onCancel }: HomeEditorProps) {
  const { ref: contentRef, width: contentWidth } = useContentWidth()
  const [columns, setColumns] = useState<ColumnsSetting>(initial.columns)
  const [widgets, setWidgets] = useState<WidgetLayout[]>(initial.widgets.map((w) => ({ ...w })))
  // userArranged: 사용자가 열을 명시 지정(◀▶·드래그)했는가. false면 자동 라운드로빈 상태로,
  // 진입/리사이즈 시 현재 열 수에 맞춰 col을 실체화(materialize)해 WYSIWYG를 유지한다.
  const [userArranged, setUserArranged] = useState<boolean>(
    () => new Set(initial.widgets.filter((w) => w.visible).map((w) => w.col)).size > 1,
  )
  const [drag, setDrag] = useState<DragState | null>(null)
  const dropTargetRef = useRef<DropTarget | null>(null)
  const [, forceRender] = useState(0)

  const colRefs = useRef<(HTMLDivElement | null)[]>([])
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const hiddenRef = useRef<HTMLDivElement | null>(null)

  const cols = effectiveColumns(columns, contentWidth)
  const isAuto = columns === 'auto'
  // auto는 배치 조작을 전면 비활성(읽기 전용 미리보기) — 드래그/▲▼/◀▶ 모두 미노출.
  // 고정 1/2/3에서만 편집 가능하며, 그중 cols>1일 때만 열 간 이동(◀▶)이 의미가 있다.
  const editable = !isAuto
  const allowColumnMove = editable && cols > 1

  // 렌더·조작의 단일 기준 = 자동 라운드로빈까지 반영한 표시 분배(설계 §5.1 v1.6 · WYSIWYG).
  // draft(widgets)는 자동 상태(userArranged=false)일 땐 col을 건드리지 않아 [기본값 복원]/무편집
  // 저장이 auto로 유지된다. 명시 열 조작 순간에만 실체화한다.
  const buckets = distributeColumns(widgets, cols)
  const hiddenWidgets = widgets.filter((w) => !w.visible)

  function updateWidgets(next: WidgetLayout[]) {
    setWidgets(next)
  }

  // 명시 열 조작(◀▶·드래그) 직전, 아직 자동 상태면 현재 분배를 명시 col로 실체화한다.
  function ensureExplicit(arr: WidgetLayout[]): WidgetLayout[] {
    return userArranged ? arr : roundRobinColumns(arr, cols)
  }

  // ---- 폴백 컨트롤 ----
  function moveVertical(id: string, dir: -1 | 1) {
    // 조작 기준은 표시 분배(buckets) — 자동/명시 어느 상태든 보이는 그대로 위/아래로 이동한다.
    let bc = -1
    let bp = -1
    buckets.forEach((colArr, ci) => {
      const pi = colArr.findIndex((x) => x.id === id)
      if (pi >= 0) {
        bc = ci
        bp = pi
      }
    })
    if (bc < 0) return
    const target = buckets[bc][bp + dir]
    if (!target) return
    const arr = widgets.slice()
    const ai = arr.findIndex((x) => x.id === id)
    const bi = arr.findIndex((x) => x.id === target.id)
    ;[arr[ai], arr[bi]] = [arr[bi], arr[ai]]
    updateWidgets(arr)
  }

  function moveHorizontal(id: string, dir: -1 | 1) {
    if (cols <= 1) return
    const base = ensureExplicit(widgets)
    setUserArranged(true) // 명시 열 지정 — 이후 자동 라운드로빈을 멈춘다.
    updateWidgets(
      base.map((w) => {
        if (w.id !== id) return w
        const cur = Math.min(Math.max(w.col, 0), cols - 1)
        const nextCol = Math.min(Math.max(cur + dir, 0), cols - 1)
        return { ...w, col: nextCol }
      }),
    )
  }

  function toggleVisible(id: string) {
    // col 미변경 — 자동 상태면 distributeColumns가 남은 표시 위젯으로 라운드로빈을 다시 계산한다.
    updateWidgets(widgets.map((w) => (w.id === id ? { ...w, visible: !w.visible } : w)))
  }

  // ---- 드래그 (Pointer Events) ----
  function computeDropTarget(pointerX: number, pointerY: number, draggingId: string): DropTarget {
    // 하단 "숨긴 위젯" 영역 위면 숨김 드롭
    const hiddenEl = hiddenRef.current
    if (hiddenEl) {
      const hr = hiddenEl.getBoundingClientRect()
      if (pointerX >= hr.left && pointerX <= hr.right && pointerY >= hr.top && pointerY <= hr.bottom) {
        return { type: 'hidden' }
      }
    }
    // 열 판정: 포인터 x가 속한 열 컨테이너
    let col = 0
    for (let c = 0; c < cols; c++) {
      const el = colRefs.current[c]
      if (!el) continue
      const r = el.getBoundingClientRect()
      if (pointerX >= r.left && pointerX <= r.right) {
        col = c
        break
      }
      // 마지막 열 오른쪽을 넘어가면 마지막 열로
      if (c === cols - 1 && pointerX > r.right) col = c
    }
    // 열 내 삽입 위치: 드래그 대상 제외한 카드들의 중점과 비교(표시 분배 기준)
    const members = buckets[col].filter((w) => w.id !== draggingId)
    let index = members.length
    for (let i = 0; i < members.length; i++) {
      const el = cardRefs.current.get(members[i].id)
      if (!el) continue
      const r = el.getBoundingClientRect()
      if (pointerY < r.top + r.height / 2) {
        index = i
        break
      }
    }
    return { type: 'grid', col, index }
  }

  function onHandlePointerDown(e: ReactPointerEvent, id: string) {
    e.preventDefault()
    const card = cardRefs.current.get(id)
    if (!card) return
    const r = card.getBoundingClientRect()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    setDrag({
      id,
      offsetX: e.clientX - r.left,
      offsetY: e.clientY - r.top,
      width: r.width,
      height: r.height,
      pointerX: e.clientX,
      pointerY: e.clientY,
    })
    // 실제 대상은 첫 pointermove에서 계산한다(움직임 없이 놓으면 no-op).
    dropTargetRef.current = null
  }

  function onHandlePointerMove(e: ReactPointerEvent) {
    if (!drag) return
    dropTargetRef.current = computeDropTarget(e.clientX, e.clientY, drag.id)
    setDrag({ ...drag, pointerX: e.clientX, pointerY: e.clientY })
  }

  function onHandlePointerUp(e: ReactPointerEvent) {
    if (!drag) return
    ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
    const target = dropTargetRef.current
    if (target) applyDrop(drag.id, target)
    setDrag(null)
    dropTargetRef.current = null
  }

  function onHandlePointerCancel(e: ReactPointerEvent) {
    if (!drag) return
    ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
    setDrag(null)
    dropTargetRef.current = null
    forceRender((n) => n + 1)
  }

  function applyDrop(id: string, target: DropTarget) {
    // auto는 읽기 전용이라 드래그가 시작되지 않지만, 방어적으로 무시한다.
    if (!editable) return
    if (target.type === 'hidden') {
      // 그리드 → 숨김. 이미 숨김 항목을 숨김 영역에 놓으면 no-op.
      const w = widgets.find((x) => x.id === id)
      if (!w || !w.visible) return
      updateWidgets(widgets.map((x) => (x.id === id ? { ...x, visible: false } : x)))
      return
    }
    columnDrop(id, target.col, target.index)
  }

  // 고정 1/2/3: 대상 열·위치에 col을 실체화(명시 지정). 숨김 항목이면 visible 복귀.
  function columnDrop(id: string, targetCol: number, targetIndex: number) {
    const base = ensureExplicit(widgets)
    const w = base.find((x) => x.id === id)
    if (!w) return
    setUserArranged(true)
    const moved: WidgetLayout = { ...w, visible: true }
    if (cols > 1) moved.col = targetCol // 단일 열이면 col을 건드리지 않는다(기기별 열 배정 보존)
    const rest = base.filter((x) => x.id !== id)
    const members = membersOfColumn(rest, targetCol, cols)
    let insertAt: number
    if (members.length === 0) {
      insertAt = rest.length
    } else if (targetIndex >= members.length) {
      insertAt = rest.indexOf(members[members.length - 1]) + 1
    } else {
      insertAt = rest.indexOf(members[targetIndex])
    }
    rest.splice(insertAt, 0, moved)
    updateWidgets(rest)
  }

  // 열 수 세그먼트 선택. '자동'을 고르면 명시 배치를 비우고 자동 분배 상태로 되돌린다
  // (auto는 읽기 전용 미리보기이므로 항상 진짜 자동 분배를 보여준다).
  function selectColumns(value: ColumnsSetting) {
    setColumns(value)
    if (value === 'auto') {
      setUserArranged(false)
      updateWidgets(widgets.map((w) => ({ ...w, col: 0 })))
    }
  }

  function handleRestore() {
    const def = defaultLayout()
    setColumns(def.columns)
    setWidgets(def.widgets)
    setUserArranged(false) // 전원 col 0 → 자동 라운드로빈 상태로 복귀(effect가 재실체화).
  }

  function handleDone() {
    onDone({ columns, widgets })
  }

  const showPlaceholder = (col: number, index: number) => {
    const t = dropTargetRef.current
    return drag != null && t != null && t.type === 'grid' && t.col === col && t.index === index
  }

  const hiddenActive = drag != null && dropTargetRef.current?.type === 'hidden'

  return (
    // 편집 모드 열 판정도 뷰 모드와 동일하게 콘텐츠 실측 폭 기준(설계 §5.1 v1.6).
    <div ref={contentRef} className="w-full">
    <div className={`mx-auto ${containerMaxWidthClass(cols)} p-4`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-primary">홈 편집</h1>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleRestore}
            className="rounded border border-border px-3 py-1.5 text-sm text-primary hover:bg-bg"
          >
            기본값 복원
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-border px-3 py-1.5 text-sm text-primary hover:bg-bg"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleDone}
            disabled={saving}
            className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
          >
            {saving ? '저장 중…' : '완료'}
          </button>
        </div>
      </div>

      {/* 열 수 세그먼트 */}
      <div className="mb-4 flex items-center gap-2">
        <span className="text-sm text-muted">열 수</span>
        <div className="flex overflow-hidden rounded-lg border border-border">
          {COLUMN_OPTIONS.map((opt) => (
            <button
              key={String(opt.value)}
              type="button"
              onClick={() => selectColumns(opt.value)}
              aria-pressed={columns === opt.value}
              className={`px-3 py-1.5 text-sm transition-colors ${
                columns === opt.value
                  ? 'bg-accent text-on-accent'
                  : 'bg-surface text-primary hover:bg-bg'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {cols === 1 && columns !== 1 && (
          <span className="text-xs text-muted">(좁은 화면 — 1열로 표시 중)</span>
        )}
      </div>
      {isAuto && (
        <p className="mb-4 text-xs text-muted">
          자동: 폭에 맞춰 열 수와 배치가 자동 조정됩니다. 배치를 직접 수정하려면 1·2·3열을 선택하세요.
        </p>
      )}

      {/* 편집 그리드 */}
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: cols }, (_, c) => {
          // 드래그 중이라도 대상 카드는 언마운트하지 않는다(핸들의 pointer capture 유지) —
          // 대신 흐리게(dimmed) 두고, 자리표시자 위치는 '드래그 대상을 뺀' 카드 기준으로 센다.
          const members = buckets[c] ?? []
          const draggedCount = members.filter((w) => w.id !== drag?.id).length
          let otherIdx = 0
          return (
            <div
              key={c}
              ref={(el) => {
                colRefs.current[c] = el
              }}
              className="flex min-h-[60px] flex-col gap-2 rounded-lg border border-dashed border-border p-2"
            >
              {cols > 1 && <div className="text-center text-[11px] text-muted">{c + 1}열</div>}
              {members.map((w) => {
                const isDragged = drag?.id === w.id
                const placeholderHere = !isDragged && showPlaceholder(c, otherIdx)
                const myOtherIdx = otherIdx
                if (!isDragged) otherIdx += 1
                return (
                  <div key={w.id}>
                    {placeholderHere && <Placeholder />}
                    <EditCard
                      widget={w}
                      editable={editable}
                      displayCol={c}
                      lastCol={cols - 1}
                      allowColumnMove={allowColumnMove}
                      index={myOtherIdx}
                      count={draggedCount}
                      dimmed={isDragged}
                      setRef={(el) => {
                        if (el) cardRefs.current.set(w.id, el)
                        else cardRefs.current.delete(w.id)
                      }}
                      onHandleDown={(e) => onHandlePointerDown(e, w.id)}
                      onHandleMove={onHandlePointerMove}
                      onHandleUp={onHandlePointerUp}
                      onHandleCancel={onHandlePointerCancel}
                      onUp={() => moveVertical(w.id, -1)}
                      onDown={() => moveVertical(w.id, 1)}
                      onLeft={() => moveHorizontal(w.id, -1)}
                      onRight={() => moveHorizontal(w.id, 1)}
                      onHide={() => toggleVisible(w.id)}
                    />
                  </div>
                )
              })}
              {showPlaceholder(c, otherIdx) && <Placeholder />}
            </div>
          )
        })}
      </div>

      {/* 숨긴 위젯 목록 + 숨김 드롭존 (그리드에서 여기로 드래그하면 숨김) */}
      <div
        ref={hiddenRef}
        className={`mt-6 rounded-lg border border-dashed p-3 transition-colors ${
          hiddenActive ? 'border-accent bg-accent-soft' : 'border-border'
        }`}
      >
        <h2 className="mb-2 text-sm font-semibold text-primary">
          숨긴 위젯 <span className="text-xs font-normal text-muted">(여기로 드래그하면 숨김)</span>
        </h2>
        {hiddenWidgets.length === 0 ? (
          <p className="text-sm text-muted">
            숨긴 위젯이 없습니다. 위젯을 이 영역으로 드래그하면 숨길 수 있습니다.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {hiddenWidgets.map((w) => (
              <div
                key={w.id}
                ref={(el) => {
                  if (el) cardRefs.current.set(w.id, el)
                  else cardRefs.current.delete(w.id)
                }}
                className={`flex items-center gap-1 rounded-lg border border-border bg-surface py-1 pl-1 pr-2 text-sm ${
                  drag?.id === w.id ? 'opacity-30' : ''
                }`}
              >
                {/* 드래그 복귀는 고정 모드 전용 — auto에서는 탭(눈)으로만 복귀 */}
                {editable && (
                  <button
                    type="button"
                    aria-label="드래그해서 그리드로 복귀"
                    title="드래그해서 그리드로 복귀"
                    onPointerDown={(e) => onHandlePointerDown(e, w.id)}
                    onPointerMove={onHandlePointerMove}
                    onPointerUp={onHandlePointerUp}
                    onPointerCancel={onHandlePointerCancel}
                    className="cursor-grab touch-none select-none rounded px-1 text-muted hover:text-primary active:cursor-grabbing"
                  >
                    ≡
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => toggleVisible(w.id)}
                  title="다시 표시"
                  className={`flex items-center gap-1.5 text-muted hover:text-primary ${editable ? '' : 'pl-1'}`}
                >
                  <span aria-hidden>👁</span>
                  {widgetTitle(w.id)}
                  <span className="text-xs text-accent">표시</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 드래그 중 떠 있는 클론 */}
      {drag && (
        <div
          className="pointer-events-none fixed z-50 rounded-lg border border-accent bg-surface-raised px-3 py-2 text-sm text-primary opacity-90 shadow-xl"
          style={{
            left: drag.pointerX - drag.offsetX,
            top: drag.pointerY - drag.offsetY,
            width: drag.width,
          }}
        >
          <span className="mr-2" aria-hidden>
            ≡
          </span>
          {widgetTitle(drag.id as WidgetLayout['id'])}
        </div>
      )}
    </div>
    </div>
  )
}

function Placeholder() {
  return <div className="h-10 rounded-lg border-2 border-dashed border-accent bg-accent-soft" />
}

interface EditCardProps {
  widget: WidgetLayout
  editable: boolean
  displayCol: number
  lastCol: number
  allowColumnMove: boolean
  index: number
  count: number
  dimmed: boolean
  setRef: (el: HTMLDivElement | null) => void
  onHandleDown: (e: ReactPointerEvent) => void
  onHandleMove: (e: ReactPointerEvent) => void
  onHandleUp: (e: ReactPointerEvent) => void
  onHandleCancel: (e: ReactPointerEvent) => void
  onUp: () => void
  onDown: () => void
  onLeft: () => void
  onRight: () => void
  onHide: () => void
}

function EditCard({
  widget,
  editable,
  displayCol,
  lastCol,
  allowColumnMove,
  index,
  count,
  dimmed,
  setRef,
  onHandleDown,
  onHandleMove,
  onHandleUp,
  onHandleCancel,
  onUp,
  onDown,
  onLeft,
  onRight,
  onHide,
}: EditCardProps) {
  return (
    <div
      ref={setRef}
      className={`flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 ${
        dimmed ? 'opacity-30' : !editable ? 'opacity-60' : ''
      }`}
    >
      {editable ? (
        <button
          type="button"
          aria-label="드래그해서 이동"
          title="드래그해서 이동"
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onPointerCancel={onHandleCancel}
          className="cursor-grab touch-none select-none rounded px-1 text-muted hover:text-primary active:cursor-grabbing"
        >
          ≡
        </button>
      ) : (
        // auto: 읽기 전용 미리보기 — 드래그 핸들은 비활성 아이콘으로만 표시
        <span className="px-1 text-muted opacity-50" aria-hidden title="자동 배치 (읽기 전용)">
          ≡
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-sm text-primary">{widgetTitle(widget.id)}</span>
      <div className="flex shrink-0 items-center gap-0.5">
        {editable && (
          <>
            <IconBtn label="위로" disabled={index === 0} onClick={onUp}>
              ▲
            </IconBtn>
            <IconBtn label="아래로" disabled={index === count - 1} onClick={onDown}>
              ▼
            </IconBtn>
            {allowColumnMove && (
              <>
                <IconBtn label="왼쪽 열로" disabled={displayCol === 0} onClick={onLeft}>
                  ◀
                </IconBtn>
                <IconBtn label="오른쪽 열로" disabled={displayCol === lastCol} onClick={onRight}>
                  ▶
                </IconBtn>
              </>
            )}
          </>
        )}
        {/* 숨김(눈) 토글은 auto에서도 유지 — 열 배치와 무관 */}
        <IconBtn label="숨기기" onClick={onHide}>
          👁
        </IconBtn>
      </div>
    </div>
  )
}

function IconBtn({
  children,
  label,
  onClick,
  disabled,
}: {
  children: ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="rounded px-1 py-0.5 text-xs text-muted hover:bg-bg hover:text-primary disabled:opacity-30"
    >
      {children}
    </button>
  )
}
