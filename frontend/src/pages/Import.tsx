import { useState } from 'react'
import type { ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import { useImportCommit, useImportPreview } from '../api/import'
import { ApiError } from '../api/client'
import type {
  ImportAction,
  ImportCommitResult,
  ImportDecision,
  ImportItem,
  ImportPreviewResponse,
} from '../api/types'

type WizardStep = 'select' | 'preview' | 'result'

interface ItemDecisionState {
  action: ImportAction
  // number = 기존 분류 category_id(exists:true) · string = 생성 승인할 경로(exists:false)
  approvedCategoryIds: (number | string)[]
  approvedRelationIds: number[]
}

const TYPE_LABEL: Record<string, string> = {
  concept: '개념',
  question: '문제',
  past_question: '기출',
  flashcard: '카드',
}

function errMsg(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback
}

function toggleValue<T>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value]
}

// 분류 제안 승인 식별키 — 기존 분류면 category_id, 생성 제안이면 path 문자열
function categoryApprovalKey(sc: { category_id: number | null; path: string }): number | string {
  return sc.category_id ?? sc.path
}

function buildInitialDecisions(items: ImportItem[]): Record<number, ItemDecisionState> {
  const initial: Record<number, ItemDecisionState> = {}
  for (const item of items) {
    if (item.status === 'error') continue
    initial[item.index] = {
      action: item.status === 'duplicate_suspect' ? 'skip' : 'new',
      // 분류 제안은 기존/생성 제안 모두 기본 체크
      approvedCategoryIds: item.suggest_categories.map(categoryApprovalKey),
      approvedRelationIds: item.suggest_relations
        .filter((r) => r.found && r.document_id != null)
        .map((r) => r.document_id as number),
    }
  }
  return initial
}

export default function ImportPage() {
  const [step, setStep] = useState<WizardStep>('select')
  const [jsonFile, setJsonFile] = useState<File | null>(null)
  const [sourceFile, setSourceFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null)
  const [decisions, setDecisions] = useState<Record<number, ItemDecisionState>>({})
  const [expiredNotice, setExpiredNotice] = useState<string | null>(null)
  const [result, setResult] = useState<ImportCommitResult | null>(null)
  const [erroredCount, setErroredCount] = useState(0)

  const previewMutation = useImportPreview()
  const commitMutation = useImportCommit()

  function resetWizard() {
    setStep('select')
    setJsonFile(null)
    setSourceFile(null)
    setPreview(null)
    setDecisions({})
    setResult(null)
    setErroredCount(0)
  }

  function handlePreviewSubmit() {
    if (!jsonFile) return
    setExpiredNotice(null)
    previewMutation.mutate(
      { jsonFile, sourceFile },
      {
        onSuccess: (data) => {
          setPreview(data)
          setDecisions(buildInitialDecisions(data.items))
          setStep('preview')
        },
      },
    )
  }

  function updateDecision(index: number, patch: Partial<ItemDecisionState>) {
    setDecisions((prev) => ({
      ...prev,
      [index]: { ...prev[index], ...patch },
    }))
  }

  function skipAll() {
    setDecisions((prev) => {
      const next: Record<number, ItemDecisionState> = {}
      for (const [key, state] of Object.entries(prev)) {
        next[Number(key)] = { ...state, action: 'skip' }
      }
      return next
    })
  }

  function handleCommit() {
    if (!preview) return
    const decisionList: ImportDecision[] = Object.entries(decisions).map(([idxStr, state]) => {
      const index = Number(idxStr)
      if (state.action === 'skip') {
        return { index, action: 'skip' }
      }
      const item = preview.items.find((i) => i.index === index)
      const decision: ImportDecision = {
        index,
        action: state.action,
        approve_categories: state.approvedCategoryIds,
        approve_relations: state.approvedRelationIds,
      }
      if (state.action === 'merge' && item?.duplicate_of) {
        decision.merge_into = item.duplicate_of.id
      }
      return decision
    })

    commitMutation.mutate(
      { preview_id: preview.preview_id, decisions: decisionList },
      {
        onSuccess: (data) => {
          setResult(data)
          // 오류로 자동 제외된 항목 수는 commit 응답에 없어 preview 요약에서 채출
          setErroredCount(preview.summary.error)
          setStep('result')
        },
        onError: (e) => {
          if (e instanceof ApiError && e.status === 409) {
            setExpiredNotice('미리보기가 만료되었습니다 (1시간). 파일을 다시 선택해 반입을 시작하세요.')
            setStep('select')
            setPreview(null)
            setDecisions({})
          }
        },
      },
    )
  }

  return (
    <div className="mx-auto max-w-4xl p-4">
      <h1 className="mb-1 text-xl font-semibold text-primary">반입</h1>
      <p className="mb-4 text-sm text-muted">
        Claude Code로 변환한 기출 JSON을 미리보고 검증한 뒤 DB에 적재합니다.
      </p>

      <StepIndicator step={step} />

      {expiredNotice && (
        <div className="mb-4 rounded border border-warning bg-accent-soft px-3 py-2 text-sm text-primary">
          {expiredNotice}
        </div>
      )}

      {step === 'select' && (
        <SelectStep
          jsonFile={jsonFile}
          sourceFile={sourceFile}
          onJsonFileChange={setJsonFile}
          onSourceFileChange={setSourceFile}
          onSubmit={handlePreviewSubmit}
          submitting={previewMutation.isPending}
          errorMessage={previewMutation.isError ? errMsg(previewMutation.error, '미리보기에 실패했습니다.') : null}
        />
      )}

      {step === 'preview' && preview && (
        <PreviewStep
          preview={preview}
          decisions={decisions}
          onUpdateDecision={updateDecision}
          onSkipAll={skipAll}
          onBack={() => setStep('select')}
          onCommit={handleCommit}
          committing={commitMutation.isPending}
          commitError={
            commitMutation.isError && !(commitMutation.error instanceof ApiError && commitMutation.error.status === 409)
              ? errMsg(commitMutation.error, '반입 실행에 실패했습니다.')
              : null
          }
        />
      )}

      {step === 'result' && result && (
        <ResultStep result={result} erroredCount={erroredCount} onRestart={resetWizard} />
      )}
    </div>
  )
}

function StepIndicator({ step }: { step: WizardStep }) {
  const steps: { key: WizardStep; label: string }[] = [
    { key: 'select', label: '① 파일 선택' },
    { key: 'preview', label: '② 미리보기' },
    { key: 'result', label: '③ 결과' },
  ]
  return (
    <div className="mb-4 flex gap-2 text-sm">
      {steps.map((s) => (
        <span
          key={s.key}
          className={`rounded-full px-3 py-1 ${
            s.key === step ? 'bg-accent text-on-accent' : 'bg-surface text-muted'
          }`}
        >
          {s.label}
        </span>
      ))}
    </div>
  )
}

interface SelectStepProps {
  jsonFile: File | null
  sourceFile: File | null
  onJsonFileChange: (f: File | null) => void
  onSourceFileChange: (f: File | null) => void
  onSubmit: () => void
  submitting: boolean
  errorMessage: string | null
}

function SelectStep({
  jsonFile,
  sourceFile,
  onJsonFileChange,
  onSourceFileChange,
  onSubmit,
  submitting,
  errorMessage,
}: SelectStepProps) {
  function handleJson(e: ChangeEvent<HTMLInputElement>) {
    onJsonFileChange(e.target.files?.[0] ?? null)
  }
  function handleSource(e: ChangeEvent<HTMLInputElement>) {
    onSourceFileChange(e.target.files?.[0] ?? null)
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
      <label className="flex flex-col gap-1 text-sm">
        반입 JSON 파일 (필수)
        <input
          type="file"
          accept="application/json,.json"
          onChange={handleJson}
          className="rounded border border-border bg-bg px-3 py-2 text-sm text-primary"
        />
        {jsonFile && <span className="text-xs text-muted">선택됨: {jsonFile.name}</span>}
      </label>

      <label className="flex flex-col gap-1 text-sm">
        원본 파일 (선택 — 반입 시 sources/에 함께 보관)
        <input
          type="file"
          onChange={handleSource}
          className="rounded border border-border bg-bg px-3 py-2 text-sm text-primary"
        />
        {sourceFile && <span className="text-xs text-muted">선택됨: {sourceFile.name}</span>}
      </label>

      {errorMessage && <p className="text-sm text-wrong">{errorMessage}</p>}

      <div className="flex justify-end">
        <button
          type="button"
          disabled={!jsonFile || submitting}
          onClick={onSubmit}
          className="rounded bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? '미리보기 생성 중…' : '다음: 미리보기'}
        </button>
      </div>
    </div>
  )
}

interface PreviewStepProps {
  preview: ImportPreviewResponse
  decisions: Record<number, ItemDecisionState>
  onUpdateDecision: (index: number, patch: Partial<ItemDecisionState>) => void
  onSkipAll: () => void
  onBack: () => void
  onCommit: () => void
  committing: boolean
  commitError: string | null
}

function PreviewStep({
  preview,
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
      {source.duplicate_source && (
        <div className="rounded border border-warning bg-accent-soft px-3 py-2 text-sm text-primary">
          같은 원본이 이미 반입된 적 있습니다 ("{source.filename}"). 내용이 중복 의심으로 잡힐 수 있습니다.
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface p-3 text-sm">
        <div className="flex flex-wrap gap-3">
          <span className="text-primary">전체 {summary.total}</span>
          <span className="text-correct">정상 {summary.ok}</span>
          <span className="text-warning">중복 의심 {summary.duplicate_suspect}</span>
          <span className="text-wrong">오류 {summary.error}</span>
        </div>
        <button
          type="button"
          onClick={onSkipAll}
          className="rounded border border-border px-3 py-1.5 text-xs text-primary hover:bg-bg"
        >
          전체 건너뛰기
        </button>
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

interface ItemRowProps {
  item: ImportItem
  state: ItemDecisionState | undefined
  onUpdateDecision: (index: number, patch: Partial<ItemDecisionState>) => void
}

function ItemRow({ item, state, onUpdateDecision }: ItemRowProps) {
  const isSkipped = state?.action === 'skip'

  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <StatusBadge status={item.status} />
        <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent">
          {TYPE_LABEL[item.type] ?? item.type}
        </span>
        <span className="text-sm font-medium text-primary">
          #{item.index} {item.title}
        </span>
      </div>

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

          {item.suggest_categories.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-muted">분류 제안</p>
              <div className="flex flex-wrap gap-2">
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
                    </label>
                  )
                })}
              </div>
            </div>
          )}

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

function ResultStep({
  result,
  erroredCount,
  onRestart,
}: {
  result: ImportCommitResult
  erroredCount: number
  onRestart: () => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryTile label="생성" value={result.created} />
        <SummaryTile label="병합" value={result.merged} />
        <SummaryTile label="건너뜀" value={result.skipped} />
        <SummaryTile label="오류(제외)" value={erroredCount} />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface p-3">
          <h2 className="mb-1 text-sm font-semibold text-primary">생성된 분류</h2>
          {result.categories_created.length === 0 ? (
            <p className="text-xs text-muted">없음</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {result.categories_created.map((path) => (
                <li key={path} className="text-xs text-primary">
                  {path}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-lg border border-border bg-surface p-3">
          <h2 className="mb-1 text-sm font-semibold text-primary">생성된 관계</h2>
          <p className="text-xs text-primary">{result.relations_created}건</p>
        </div>
      </div>

      {result.new_documents.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-3">
          <h2 className="mb-2 text-sm font-semibold text-primary">새로 생성된 문서</h2>
          <ul className="flex flex-col gap-1">
            {result.new_documents.map((doc) => (
              <li key={doc.id}>
                <Link to={`/docs/${doc.id}`} className="text-sm text-accent hover:underline">
                  {doc.doc_no} — {doc.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <button
          type="button"
          onClick={onRestart}
          className="rounded border border-border px-4 py-2 text-sm text-primary hover:bg-bg"
        >
          새로 반입하기
        </button>
      </div>
    </div>
  )
}

function SummaryTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3 text-center">
      <p className="text-2xl font-semibold text-primary">{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  )
}
