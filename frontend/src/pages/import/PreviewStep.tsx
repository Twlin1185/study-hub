import { useState } from 'react'
import { previewJsonUrl } from '../../api/convert'
import MarkdownView from '../../components/MarkdownView'
import CategoryPathField, { categoryPathError } from '../../components/CategoryPathField'
import type {
  ImportAction,
  ImportItem,
  ImportItemOverride,
  ImportItemWarning,
  ImportPreviewResponse,
} from '../../api/types'
import { TYPE_LABEL, categoryApprovalKey, choiceLabel, hasExclusionWarning, toggleValue } from './importShared'
import type { ItemDecisionState } from './importShared'

interface PreviewStepProps {
  preview: ImportPreviewResponse
  // 잡 성공 소표기(S14, §4.13 notes) — GET /api/convert/{job_id}.notes를 그대로 전달받아
  // 렌더한다(직접 JSON 업로드 경로는 잡이 없으므로 항상 빈 배열).
  notes: string[]
  showJsonDownload: boolean
  decisions: Record<number, ItemDecisionState>
  onUpdateDecision: (index: number, patch: Partial<ItemDecisionState>) => void
  onSkipAll: () => void
  onBack: () => void
  onCommit: () => void
  committing: boolean
  commitError: string | null
}

export default function PreviewStep({
  preview,
  notes,
  showJsonDownload,
  decisions,
  onUpdateDecision,
  onSkipAll,
  onBack,
  onCommit,
  committing,
  commitError,
}: PreviewStepProps) {
  const { summary, source, items } = preview

  return (
    <div className="flex flex-col gap-4">
      {/* S13(F40-①, 설계 §4.3) — 디스크 보존본에서 복구된 미리보기 소표기 */}
      {preview.recovered && (
        <div className="rounded border border-accent bg-accent-soft px-3 py-2 text-sm text-primary">
          이전 미리보기를 복구했습니다 — 중복 판정은 현재 DB 기준입니다.
        </div>
      )}

      {/* 잡 성공 소표기(S14, §4.13 notes) — 서버가 완성한 문장을 그대로 렌더(포맷 분기 금지). */}
      {notes.length > 0 && (
        <div className="flex flex-col gap-1 rounded border border-border bg-surface px-3 py-2 text-sm text-muted">
          {notes.map((note, i) => (
            <p key={i}>{note}</p>
          ))}
        </div>
      )}

      {source.duplicate_source && (
        <div className="rounded border border-warning bg-accent-soft px-3 py-2 text-sm text-primary">
          같은 원본이 이미 반입된 적 있습니다 ("{source.filename}"). 내용이 중복 의심으로 잡힐 수 있습니다.
        </div>
      )}

      {/* S15(설계 §4.17⑥) — 대조 불가는 조용한 통과 금지: 배지(항목별) + 상단 안내 1줄.
          기본 반입은 유지한다(제외하면 이미지 PDF 경로 전체가 막힘). */}
      {items.some((i) => i.warnings?.includes('match_unavailable')) && (
        <div className="rounded border border-border bg-surface px-3 py-2 text-sm text-muted">
          원본에서 텍스트를 추출하지 못해 원문 대조를 수행하지 못했습니다 — 반입 전 원본과 직접
          대조하세요.
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface p-3 text-sm">
        <div className="flex flex-wrap gap-3">
          <span className="text-primary">전체 {summary.total}</span>
          <span className="text-correct">정상 {summary.ok}</span>
          <span className="text-warning">중복 의심 {summary.duplicate_suspect}</span>
          <span className="text-wrong">오류 {summary.error}</span>
          {(summary.warning ?? 0) > 0 && <span className="text-warning">경고 {summary.warning}</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          {showJsonDownload && (
            <a
              href={previewJsonUrl(preview.preview_id)}
              download
              className="rounded border border-border px-3 py-1.5 text-xs text-primary hover:bg-bg"
            >
              변환 JSON 내려받기
            </a>
          )}
          <button
            type="button"
            onClick={onSkipAll}
            className="rounded border border-border px-3 py-1.5 text-xs text-primary hover:bg-bg"
          >
            전체 건너뛰기
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {items.map((item) => (
          <ItemRow
            key={item.index}
            item={item}
            state={decisions[item.index]}
            onUpdateDecision={onUpdateDecision}
          />
        ))}
      </div>

      {commitError && <p className="text-sm text-wrong">{commitError}</p>}

      <div className="flex justify-between">
        <button
          type="button"
          onClick={onBack}
          className="rounded border border-border px-4 py-2 text-sm text-primary hover:bg-bg"
        >
          ← 뒤로
        </button>
        <button
          type="button"
          disabled={committing}
          onClick={onCommit}
          className="rounded bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
        >
          {committing ? '반입 실행 중…' : '반입 실행'}
        </button>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: ImportItem['status'] }) {
  const map: Record<ImportItem['status'], { label: string; className: string }> = {
    ok: { label: '정상', className: 'bg-correct text-on-accent' },
    duplicate_suspect: { label: '중복 의심', className: 'bg-warning text-on-accent' },
    error: { label: '오류', className: 'bg-wrong text-on-accent' },
  }
  const conf = map[status]
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${conf.className}`}>{conf.label}</span>
}

// S15(설계 §4.17⑤·⑥) — 변환 신뢰 게이트 경고 배지. 모르는 값은 무시(전방 호환, alternatives 관례).
const WARNING_BADGE: Record<ImportItemWarning, { label: string; className: string }> = {
  solved_answer: { label: 'AI가 정답을 직접 채움', className: 'bg-warning text-on-accent' },
  fabrication_suspect: { label: '원문과 불일치 (창작 의심)', className: 'bg-wrong text-on-accent' },
  match_unavailable: { label: '원문 대조 불가', className: 'border border-border text-muted' },
  // stage-42(B4-S1/S7) — 분류 제안 0건·형식 오류. 반입 자체는 막지 않고 아래 분류 블록에서
  // 경로를 직접 입력해 분류할 수 있다(항상 렌더).
  no_category: { label: '분류 제안 없음', className: 'border border-border text-muted' },
  category_malformed: { label: '분류 제안 형식 오류 — 일부만 반영됨', className: 'bg-warning text-on-accent' },
}

function WarningBadges({ warnings }: { warnings: ImportItemWarning[] | undefined }) {
  if (!warnings || warnings.length === 0) return null
  return (
    <>
      {warnings.map((w) => {
        const conf = WARNING_BADGE[w]
        if (!conf) return null
        return (
          <span key={w} className={`rounded px-2 py-0.5 text-[11px] font-medium ${conf.className}`}>
            {conf.label}
          </span>
        )
      })}
    </>
  )
}

interface ItemRowProps {
  item: ImportItem
  state: ItemDecisionState | undefined
  onUpdateDecision: (index: number, patch: Partial<ItemDecisionState>) => void
}

function ItemRow({ item, state, onUpdateDecision }: ItemRowProps) {
  const isSkipped = state?.action === 'skip'
  const isQuestionType = item.type === 'question' || item.type === 'past_question'

  // stage-42(B3, §4.3) — 검토 단계 본문 열람·편집(구 편집기 재사용 금지 — 제목 input · 본문/정답/
  // 해설 textarea만). 편집분은 decisions[index].override에 보관, commit에 그대로 실린다.
  const [bodyOpen, setBodyOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState(item.title)
  const [draftContent, setDraftContent] = useState(item.content ?? '')
  const [draftAnswer, setDraftAnswer] = useState(item.answer ?? '')
  const [draftExplanation, setDraftExplanation] = useState(item.explanation ?? '')
  // stage-42(B4-S12) — 항목별 분류 경로 직접 추가.
  const [manualCategoryPath, setManualCategoryPath] = useState('')
  const [pathFieldKey, setPathFieldKey] = useState(0)

  // merge 액션은 본문 불변(override 미반영)이므로 배지도 숨긴다(재검토 경미 ⓑ).
  const hasOverride = Boolean(
    state?.action !== 'merge' && state?.override && Object.keys(state.override).length > 0,
  )
  const effectiveTitle = state?.override?.title ?? item.title
  const effectiveContent = state?.override?.content ?? item.content ?? null
  const effectiveAnswer = state?.override?.answer ?? item.answer ?? null
  const effectiveExplanation = state?.override?.explanation ?? item.explanation ?? null

  function startEditing() {
    setDraftTitle(effectiveTitle)
    setDraftContent(effectiveContent ?? '')
    setDraftAnswer(effectiveAnswer ?? '')
    setDraftExplanation(effectiveExplanation ?? '')
    setEditing(true)
    setBodyOpen(true)
  }

  function saveEdit() {
    if (!state) return
    const override: ImportItemOverride = {}
    if (draftTitle !== item.title) override.title = draftTitle
    if (draftContent !== (item.content ?? '')) override.content = draftContent
    if (isQuestionType) {
      if (draftAnswer !== (item.answer ?? '')) override.answer = draftAnswer
      if (draftExplanation !== (item.explanation ?? '')) override.explanation = draftExplanation
    }
    onUpdateDecision(item.index, { override: Object.keys(override).length > 0 ? override : undefined })
    setEditing(false)
  }

  // 수동으로 추가한 분류 경로(문자열) — LLM 제안(item.suggest_categories)에 없는 문자열 승인만
  // 골라내면 "추가분" 칩으로 다시 렌더할 수 있다(별도 상태 없이 approvedCategoryIds가 단일 출처).
  const manualApprovedPaths = (state?.approvedCategoryIds ?? []).filter(
    (id): id is string => typeof id === 'string' && !item.suggest_categories.some((sc) => sc.path === id),
  )

  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <StatusBadge status={item.status} />
        <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent">
          {TYPE_LABEL[item.type] ?? item.type}
        </span>
        <span className="text-sm font-medium text-primary">
          #{item.index} {effectiveTitle}
        </span>
        {hasOverride && (
          <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent">편집됨</span>
        )}
        <WarningBadges warnings={item.warnings} />
      </div>

      {/* stage-42(B3) — 본문·선택지·정답·해설 열람·편집. error 항목은 서버가 정규화 본문을 싣지
          않으므로(§4.3) 토글을 숨긴다(검토 1차 경미 ⑤). merge 선택 항목은 본문 불변(기존 문서에
          병합 — override 미반영)이라 [편집]을 숨긴다(경미 ④). */}
      {item.status !== 'error' && (
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setBodyOpen((v) => !v)}
          className="text-xs font-medium text-accent hover:underline"
        >
          {bodyOpen ? '본문 접기 ▾' : '본문 보기 ▸'}
        </button>
        {!editing && state?.action !== 'merge' && (
          <button type="button" onClick={startEditing} className="text-xs font-medium text-accent hover:underline">
            편집
          </button>
        )}
        {state?.action === 'merge' && (
          <span className="text-xs text-muted">병합 항목은 기존 문서 본문을 유지합니다 — 편집 불가</span>
        )}
      </div>
      )}

      {bodyOpen && !editing && (
        <div className="mb-3 flex flex-col gap-2 rounded border border-border bg-bg p-2">
          <MarkdownView content={effectiveContent} />
          {item.choices && item.choices.length > 0 && (
            <ol className="ml-4 list-decimal text-sm text-primary">
              {item.choices.map((c, i) => (
                <li key={i}>{choiceLabel(c)}</li>
              ))}
            </ol>
          )}
          {isQuestionType && (
            <div>
              <p className="text-xs font-semibold text-muted">정답</p>
              <p className="whitespace-pre-wrap text-sm text-primary">{effectiveAnswer || '(없음)'}</p>
            </div>
          )}
          {isQuestionType && effectiveExplanation && (
            <div>
              <p className="mb-1 text-xs font-semibold text-muted">해설</p>
              <MarkdownView content={effectiveExplanation} />
            </div>
          )}
        </div>
      )}

      {editing && (
        <div className="mb-3 flex flex-col gap-2 rounded border border-accent bg-bg p-2">
          <label className="flex flex-col gap-1 text-xs text-primary">
            제목
            <input
              type="text"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              className="rounded border border-border bg-surface px-2 py-1 text-sm text-primary outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-primary">
            본문(마크다운 원문)
            <textarea
              value={draftContent}
              onChange={(e) => setDraftContent(e.target.value)}
              rows={8}
              className="rounded border border-border bg-surface px-2 py-1 font-mono text-xs text-primary outline-none focus:border-accent"
            />
          </label>
          {isQuestionType && (
            <>
              <label className="flex flex-col gap-1 text-xs text-primary">
                정답
                <textarea
                  value={draftAnswer}
                  onChange={(e) => setDraftAnswer(e.target.value)}
                  rows={2}
                  className="rounded border border-border bg-surface px-2 py-1 text-sm text-primary outline-none focus:border-accent"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-primary">
                해설(마크다운 원문)
                <textarea
                  value={draftExplanation}
                  onChange={(e) => setDraftExplanation(e.target.value)}
                  rows={4}
                  className="rounded border border-border bg-surface px-2 py-1 font-mono text-xs text-primary outline-none focus:border-accent"
                />
              </label>
            </>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded border border-border px-3 py-1 text-xs text-primary hover:bg-surface"
            >
              취소
            </button>
            <button
              type="button"
              disabled={
                draftTitle.trim().length === 0 ||
                (draftContent !== (item.content ?? '') && draftContent.trim().length === 0)
              }
              onClick={saveEdit}
              className="rounded bg-accent px-3 py-1 text-xs font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
            >
              저장
            </button>
          </div>
        </div>
      )}

      {item.status !== 'error' && hasExclusionWarning(item.warnings) && (
        <p className="mb-2 text-[11px] text-warning">
          경고 항목이라 기본적으로 반입에서 제외됩니다 — 포함하려면 아래에서 명시적으로
          선택하세요.
        </p>
      )}

      {item.status === 'error' && (
        <ul className="ml-1 list-disc pl-4 text-sm text-wrong">
          {item.errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}

      {item.status !== 'error' && state && (
        <div className="flex flex-col gap-3">
          {item.status === 'duplicate_suspect' && item.duplicate_of && (
            <div className="grid grid-cols-1 gap-2 rounded border border-border bg-bg p-2 text-xs sm:grid-cols-2">
              <div>
                <p className="mb-1 font-semibold text-muted">새 항목</p>
                <p className="text-primary">{item.title}</p>
              </div>
              <div>
                <p className="mb-1 font-semibold text-muted">기존 문서 ({item.duplicate_of.doc_no})</p>
                <p className="text-primary">{item.duplicate_of.title}</p>
              </div>
            </div>
          )}

          {item.status === 'duplicate_suspect' ? (
            <div className="flex flex-wrap gap-3 text-sm text-primary">
              {(['skip', 'new', 'merge'] as ImportAction[]).map((action) => (
                <label key={action} className="flex items-center gap-1">
                  <input
                    type="radio"
                    name={`action-${item.index}`}
                    checked={state.action === action}
                    onChange={() => onUpdateDecision(item.index, { action })}
                  />
                  {action === 'skip' ? '건너뛰기' : action === 'new' ? '새로 추가' : '기존에 병합'}
                </label>
              ))}
            </div>
          ) : (
            <label className="flex items-center gap-1 text-sm text-primary">
              <input
                type="checkbox"
                checked={isSkipped}
                onChange={(e) => onUpdateDecision(item.index, { action: e.target.checked ? 'skip' : 'new' })}
              />
              이 항목 건너뛰기
            </label>
          )}

          {/* stage-42(B4-S1/S8/S12) — 제안이 비어도 항상 렌더(무분류 반입 방지). */}
          <div>
            <p className="mb-1 text-xs font-semibold text-muted">분류</p>
            {item.suggest_categories.length === 0 ? (
              <p className="mb-2 text-xs text-muted">
                분류 제안 없음 — 아래에 경로를 입력하면 생성·연결합니다.
              </p>
            ) : (
              <div className="mb-1 flex flex-wrap gap-2">
                {item.suggest_categories.map((sc) => {
                  const key = categoryApprovalKey(sc)
                  const checked = state.approvedCategoryIds.includes(key)
                  return (
                    <label
                      key={sc.path}
                      className={`flex items-center gap-1 rounded border border-border px-2 py-1 text-xs ${
                        isSkipped ? 'opacity-50' : ''
                      }`}
                    >
                      <input
                        type="checkbox"
                        disabled={isSkipped}
                        checked={checked}
                        onChange={() =>
                          onUpdateDecision(item.index, {
                            approvedCategoryIds: toggleValue(state.approvedCategoryIds, key),
                          })
                        }
                      />
                      {sc.path}
                      {!sc.exists && (
                        <span className="rounded bg-accent-soft px-1 text-accent">생성 제안</span>
                      )}
                      {sc.container && (
                        <span
                          className="rounded bg-warning px-1 text-on-accent"
                          title="하위 분류(회차·과목)에 연결하는 편이 좋습니다"
                        >
                          중간 노드
                        </span>
                      )}
                    </label>
                  )
                })}
              </div>
            )}
            {item.suggest_categories.some((sc) => sc.container) && (
              <p className="mb-1 text-[11px] text-warning">
                ⚠ 자식이 있는 중간 노드 제안은 기본 미체크입니다. 하위 분류(회차·과목)에 연결하는
                편이 커리큘럼·모의고사·인쇄에서 다루기 쉽습니다(막지는 않습니다).
              </p>
            )}

            {manualApprovedPaths.length > 0 && (
              <div className="mb-1 flex flex-wrap gap-2">
                {manualApprovedPaths.map((path) => (
                  <span
                    key={path}
                    className="flex items-center gap-1 rounded border border-accent bg-accent-soft px-2 py-1 text-xs text-accent"
                  >
                    {path}
                    <span className="rounded bg-accent-soft px-1">직접 추가</span>
                    <button
                      type="button"
                      disabled={isSkipped}
                      onClick={() =>
                        onUpdateDecision(item.index, {
                          approvedCategoryIds: toggleValue(state.approvedCategoryIds, path),
                        })
                      }
                      className="text-accent hover:opacity-70 disabled:opacity-50"
                      aria-label={`${path} 분류 추가 취소`}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="mt-1 flex flex-col gap-1">
              {/* CategoryPathField는 내부 상태(basePath·extra)만 쓰고 value를 읽지 않으므로 추가 후
                  key를 바꿔 리마운트해야 입력이 비워진다(검토 1차 중요 ③). */}
              <CategoryPathField key={pathFieldKey} value={manualCategoryPath} onChange={setManualCategoryPath} />
              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={
                    isSkipped ||
                    !manualCategoryPath ||
                    categoryPathError(manualCategoryPath) != null ||
                    state.approvedCategoryIds.includes(manualCategoryPath)
                  }
                  onClick={() => {
                    onUpdateDecision(item.index, {
                      approvedCategoryIds: [...state.approvedCategoryIds, manualCategoryPath],
                    })
                    setManualCategoryPath('')
                    setPathFieldKey((k) => k + 1)
                  }}
                  className="rounded border border-border px-2 py-1 text-xs text-primary hover:bg-surface disabled:opacity-50"
                >
                  경로 추가
                </button>
              </div>
            </div>
          </div>

          {item.suggest_relations.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-muted">관계 제안</p>
              <div className="flex flex-wrap gap-2">
                {item.suggest_relations.map((sr) => {
                  const checked = sr.found && sr.document_id != null && state.approvedRelationIds.includes(sr.document_id)
                  return (
                    <label
                      key={sr.doc_no}
                      className={`flex items-center gap-1 rounded border border-border px-2 py-1 text-xs ${
                        isSkipped || !sr.found ? 'opacity-50' : ''
                      }`}
                    >
                      <input
                        type="checkbox"
                        disabled={isSkipped || !sr.found}
                        checked={checked}
                        onChange={() =>
                          sr.found &&
                          sr.document_id != null &&
                          onUpdateDecision(item.index, {
                            approvedRelationIds: toggleValue(state.approvedRelationIds, sr.document_id),
                          })
                        }
                      />
                      {sr.doc_no}
                      {!sr.found && <span className="text-wrong">문서를 찾을 수 없음</span>}
                    </label>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
