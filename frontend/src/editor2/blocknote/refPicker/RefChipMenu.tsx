// 참조 칩·임베드 카드의 **클릭 팝오버** (stage-34 규약 A ③).
//
// 편집 표면에서 칩 클릭은 **라우팅이 아니라 팝오버**다 — 편집 중 클릭이 곧바로 문서로 튀면 편집
// 흐름이 끊긴다(원자 인라인 콘텐츠의 표준 동작). 읽기 표면(F43 `MarkdownView`)은 종전대로 이동한다.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { isSafeRefText, normalizeRefText, refTextRejection } from '../../schema/refDomain'
import AnchoredPanel from './AnchoredPanel'
import { describeRef } from './RefTitleContext'
import type { RefChipMenuRequest, RefTitleEntry } from './RefTitleContext'

const PANEL_WIDTH = 280

interface RefChipMenuProps {
  request: RefChipMenuRequest
  entry: RefTitleEntry
  onClose: () => void
  onChangeTarget: (request: RefChipMenuRequest) => void
}

export default function RefChipMenu({ request, entry, onClose, onChangeTarget }: RefChipMenuProps) {
  const navigate = useNavigate()
  const [editingLabel, setEditingLabel] = useState(false)
  const [label, setLabel] = useState(request.label)

  const display = describeRef(request.refType, request.target, request.label, entry)
  const resolved = entry.state === 'resolved' ? entry.item : undefined
  const docId = resolved?.found ? resolved.id : undefined
  const normalized = normalizeRefText(label)
  const error = normalized === '' ? null : isSafeRefText(normalized) ? null : refTextRejection(normalized)

  const rowClass =
    'w-full rounded px-2 py-1.5 text-left text-sm text-primary hover:bg-bg disabled:cursor-not-allowed disabled:text-muted disabled:hover:bg-transparent'

  return (
    <AnchoredPanel rect={request.rect} width={PANEL_WIDTH} onClose={onClose} label="참조">
      <div className="flex flex-col">
        <div className="border-b border-border px-3 py-2">
          <p className={`text-sm ${display.placeholder ? 'text-muted' : 'text-primary'}`}>{display.text}</p>
          <p className="mt-0.5 text-[11px] text-muted">
            {request.refType === 'anchor' ? '문서 안 앵커' : request.target}
            {request.label ? ' · 지정 라벨' : ' · 제목 추종'}
          </p>
          {display.placeholder && <p className="mt-1 text-[11px] text-wrong">{display.title}</p>}
        </div>

        {editingLabel ? (
          <div className="flex flex-col gap-1 border-b border-border px-3 py-2">
            <input
              autoFocus
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="제목 추종 (비우면 대상 제목을 따라갑니다)"
              className="w-full rounded border border-border bg-surface px-2 py-1 text-sm text-primary placeholder:text-muted"
            />
            {error && <span className="text-[11px] text-wrong">{error}</span>}
            <div className="flex gap-1 pt-0.5">
              <button
                type="button"
                disabled={error !== null}
                onClick={() => {
                  request.update({ label: normalized })
                  onClose()
                }}
                className="rounded border border-border px-2 py-0.5 text-xs text-primary hover:bg-bg disabled:cursor-not-allowed disabled:text-muted"
              >
                적용
              </button>
              <button
                type="button"
                onClick={() => {
                  setLabel(request.label)
                  setEditingLabel(false)
                }}
                className="rounded border border-border px-2 py-0.5 text-xs text-muted hover:bg-bg"
              >
                취소
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col p-1">
            {request.refType !== 'anchor' && (
              <button
                type="button"
                className={rowClass}
                disabled={typeof docId !== 'number'}
                title={
                  typeof docId === 'number'
                    ? undefined
                    : '아직 해석되지 않았거나 존재하지 않는 문서입니다'
                }
                onClick={() => {
                  if (typeof docId === 'number') {
                    onClose()
                    navigate(`/docs/${docId}`)
                  }
                }}
              >
                문서 열기
              </button>
            )}
            <button type="button" className={rowClass} onClick={() => setEditingLabel(true)}>
              라벨 편집
            </button>
            {request.label !== '' && (
              <button
                type="button"
                className={rowClass}
                onClick={() => {
                  request.update({ label: '' })
                  onClose()
                }}
              >
                제목 추종으로 되돌리기
              </button>
            )}
            <button type="button" className={rowClass} onClick={() => onChangeTarget(request)}>
              대상 변경
            </button>
            <button
              type="button"
              className={`${rowClass} text-wrong`}
              onClick={() => {
                request.remove()
                onClose()
              }}
            >
              삭제
            </button>
          </div>
        )}
      </div>
    </AnchoredPanel>
  )
}
