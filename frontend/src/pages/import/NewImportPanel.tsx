import { useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useImportPreview } from '../../api/import'
import { importRunKeys } from '../../api/importRuns'
import { MAX_START_BATCH, useStartImportRuns } from '../../hooks/useImportRuns'
import type { StartFailure } from '../../hooks/useImportRuns'
import LlmLimitBanner from '../../components/LlmLimitBanner'
import LlmErrorInfoView from '../../components/LlmErrorInfo'
import EngineSelectCollapsible from '../../components/EngineSelectCollapsible'
import FetchImportWizard from '../../components/FetchImportWizard'
import AnswerKeyImportWizard from '../../components/AnswerKeyImportWizard'
import SplitImportWizard from '../../components/SplitImportWizard'
import type { SplitInitialSource } from '../../components/SplitImportWizard'
import CategoryPathField, { categoryPathError, normalizeCategoryPath } from '../../components/CategoryPathField'
import { errMsg } from './importShared'
import type { ImportPreviewResponse, LlmEngine, SplitEnqueueJobItem } from '../../api/types'

// [새 반입] 패널(설계 §5.9 [S56] D) — stage-55 소스 세그먼트 4 + 시작 패널(규약 A~F)을 접힘/펼침으로 품는다.
// 접힘/펼침·시작 성공 후 접기·새 카드 강조는 ImportPage 소관이고, 이 컴포넌트는 내용(내부 무변)만 담당한다.
// 'convert' = 원본 파일 업로드 자동 변환(다중 선택 -> 순차 투입) · 'url' = URL 반입(§4.11) ·
// 'fetch' = 사이트에서 가져오기(§5.9 S10, 자체 4단계 서브플로) · 'json' = 변환된 JSON 직접 선택 ·
// 'answer_key' = 답지·해설지 반입(§4.20 ①, F44) · 'split_import'(S23, §4.25, F49) = 대용량 분할 위저드 —
// 상시 메뉴 없음, run 카드의 [분할 반입] 또는 작업 센터 딥링크(?mode=split_import)로만 진입한다.
export type EntryMode = 'json' | 'convert' | 'url' | 'fetch' | 'answer_key' | 'split_import'

// 분할 재진입 컨텍스트 — 종전 state 6~8개를 run 1건의 split_id·source_url·category_path로 대체한다.
export interface SplitContext {
  runId: number | null
  resumeSplitId: string | null
  initialSource: SplitInitialSource | null
  commonPath: string | null
}

interface NewImportPanelProps {
  mode: EntryMode
  onModeChange: (mode: EntryMode) => void
  // [다시 시도] 등으로 패널을 열 때 덧붙이는 안내 1줄(서버 문구가 아닌 프론트 안내).
  notice: string | null
  // 변환 대기·진행 중 run 수 — 한 번에 걸 수 있는 배치 한도 계산용(대량 투입 한도 사고 방지).
  inProgressCount: number
  split: SplitContext | null
  onLeaveAnswerKey: () => void
  // 시작 성공(응답 run_id 수집) -> 패널 접힘 + 새 카드 강조는 호출부 책임.
  onStarted: (runIds: number[]) => void
  // 미리보기 ②로 합류(변환된 JSON 직접 선택 · 사이트 반입 완료).
  onPreview: (data: ImportPreviewResponse, fromJob: boolean, notes: string[]) => void
  onSplitCancel: () => void
  onSplitEnqueued: (jobs: SplitEnqueueJobItem[], splitId: string, categoryPaths?: Record<string, string>) => void
  onSplitStarted: (splitId: string, runId?: number) => void
  onSplitExpired: () => void
}

export default function NewImportPanel({
  mode,
  onModeChange,
  notice,
  inProgressCount,
  split,
  onLeaveAnswerKey,
  onStarted,
  onPreview,
  onSplitCancel,
  onSplitEnqueued,
  onSplitStarted,
  onSplitExpired,
}: NewImportPanelProps) {
  const qc = useQueryClient()
  const [jsonFile, setJsonFile] = useState<File | null>(null)
  const [sourceFile, setSourceFile] = useState<File | null>(null)
  const previewMutation = useImportPreview()

  function handlePreviewSubmit() {
    if (!jsonFile) return
    previewMutation.mutate(
      { jsonFile, sourceFile },
      {
        onSuccess: (data) => {
          // 서버가 json_upload run(review_ready)을 신설한다 — 목록을 새로 읽는다.
          qc.invalidateQueries({ queryKey: importRunKeys.all })
          onPreview(data, false, [])
        },
      },
    )
  }

  return (
    <div className="mb-4 flex flex-col">
      {notice && (
        <div className="mb-3 rounded border border-warning bg-accent-soft px-3 py-2 text-sm text-primary">{notice}</div>
      )}

      {mode !== 'answer_key' && mode !== 'split_import' && (
        <div className="mb-3">
          <p className="mb-1 text-xs font-semibold text-muted">새 반입</p>
          <div className="flex flex-nowrap gap-2 overflow-x-auto">
            <ModeTab active={mode === 'convert'} onClick={() => onModeChange('convert')}>
              파일
            </ModeTab>
            <ModeTab active={mode === 'url'} onClick={() => onModeChange('url')}>
              URL
            </ModeTab>
            <ModeTab active={mode === 'fetch'} onClick={() => onModeChange('fetch')}>
              사이트(큐넷)
            </ModeTab>
            <ModeTab active={mode === 'json'} onClick={() => onModeChange('json')}>
              변환된 JSON
            </ModeTab>
          </div>
        </div>
      )}
      {mode === 'answer_key' && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-primary">답지·해설지 반입</p>
          <button type="button" onClick={onLeaveAnswerKey} className="text-xs text-accent hover:underline">
            ← 새 반입으로
          </button>
        </div>
      )}

      {mode === 'json' && (
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
      {(mode === 'convert' || mode === 'url') && (
        <StartConvertPanel
          sourceKind={mode === 'url' ? 'url' : 'file'}
          pendingCount={inProgressCount}
          onStarted={onStarted}
        />
      )}
      {mode === 'fetch' && (
        <FetchImportWizard
          onPreviewReady={(data, notes) => onPreview(data, true, notes ?? [])}
          onFallbackToUrl={() => onModeChange('url')}
          onFallbackToFile={() => onModeChange('convert')}
          onRunStarted={(runId) => onStarted(runId != null ? [runId] : [])}
        />
      )}
      {mode === 'answer_key' && (
        <>
          <p className="mb-3 text-sm text-muted">
            이미 반입된 문항 중 정답·해설이 빈 곳을 답지·해설지 파일로 채웁니다 — 기존 값은
            덮어쓰지 않습니다(빈 필드만 병합).
          </p>
          <AnswerKeyImportWizard />
        </>
      )}
      {mode === 'split_import' && (
        <SplitImportWizard
          // stage-reviewer 표적 확인([예방 1줄]) — resumeSplitId만 바뀌는 딥링크 재진입에서 위저드 내부
          // useState 초기값이 갱신되지 않는 사고를 예방하기 위해 split_id·run별로 강제 리마운트한다.
          key={`${split?.resumeSplitId ?? 'new'}:${split?.runId ?? ''}`}
          initialSource={split?.initialSource ?? null}
          resumeSplitId={split?.resumeSplitId ?? null}
          initialCommonPath={split?.commonPath ?? null}
          runId={split?.runId ?? null}
          onCancel={onSplitCancel}
          onEnqueued={onSplitEnqueued}
          onSplitStarted={onSplitStarted}
          onSplitExpired={onSplitExpired}
        />
      )}
    </div>
  )
}

function ModeTab({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-3 py-1.5 text-sm font-medium ${
        active ? 'bg-accent text-on-accent' : 'bg-surface text-muted hover:bg-bg'
      }`}
    >
      {children}
    </button>
  )
}

interface StartConvertPanelProps {
  sourceKind: 'file' | 'url'
  pendingCount: number
  onStarted: (runIds: number[]) => void
}

// 설계 §5.9(S6·S8·S13) — "원본 파일로 시작"(F40-②: **다중 선택 → 순차 투입**) / "URL로 시작".
// 서버 워커는 동시 1개라 큐잉일 뿐 병렬 실행이 아니다. S56부터 시작마다 서버가 반입 건(run)을 만든다. 시작 전 한도 배너(§4.11)를
// 노출하고, 분류 경로(F40-③)는 파일·URL 공통 접이식 패널로 받는다.
function StartConvertPanel({ sourceKind, pendingCount, onStarted }: StartConvertPanelProps) {
  const { starting, startFiles, startUrl } = useStartImportRuns()
  const [failures, setFailures] = useState<StartFailure[]>([])
  const [files, setFiles] = useState<File[]>([])
  const [url, setUrl] = useState('')
  const [commonPath, setCommonPath] = useState('')
  // 파일별 마지막 칸(회차 등) — 공통 상위 경로 뒤에 붙는다(§5.9 F40-③).
  const [perFileSuffix, setPerFileSuffix] = useState<Record<string, string>>({})
  const [selectNotice, setSelectNotice] = useState<string | null>(null)
  // S21(설계 §4.23·§5.9 ①) — 시작 화면 engine 선택. 이번 선택분(배치) 전체에 같이 적용된다.
  const [engine, setEngine] = useState<LlmEngine>('auto')
  // S22(설계 §4.24 ④·⑤·§5.9, F48) — 요청 단위 모델 오버라이드. 미선택(null) = 설정값.
  const [model, setModel] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleFiles(e: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? [])
    // 대량 투입으로 LLM 한도를 한 번에 태우는 사고 방지(§5.9 · 리스크 6) — 이미 대기 중인
    // 항목까지 합쳐 10개를 넘지 않게 한다.
    if (picked.length + pendingCount > MAX_START_BATCH) {
      setSelectNotice(
        pendingCount > 0
          ? `진행 중 ${pendingCount}건이 있어 ${Math.max(MAX_START_BATCH - pendingCount, 0)}개까지 더 걸 수 있습니다 (선택 ${picked.length}개).`
          : `한 번에 최대 ${MAX_START_BATCH}개까지 걸 수 있습니다 (선택 ${picked.length}개). 나눠서 올려 주세요.`,
      )
      setFiles([])
      return
    }
    setSelectNotice(null)
    setFiles(picked)
  }

  function pathForFile(name: string): string {
    const suffix = perFileSuffix[name] ?? ''
    return normalizeCategoryPath([commonPath, suffix].filter(Boolean).join('/'))
  }

  const pathError =
    categoryPathError(commonPath) ??
    files.map((f) => categoryPathError(pathForFile(f.name))).find((e) => e != null) ??
    null

  const canStart =
    !starting && pathError == null && (sourceKind === 'url' ? url.trim().length > 0 : files.length > 0)

  async function handleStart() {
    if (!canStart) return
    if (sourceKind === 'url') {
      const value = url.trim()
      setUrl('')
      setFailures([])
      const outcome = await startUrl(value, commonPath || null, { engine, model: model ?? undefined })
      setFailures(outcome.failures)
      if (outcome.failures.length === 0) onStarted(outcome.runIds)
      return
    }
    const inputs = files.map((file) => ({ file, categoryPath: pathForFile(file.name) || null }))
    setFiles([])
    setPerFileSuffix({})
    if (fileInputRef.current) fileInputRef.current.value = ''
    setFailures([])
    const outcome = await startFiles(inputs, { engine, model: model ?? undefined })
    setFailures(outcome.failures)
    // 일부만 실패해도 시작된 건이 있으면 목록으로 합류(실패 안내는 패널에 남는다).
    if (outcome.runIds.length > 0 || outcome.failures.length === 0) onStarted(outcome.runIds)
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
      <LlmLimitBanner />

      <p className="text-sm text-muted">
        {sourceKind === 'file'
          ? `PDF·이미지(png/jpg 등)·docx·xlsx·md·txt·html·xml·csv 등 기출 원본 파일을 올리면 LLM이 반입 JSON으로 변환한 뒤 미리보기 단계로 이어집니다. 여러 파일(최대 ${MAX_START_BATCH}개)을 한 번에 걸어두면 순서대로 변환되고, 끝난 것부터 검토할 수 있습니다.`
          : '공개 기출 자료 URL을 입력하면 서버가 다운로드부터 변환까지 처리합니다 (사설·로컬 네트워크 주소는 거부됩니다).'}
      </p>

      {sourceKind === 'file' ? (
        <label className="flex flex-col gap-1 text-sm text-primary">
          원본 파일 (여러 개 선택 가능)
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.md,.markdown,.txt,.html,.htm,.xhtml,.xml,.csv,.docx,.xlsx"
            onChange={handleFiles}
            className="rounded border border-border bg-bg px-3 py-2 text-sm text-primary"
          />
          {files.length > 0 && <span className="text-xs text-muted">선택됨: {files.length}개</span>}
          {selectNotice && <span className="text-xs text-warning">{selectNotice}</span>}
        </label>
      ) : (
        <label className="flex flex-col gap-1 text-sm text-primary">
          자료 URL
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/2023-기출.pdf"
            className="rounded border border-border bg-bg px-3 py-2 text-sm text-primary"
          />
        </label>
      )}

      <CategoryPathField value={commonPath} onChange={setCommonPath} sharedNotice={files.length > 1} />

      <div>
        <EngineSelectCollapsible value={engine} onChange={setEngine} modelValue={model} onModelChange={setModel} />
      </div>

      {sourceKind === 'file' && files.length > 1 && (
        <div className="flex flex-col gap-2 rounded border border-border bg-bg p-3">
          <p className="text-xs font-semibold text-muted">
            파일별 회차 (선택) — 위에서 정한 상위 경로가 모든 파일에 같이 적용됩니다.
          </p>
          {files.map((file) => (
            <div key={file.name} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
              <span className="min-w-0 flex-1 break-all text-xs text-primary">{file.name}</span>
              <input
                type="text"
                value={perFileSuffix[file.name] ?? ''}
                onChange={(e) => setPerFileSuffix((prev) => ({ ...prev, [file.name]: e.target.value }))}
                placeholder="2022년 2회"
                className="w-full rounded border border-border bg-surface px-2 py-1 text-xs text-primary outline-none focus:border-accent sm:w-40"
              />
              <span className="min-w-0 flex-1 break-all text-[11px] text-muted">
                {pathForFile(file.name) || '분류 경로 지정 안 함'}
              </span>
            </div>
          ))}
        </div>
      )}

      {pathError && <p className="text-sm text-warning">{pathError}</p>}

      {failures.length > 0 && (
        <div className="flex flex-col gap-2">
          {failures.map((f, i) => (
            <div key={i} className="flex flex-col gap-1">
              <p className="break-all text-xs text-muted">{f.name}</p>
              {f.errorInfo ? <LlmErrorInfoView errorInfo={f.errorInfo} /> : <p className="text-sm text-wrong">{f.message}</p>}
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          disabled={!canStart}
          onClick={handleStart}
          className="rounded bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
        >
          {starting
            ? '시작 중…'
            : sourceKind === 'file' && files.length > 1
              ? `${files.length}개 변환 시작`
              : '변환 시작'}
        </button>
      </div>
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
