import { useState } from 'react'
import LlmJobProgress from './LlmJobProgress'
import LlmErrorInfoView from './LlmErrorInfo'
import ConfirmDialog from './ConfirmDialog'
import { previewJsonUrl } from '../api/convert'
import { useMergePreviews } from '../api/import'
import { ApiError } from '../api/client'
import type { QueueItem, QueueItemStatus } from '../hooks/useConvertQueue'

// 반입 대기열 카드 목록(F40-②, 설계 §5.9) — 파일명 · 상태 배지 · 실패 시 error_info 인라인.
// 진행 표시(LlmJobProgress)는 **현재 처리 중 1건에만** 붙는다(서버 워커 동시 1개).
// 색상은 전부 토큰(불변 규칙 5), 모바일 폭에서 카드가 세로로 접히도록 flex-wrap/flex-col만 쓴다.

function errMsg(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback
}

// S22(설계 §4.24 ②, F48) — 'cancelled' 추가(S13 한계 해소 — §5.9 개정: 처리 중 1건도 이제
// [취소] 가능). 취소됨은 오류가 아닌 중립 상태라 배경·문구 모두 error와 구분한다.
// 'split_in_progress'(사용자 실사용 피드백 반영, §4.25) — too_large 실패 항목이 [분할 반입]으로
// 이미 분할을 시작한 상태. 오류가 아닌 중립 진행 상태라 error 배지와 구분한다.
const STATUS_LABEL: Record<QueueItemStatus, string> = {
  queued: '대기',
  running: '변환 중',
  ready: '검토 대기',
  committed: '반입 완료',
  error: '실패',
  cancelled: '취소됨',
  split_in_progress: '분할 진행 중',
}

const STATUS_CLASS: Record<QueueItemStatus, string> = {
  queued: 'bg-surface-raised text-muted',
  running: 'bg-accent text-on-accent',
  ready: 'bg-warning text-on-accent',
  committed: 'bg-correct text-on-accent',
  error: 'bg-wrong text-on-accent',
  cancelled: 'border border-border text-muted',
  split_in_progress: 'border border-accent text-accent',
}

function StatusBadge({ status }: { status: QueueItemStatus }) {
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_CLASS[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  )
}

function DownloadJsonLink({ previewId }: { previewId: string }) {
  return (
    <a
      href={previewJsonUrl(previewId)}
      download
      className="rounded border border-border px-3 py-1.5 text-xs text-primary hover:bg-bg"
    >
      변환 JSON 내려받기
    </a>
  )
}

interface ItemCardProps {
  item: QueueItem
  starting: boolean
  reviewingEntryId: string | null
  reviewError: string | null
  onReview: (item: QueueItem) => void
  onRemove: (entryId: string) => void
  onRetryApi: (entryId: string, engineId?: string) => void
  onSplitReupload: () => void
  onSplitImport: (item: QueueItem) => void
  onCancelRequest: (entryId: string) => void
  cancelling: boolean
}

// 카드 1건 렌더 — 단독 항목·분할 조각 그룹 내부 항목 양쪽에서 재사용한다(ImportQueueList 본문 참고).
function ItemCard({
  item,
  starting,
  reviewingEntryId,
  reviewError,
  onReview,
  onRemove,
  onRetryApi,
  onSplitReupload,
  onSplitImport,
  onCancelRequest,
  cancelling,
}: ItemCardProps) {
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={item.status} />
        <span className="min-w-0 flex-1 break-all text-sm font-medium text-primary">{item.label}</span>
      </div>

      {item.entry.categoryPath && (
        <p className="text-xs text-muted">
          분류 경로 제안: <span className="text-accent">{item.entry.categoryPath}</span>
        </p>
      )}

      {/* 잡 성공 소표기(S14, §4.13) — 서버가 완성해 내려준 문장을 그대로 렌더(가공 금지). */}
      {item.notes.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {item.notes.map((note, i) => (
            <li key={i} className="text-xs text-muted">
              {note}
            </li>
          ))}
        </ul>
      )}

      {/* 진행 표시는 현재 처리 중 1건에만(나머지는 배지만 — 폴링 간격도 완화) */}
      {item.active && item.unavailable == null && (
        <LlmJobProgress progress={item.progress} includeDownloading={item.entry.sourceKind === 'url'} />
      )}

      {/* 'lost'(404)는 아래 오류 렌더가 같은 내용을 이미 말하므로 여기서는 연결 실패만 안내한다. */}
      {item.unavailable === 'unreachable' && item.status !== 'committed' && (
        <div className="flex flex-col gap-2 rounded border border-warning bg-accent-soft px-3 py-2 text-xs text-primary">
          <p>
            서버에 연결하지 못했습니다. 서버가 꺼져 있거나 다시 시작하는 중일 수 있습니다 — 서버를 켠 뒤
            [다시 확인]을 눌러 보세요. 작업이 아직 살아 있으면 이어서 표시됩니다.
          </p>
          {item.refetch && (
            <button
              type="button"
              onClick={item.refetch}
              className="w-fit rounded border border-border px-3 py-1.5 text-xs text-primary hover:bg-bg"
            >
              다시 확인
            </button>
          )}
        </div>
      )}

      {item.status === 'error' && (
        <LlmErrorInfoView
          errorInfo={item.errorInfo}
          legacyError={item.legacyError}
          onRetry={item.retryable ? (engineId) => onRetryApi(item.entry.id, engineId) : undefined}
          retrying={starting}
          onSplitReupload={onSplitReupload}
          onSplitImport={() => onSplitImport(item)}
        />
      )}

      {/* 재진입 앵커(사용자 실사용 피드백 반영, §4.25) — 위저드를 닫거나 다른 화면에
          갔다 와도(새로고침 포함) 여기서 이어서 연다. */}
      {item.status === 'split_in_progress' && (
        <div className="flex flex-col gap-2 rounded border border-accent bg-accent-soft px-3 py-2 text-xs text-primary">
          <p>분할 반입을 진행하던 원본입니다 — 이어서 조각을 확인하고 투입하세요.</p>
          <button
            type="button"
            onClick={() => onSplitImport(item)}
            className="w-fit rounded bg-accent px-3 py-1.5 text-xs font-medium text-on-accent hover:opacity-90"
          >
            분할안 열기
          </button>
        </div>
      )}

      {item.status === 'error' && !item.retryable && item.entry.sourceKind === 'file' && (
        <p className="text-xs text-warning">
          새로고침으로 파일 정보가 사라졌습니다. 파일을 다시 선택한 뒤 재시도하세요.
        </p>
      )}

      {item.status === 'ready' && reviewError && reviewingEntryId === item.entry.id && (
        <p className="text-xs text-wrong">{reviewError}</p>
      )}

      <div className="flex flex-wrap gap-2">
        {item.status === 'ready' && (
          <button
            type="button"
            onClick={() => onReview(item)}
            className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-on-accent hover:opacity-90"
          >
            {reviewingEntryId === item.entry.id && !reviewError ? '미리보기 여는 중…' : '검토'}
          </button>
        )}
        {item.previewId && <DownloadJsonLink previewId={item.previewId} />}
        {item.status !== 'running' && (
          <button
            type="button"
            onClick={() => onRemove(item.entry.id)}
            className="rounded border border-border px-3 py-1.5 text-xs text-primary hover:bg-bg"
          >
            {item.status === 'committed' ? '목록에서 지우기' : '건너뛰기'}
          </button>
        )}
        {/* S22(설계 §4.24 ②, F48) — 처리 중 1건 [취소](S13 한계 해소). 작업 센터와 같은
            cancel API·같은 확인 다이얼로그(고정 문구). */}
        {item.status === 'running' && item.entry.jobId && (
          <button
            type="button"
            onClick={() => onCancelRequest(item.entry.id)}
            disabled={cancelling}
            className="rounded border border-border px-3 py-1.5 text-xs text-wrong hover:bg-bg disabled:opacity-50"
          >
            취소
          </button>
        )}
      </div>
    </li>
  )
}

interface ImportQueueListProps {
  items: QueueItem[]
  starting: boolean
  reviewingEntryId: string | null
  reviewError: string | null
  onReview: (item: QueueItem) => void
  onRemove: (entryId: string) => void
  // S15(설계 §4.17③) — engineId는 error_info.fallback_engine(없으면 legacy 'api' 폴백,
  // useConvertQueue.retryEntry 기본값이 처리)을 그대로 전달받는다. 이름은 호환을 위해 유지.
  onRetryApi: (entryId: string, engineId?: string) => void
  // invalid_output(F40-④) — 시작 화면으로 돌아가 원본을 나눠 다시 올리게 한다.
  onSplitReupload: () => void
  // too_large(S23, §4.25, F49) — alternatives에 'split_import'가 실린 항목에서 분할 위저드를
  // 연다. 항목(entry)을 넘겨받아 호출부가 sourceKind(file/url)에 맞는 원본을 되찾는다.
  onSplitImport: (item: QueueItem) => void
  // stage-42(B2-2, §4.25) — [합쳐서 검토] 성공 시 병합된 조각 항목을 제거하고 새 항목 1개를
  // 큐에 편입한다(useConvertQueue.mergeSplitEntries). 새 항목의 id를 돌려받아 곧장 [검토]로 잇는다.
  onMergeSplitEntries: (
    entryIds: string[],
    merged: { previewId: string; fileName: string; categoryPath: string | null },
  ) => string
  onClearFinished: () => void
  // S22(설계 §4.24 ②, F48) — 처리 중 1건 [취소](S13 한계 해소, §5.9 개정). 확인 다이얼로그는
  // 이 컴포넌트가 띄우고(작업 센터와 같은 고정 문구), 실제 API 호출은 호출부(useConvertQueue)가 한다.
  onCancel: (entryId: string) => void
  cancelling: boolean
  cancelError: unknown
}

// 렌더 그룹 — 같은 splitId를 가진 sourceKind==='split' 조각은 한 그룹으로 묶어 헤더 아래 렌더한다
// (등장 순서를 유지하려 첫 등장 위치에 그룹을 만든다). 그 외 항목은 splitId:null의 그룹 1개.
interface RenderGroup {
  splitId: string | null
  entries: QueueItem[]
}

function buildRenderGroups(items: QueueItem[]): RenderGroup[] {
  const groups: RenderGroup[] = []
  const indexBySplit = new Map<string, number>()
  for (const item of items) {
    const gid = item.entry.sourceKind === 'split' ? (item.entry.splitId ?? null) : null
    if (gid) {
      const idx = indexBySplit.get(gid)
      if (idx != null) {
        groups[idx].entries.push(item)
        continue
      }
      indexBySplit.set(gid, groups.length)
      groups.push({ splitId: gid, entries: [item] })
    } else {
      groups.push({ splitId: null, entries: [item] })
    }
  }
  return groups
}

// 병합 결과 새 항목 파일명 기초 — 조각 라벨 끝의 "(n-m)" 표기(§4.25 ②, `/` 금지 정정)를 지운다.
function baseFileName(label: string): string {
  return label.replace(/\s*\(\d+-\d+\)\s*$/, '').trim() || label
}

export default function ImportQueueList({
  items,
  starting,
  reviewingEntryId,
  reviewError,
  onReview,
  onRemove,
  onRetryApi,
  onSplitReupload,
  onSplitImport,
  onMergeSplitEntries,
  onClearFinished,
  onCancel,
  cancelling,
  cancelError,
}: ImportQueueListProps) {
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null)
  const mergeMutation = useMergePreviews()
  const [mergingSplitId, setMergingSplitId] = useState<string | null>(null)
  const [mergeErrors, setMergeErrors] = useState<Record<string, string>>({})

  if (items.length === 0) return null

  const finishedCount = items.filter((it) => it.status === 'committed').length
  const readyCount = items.filter((it) => it.status === 'ready').length
  const pendingCount = items.filter((it) => it.status === 'queued' || it.status === 'running').length

  const groups = buildRenderGroups(items)

  function handleMergeGroup(group: RenderGroup) {
    const readyItems = group.entries.filter((it) => it.status === 'ready' && it.previewId)
    if (readyItems.length < 2 || !group.splitId) return
    const splitId = group.splitId
    setMergingSplitId(splitId)
    setMergeErrors((prev) => {
      const next = { ...prev }
      delete next[splitId]
      return next
    })
    mergeMutation.mutate(readyItems.map((it) => it.previewId as string), {
      onSuccess: (data) => {
        setMergingSplitId(null)
        const paths = group.entries.map((it) => it.entry.categoryPath ?? null)
        const commonPath = paths.every((p) => p === paths[0]) ? paths[0] : null
        const newEntryId = onMergeSplitEntries(
          readyItems.map((it) => it.entry.id),
          {
            previewId: data.preview_id,
            fileName: `${baseFileName(readyItems[0].label)} (분할 병합 ${readyItems.length}조각)`,
            categoryPath: commonPath,
          },
        )
        // 기존 [검토] 경로를 그대로 재사용한다(onReview는 entry.id·previewId·notes만 읽는다).
        onReview({ entry: { id: newEntryId }, previewId: data.preview_id, notes: [] } as unknown as QueueItem)
      },
      onError: (e) => {
        setMergingSplitId(null)
        setMergeErrors((prev) => ({ ...prev, [splitId]: errMsg(e, '병합에 실패했습니다.') }))
      },
    })
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-primary">
          반입 대기열 <span className="text-muted">({items.length}건)</span>
        </h2>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span>진행 {pendingCount}</span>
          <span>검토 대기 {readyCount}</span>
          <span>완료 {finishedCount}</span>
          {finishedCount > 0 && (
            <button
              type="button"
              onClick={onClearFinished}
              className="rounded border border-border px-2 py-1 text-xs text-primary hover:bg-bg"
            >
              완료 항목 정리
            </button>
          )}
        </div>
      </div>

      <ul className="flex flex-col gap-3">
        {groups.map((group) => {
          if (group.splitId == null) {
            const item = group.entries[0]
            return (
              <ItemCard
                key={item.entry.id}
                item={item}
                starting={starting}
                reviewingEntryId={reviewingEntryId}
                reviewError={reviewError}
                onReview={onReview}
                onRemove={onRemove}
                onRetryApi={onRetryApi}
                onSplitReupload={onSplitReupload}
                onSplitImport={onSplitImport}
                onCancelRequest={setConfirmCancelId}
                cancelling={cancelling}
              />
            )
          }

          const total = group.entries[0]?.entry.splitTotal ?? group.entries.length
          const doneCount = group.entries.filter((it) => it.status === 'ready' || it.status === 'error').length
          const readyItems = group.entries.filter((it) => it.status === 'ready')
          const allTerminal = group.entries.every((it) => it.status === 'ready' || it.status === 'error')
          const canMerge = allTerminal && readyItems.length >= 2

          return (
            <li key={group.splitId} className="flex flex-col gap-3 rounded-lg border border-accent bg-bg p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-accent">
                  분할 조각 {doneCount}/{total} 검토 대기
                </span>
                {canMerge && (
                  <button
                    type="button"
                    onClick={() => handleMergeGroup(group)}
                    disabled={mergingSplitId === group.splitId}
                    className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
                  >
                    {mergingSplitId === group.splitId ? '병합 중…' : `합쳐서 검토 (${readyItems.length}조각)`}
                  </button>
                )}
              </div>
              {mergeErrors[group.splitId] && <p className="text-xs text-wrong">{mergeErrors[group.splitId]}</p>}
              <ul className="flex flex-col gap-3">
                {group.entries.map((item) => (
                  <ItemCard
                    key={item.entry.id}
                    item={item}
                    starting={starting}
                    reviewingEntryId={reviewingEntryId}
                    reviewError={reviewError}
                    onReview={onReview}
                    onRemove={onRemove}
                    onRetryApi={onRetryApi}
                    onSplitReupload={onSplitReupload}
                    onSplitImport={onSplitImport}
                    onCancelRequest={setConfirmCancelId}
                    cancelling={cancelling}
                  />
                ))}
              </ul>
            </li>
          )
        })}
      </ul>

      {confirmCancelId && (
        <ConfirmDialog
          title="작업 취소"
          message="실행 중 취소는 이미 처리된 토큰만큼 요금이 발생할 수 있습니다."
          confirmLabel="취소하기"
          danger
          submitting={cancelling}
          errorMessage={cancelError ? errMsg(cancelError, '취소에 실패했습니다.') : null}
          onConfirm={() => {
            onCancel(confirmCancelId)
            setConfirmCancelId(null)
          }}
          onClose={() => setConfirmCancelId(null)}
        />
      )}
    </section>
  )
}

// preview·result 단계에서 유지되는 접힌 요약 — 대기열이 살아 있음을 잊지 않게 한다(§5.9).
export function ImportQueueSummary({
  items,
  onBackToQueue,
}: {
  items: QueueItem[]
  onBackToQueue: () => void
}) {
  if (items.length === 0) return null
  const ready = items.filter((it) => it.status === 'ready').length
  const pending = items.filter((it) => it.status === 'queued' || it.status === 'running').length
  if (ready === 0 && pending === 0) return null

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm">
      <span className="text-primary">
        검토 대기 {ready}건{pending > 0 && ` · 변환 대기·진행 ${pending}건`}
      </span>
      <button
        type="button"
        onClick={onBackToQueue}
        className="rounded border border-border px-3 py-1.5 text-xs text-primary hover:bg-bg"
      >
        대기열 보기
      </button>
    </div>
  )
}
