import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useFetchAdapters, useFetchCerts, useFetchExams, useFetchImport } from '../api/fetch'
import { isJobLost, jobUnavailable, useConvertJob, useConvertedPreview } from '../api/convert'
import { ApiError } from '../api/client'
import { clearStoredConvertJob, getStoredConvertJob, setStoredConvertJob } from '../utils/convertJob'
import LlmJobProgress from './LlmJobProgress'
import LlmErrorInfoView from './LlmErrorInfo'
import LlmLimitBanner from './LlmLimitBanner'
import EngineSelect from './EngineSelect'
import Stepper from './Stepper'
import type { StepperStep } from './Stepper'
import type {
  FetchAdapterId,
  FetchCertResult,
  FetchExamItem,
  ImportPreviewResponse,
  LlmEngine,
  LlmErrorInfo,
} from '../api/types'

// 설계 §5.9(S10, F35 2단계) — 반입 화면 [사이트에서 가져오기] 4단계 서브플로. 신규는 수집기
// (어댑터)뿐 — LLM 정리·미리보기·중복 감지·분류 자동 생성·승인 반입은 전부 기존 convert 잡 큐
// (§4.10·§4.11)와 import preview/commit(§4.3)을 재사용한다(§4.13 원칙).
type FetchSubStep = 'cert' | 'exam' | 'confirm' | 'execute'

const SUB_STEP_ORDER: FetchSubStep[] = ['cert', 'exam', 'confirm', 'execute']
const SUB_STEP_LABELS: Record<FetchSubStep, string> = {
  cert: '자격증',
  exam: '회차',
  confirm: '확인',
  execute: '실행',
}

// 어댑터 목록 조회 실패/로딩 중에도 배지를 보여주기 위한 폴백 이름.
// S13: 등록 어댑터는 큐넷 하나뿐(사설 사이트 어댑터 제거, 설계 §4.13, 계획서 §14 F35-2).
const ADAPTER_FALLBACK_NAME: Record<FetchAdapterId, string> = {
  qnet: '큐넷',
}

function errMsg(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback
}

// 한도 기억(remembered-limit) 사전 차단 — convert.ts ConvertStep과 동일 판별(설계 §4.11).
function extractLlmErrorInfo(error: unknown): LlmErrorInfo | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null
  const detail = error.detail
  if (detail && typeof detail === 'object' && 'kind' in detail) {
    return detail as LlmErrorInfo
  }
  return null
}

interface FetchImportWizardProps {
  // notes(S14, §4.13) — 잡 성공 결과에 덧붙는 사람이 읽는 문장(예: "ZIP도 함께 저장했습니다").
  // 서버가 문구를 완성해 내려주므로 그대로 전달만 한다(가공 금지).
  onPreviewReady: (data: ImportPreviewResponse, notes?: string[]) => void
  // parse_failed 대안 버튼 · "준비 중" 안내 대안 버튼 — 다른 진입 모드(URL 반입, §5.9)로 전환.
  onFallbackToUrl: () => void
  // "준비 중" 안내 대안 버튼 — 원본 파일 반입(자동 변환) 모드로 전환.
  onFallbackToFile: () => void
}

export default function FetchImportWizard({ onPreviewReady, onFallbackToUrl, onFallbackToFile }: FetchImportWizardProps) {
  const stored = getStoredConvertJob()
  const resumed = stored?.sourceKind === 'fetch' ? stored : null

  const [subStep, setSubStep] = useState<FetchSubStep>(resumed ? 'execute' : 'cert')
  const [searchInput, setSearchInput] = useState('')
  const [committedQuery, setCommittedQuery] = useState('')
  const [selectedCert, setSelectedCert] = useState<FetchCertResult | null>(null)
  const [examList, setExamList] = useState<FetchExamItem[] | null>(null)
  // 안내문 게시물 토글(S14, §4.13·§5.9 실측 6) — 기본 숨김. fullExamList는 include_notices:true로
  // 받은 전체 목록(안내문 포함) 캐시본 — 한 번만 받아 두면 토글은 재조회 없이 로컬 전환된다.
  const [fullExamList, setFullExamList] = useState<FetchExamItem[] | null>(null)
  const [showNotices, setShowNotices] = useState(false)
  // 선택 identity·React key는 exam_ref(어댑터 기준 유일 참조, 예: qnet=artlSeq)를 쓴다 —
  // exam_key는 S14부터 'YYYY'(연도만) 같은 식별 불가 폴백을 가질 수 있어 같은 종목·같은 연도
  // 게시물이 2건이면 충돌한다(2026-07-27 검토 지적 — 잠재 오반입 버그).
  const [selectedExamRef, setSelectedExamRef] = useState<string | null>(null)
  const [engine, setEngine] = useState<LlmEngine>('auto')
  const [agreed, setAgreed] = useState(false)
  const [jobId, setJobId] = useState<string | null>(resumed?.jobId ?? null)

  const adaptersQuery = useFetchAdapters()
  const certsQuery = useFetchCerts(committedQuery)
  const examsMutation = useFetchExams()
  // 안내문 포함 목록 전용 병행 조회 — examsMutation과 상태를 분리해 두 요청의 isPending/isError가
  // 서로 뒤섞이지 않게 한다(§5.9 "안내문 N건 보기" 토글).
  const noticesMutation = useFetchExams()
  const importMutation = useFetchImport()
  const jobQuery = useConvertJob(jobId)
  const previewFetch = useConvertedPreview(
    jobQuery.data?.status === 'done' ? (jobQuery.data.result_preview_id ?? null) : null,
  )

  useEffect(() => {
    if (previewFetch.data) {
      clearStoredConvertJob()
      onPreviewReady(previewFetch.data, jobQuery.data?.notes)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewFetch.data])

  // 잡이 사라진 것이 확인되면 저장된 기록을 즉시 지운다 — 화면의 안내는 이번 방문에서
  // 그대로 보이되(무슨 일이 있었는지 알려야 하므로), 다시 열 때마다 죽은 잡을 조회해
  // 같은 안내가 반복되지는 않게 한다.
  useEffect(() => {
    if (jobId != null && isJobLost(jobQuery)) clearStoredConvertJob()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, jobQuery.isError])

  function adapterName(id: FetchAdapterId): string {
    return adaptersQuery.data?.find((a) => a.id === id)?.name ?? ADAPTER_FALLBACK_NAME[id]
  }

  function handleSearch() {
    setSelectedCert(null)
    setExamList(null)
    setSelectedExamRef(null)
    setCommittedQuery(searchInput.trim())
  }

  // 안내문 포함 목록 조회 — selectCert 최초 호출과 실패 후 [다시 시도] 양쪽에서 재사용한다.
  function fetchNotices(cert: FetchCertResult) {
    noticesMutation.mutate({ sources: cert.sources, include_notices: true }, { onSuccess: setFullExamList })
  }

  function selectCert(cert: FetchCertResult) {
    setSelectedCert(cert)
    setExamList(null)
    setFullExamList(null)
    setShowNotices(false)
    setSelectedExamRef(null)
    examsMutation.mutate(
      { sources: cert.sources },
      {
        onSuccess: (data) => {
          setExamList(data)
          setSubStep('exam')
        },
      },
    )
    // 안내문 건수를 미리 확보(§5.9 "N건 보기" 표기용) — 같은 24h 캐시에서 파생되므로 추가 비용
    // 없음. 화면은 계속 기본(숨김) 목록을 보여주고, 이 응답이 도착하면 토글에 건수가 붙는다.
    fetchNotices(cert)
  }

  // 안내문 토글 — 켤 때는 fullExamList가 있어야만(로딩 실패 중엔 무동작 방지, 결함1) 의미가
  // 있고, 끌 때 지금 선택한 항목이 기본(숨김) 목록에 없으면(=안내문 전용 항목) 선택을 조용히
  // 들고 있지 않도록 명시적으로 해제한다(결함2 — 상태 정합).
  function toggleShowNotices() {
    setShowNotices((prev) => {
      const next = !prev
      if (!next && selectedExamRef && !(examList ?? []).some((e) => e.exam_ref === selectedExamRef)) {
        setSelectedExamRef(null)
      }
      return next
    })
  }

  // 안내문 포함(fullExamList)이 도착했으면 그것을, 아니면 기본(숨김) 목록을 보여준다 — 기본 목록은
  // 서버가 이미 안내문을 제외해 보내므로(include_notices 기본 false) 별도 필터가 필요 없다.
  const noticeCount = fullExamList ? fullExamList.filter((e) => e.is_notice).length : null
  const visibleExams = showNotices && fullExamList ? fullExamList : (examList ?? [])
  const selectedExam = visibleExams.find((e) => e.exam_ref === selectedExamRef) ?? null

  function startImport(opts?: { adapterOverride?: FetchAdapterId; engineOverride?: LlmEngine }) {
    if (!selectedExam || !selectedCert) return
    const adapter = opts?.adapterOverride ?? selectedExam.adapter
    const source = selectedCert.sources.find((s) => s.adapter === adapter)
    if (!source) return
    // exam_ref는 어댑터 기준 참조값(예: qnet=URL) — 대상 어댑터의 값은 refs[adapter]에서 구한다
    // (일반 실행 경로는 selectedExam.exam_ref === refs[selectedExam.adapter]로 동일값, 동작 불변).
    // S13: 어댑터가 하나뿐이라 also_on 재시도(adapterOverride)는 사문화됐지만 계약은 유지한다.
    const examRef = opts?.adapterOverride ? selectedExam.refs[adapter] : selectedExam.exam_ref
    if (!examRef) return
    importMutation.mutate(
      {
        adapter,
        cert_ref: source.cert_ref,
        exam_ref: examRef,
        engine: opts?.engineOverride ?? engine,
        // §4.13 — 목록 응답의 exam_key를 그대로 실행 요청에 실어 보낸다(S13: 단일 어댑터라
        // 사실상 항등 전달이지만 계약·호출 형태는 유지).
        exam_key: selectedExam.exam_key,
      },
      {
        onSuccess: (data) => {
          setJobId(data.job_id)
          setStoredConvertJob({ jobId: data.job_id, sourceKind: 'fetch', fetchLabel: selectedExam.label })
          setSubStep('execute')
        },
      },
    )
  }

  function resetAll() {
    clearStoredConvertJob()
    setSubStep('cert')
    setSearchInput('')
    setCommittedQuery('')
    setSelectedCert(null)
    setExamList(null)
    setFullExamList(null)
    setShowNotices(false)
    setSelectedExamRef(null)
    setEngine('auto')
    setAgreed(false)
    setJobId(null)
  }

  function handleStepNavigate(target: FetchSubStep) {
    const currentIndex = SUB_STEP_ORDER.indexOf(subStep)
    const targetIndex = SUB_STEP_ORDER.indexOf(target)
    if (targetIndex >= currentIndex) return // 지나온(done) 단계만 클릭 가능
    setSubStep(target)
  }

  const steps: StepperStep[] = SUB_STEP_ORDER.map((key, i) => {
    const currentIndex = SUB_STEP_ORDER.indexOf(subStep)
    return {
      key,
      label: SUB_STEP_LABELS[key],
      status: i < currentIndex ? 'done' : i === currentIndex ? 'current' : 'future',
    }
  })

  // 잡 소실(404 — 서버 재시작·TTL 1시간 만료)이면 진행 표시를 멈춘다. 이 검사가 없으면
  // 폴링이 영영 데이터를 못 받아 `running`이 참으로 남고 "처리 준비 중…"에서 멈춘다.
  const unavailable = jobId != null ? jobUnavailable(jobQuery) : null
  const running = jobId != null && unavailable == null && (jobQuery.data == null || jobQuery.data.status === 'running')
  const jobFailed = jobQuery.data?.status === 'error'
  const done = jobQuery.data?.status === 'done'
  const previewFetchFailed = done && (previewFetch.isError || !jobQuery.data?.result_preview_id)
  const previewExpired = previewFetch.isError && previewFetch.error instanceof ApiError && previewFetch.error.status === 404
  const startErrorInfo = importMutation.isError ? extractLlmErrorInfo(importMutation.error) : null
  const jobErrorInfo = jobQuery.data?.error_info
  const isParseFailed = jobFailed && jobErrorInfo?.kind === 'parse_failed'
  // 재시도 가능 조건: also_on에 있고(다른 사이트에도 회차 존재) + 해당 사이트의 cert_ref를
  // 알고 있고(cert.sources) + refs에 그 어댑터용 exam_ref가 실제로 내려온 경우만(stage-reviewer
  // 지적 — also_on만으로 판단하면 refs 누락 시에도 버튼이 떠 재시도가 실패한다).
  const altAdapter =
    selectedExam?.also_on.find(
      (a) => selectedCert?.sources.some((s) => s.adapter === a) && Boolean(selectedExam.refs[a]),
    ) ?? null

  // S13 종료 시점: 등록 어댑터가 qnet 스텁 1개(available:false)뿐이라 검색해도 항상 빈 결과다.
  // 자동 수집 서브플로(①~④) 자체는 손대지 않고, 아직 시작 전(cert 단계)이면 "준비 중" 안내 +
  // 대안 버튼으로 대체한다(빈 화면·오류 없이, 설계 §5.9). 이미 재개된 잡(execute 단계)은 그대로 둔다.
  const allAdaptersUnavailable = adaptersQuery.isSuccess && adaptersQuery.data.every((a) => !a.available)
  // S14(§5.9): unavailable의 원인이 qnet 서비스키 미등록이면 설계 지정 문구 + 설정 링크로
  // 갈아끼운다. 그 외 사유(장애 등, key_registered가 true이거나 필드 자체가 없는 구버전 응답)는
  // 기존 "준비 중" 문구를 유지한다.
  const qnetKeyMissing = adaptersQuery.data?.[0]?.key_registered === false
  if (subStep === 'cert' && allAdaptersUnavailable) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <p className="text-sm font-medium text-primary">사이트에서 가져오기 — 준비 중</p>
        {qnetKeyMissing ? (
          <p className="text-sm text-muted">
            설정 &gt; 데이터에서 공공데이터포털 서비스키를 등록하세요.{' '}
            <Link to="/settings" className="text-accent hover:underline">
              설정으로 이동
            </Link>
          </p>
        ) : (
          <p className="text-sm text-muted">
            지금은 자동으로 가져올 수 있는 사이트가 없습니다. 회차 파일이나 URL로 반입해 주세요.
          </p>
        )}
        {adaptersQuery.data[0]?.notice && <p className="text-xs text-muted">{adaptersQuery.data[0].notice}</p>}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onFallbackToUrl}
            className="rounded border border-border px-3 py-1.5 text-sm text-primary hover:bg-bg"
          >
            URL로 반입
          </button>
          <button
            type="button"
            onClick={onFallbackToFile}
            className="rounded border border-border px-3 py-1.5 text-sm text-primary hover:bg-bg"
          >
            파일로 반입
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
      <Stepper steps={steps} size="sm" onStepClick={(i) => handleStepNavigate(SUB_STEP_ORDER[i])} />

      {subStep === 'cert' && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">자격증 이름으로 검색하면 등록된 사이트에서 회차를 찾아옵니다.</p>
          {(adaptersQuery.data ?? []).some((a) => !a.available) && (
            <div className="rounded border border-warning bg-accent-soft px-3 py-2 text-xs text-primary">
              {(adaptersQuery.data ?? [])
                .filter((a) => !a.available)
                .map((a) => (
                  <p key={a.id}>
                    {a.name || ADAPTER_FALLBACK_NAME[a.id]}: 지금은 이용할 수 없습니다 ({a.notice})
                  </p>
                ))}
            </div>
          )}
          {/* 커버리지 한계 문구(§4.13·§5.9 실측 5, 리스크 1) — notice는 등록 여부와 무관하게
              항상 응답에 실려 온다("응답 메타 그대로 렌더" 원칙 그대로). 등록 후(available:true)
              에도 자격증을 검색하는 이 시점에 캐치가 보여야 "필기·필답형은 없다"는 기대 어긋남을
              막을 수 있다 — 위 미등록 안내 블록과 중복되지 않도록 available 어댑터만 별도로 노출. */}
          {(adaptersQuery.data ?? [])
            .filter((a) => a.available && a.notice)
            .map((a) => (
              <p key={`${a.id}-notice`} className="rounded border border-border bg-surface px-3 py-2 text-xs text-muted">
                {a.notice}
              </p>
            ))}
          <div className="flex gap-2">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="예: 정보처리기사"
              className="flex-1 rounded border border-border bg-bg px-3 py-2 text-sm text-primary outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={handleSearch}
              disabled={!searchInput.trim() || certsQuery.isFetching}
              className="rounded bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
            >
              검색
            </button>
          </div>

          {certsQuery.isFetching && <p className="text-sm text-muted">검색 중…</p>}
          {certsQuery.isError && (
            <p className="text-sm text-wrong">{errMsg(certsQuery.error, '검색에 실패했습니다.')}</p>
          )}
          {examsMutation.isError && (
            <p className="text-sm text-wrong">{errMsg(examsMutation.error, '회차 목록을 불러오지 못했습니다.')}</p>
          )}

          {/* 설계 §5.9(S14 실측 5) 지정 문구 — 오류가 아니라 원인을 알려주는 안내(품질경영기사가
              대표 사례: 이 API는 실기 작업형·도면 공개문제만 다뤄 필기·필답형 종목은 늘 0건). */}
          {certsQuery.data && certsQuery.data.length === 0 && committedQuery && (
            <p className="text-sm text-muted">
              이 종목의 공개문제가 없습니다 — 필기·필답형은 이 API 범위 밖입니다.
            </p>
          )}

          {certsQuery.data && certsQuery.data.length > 0 && (
            <ul className="flex flex-col gap-2">
              {certsQuery.data.map((cert) => (
                <li key={cert.name}>
                  <button
                    type="button"
                    disabled={examsMutation.isPending}
                    onClick={() => selectCert(cert)}
                    className="flex w-full flex-wrap items-center gap-2 rounded border border-border bg-bg px-3 py-2.5 text-left text-sm text-primary hover:bg-surface-raised disabled:opacity-50"
                  >
                    <span className="font-medium">{cert.name}</span>
                    {cert.sources.map((s) => (
                      <span
                        key={s.adapter}
                        className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent"
                      >
                        {adapterName(s.adapter)}
                      </span>
                    ))}
                    {examsMutation.isPending && selectedCert?.name === cert.name && (
                      <span className="text-xs text-muted">회차 목록 불러오는 중…</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {subStep === 'exam' && selectedCert && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-primary">{selectedCert.name}</p>
            <button type="button" onClick={() => setSubStep('cert')} className="text-xs text-muted hover:text-primary">
              ← 다시 검색
            </button>
          </div>

          {visibleExams.length === 0 ? (
            <p className="text-sm text-muted">가져올 수 있는 회차가 없습니다.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {visibleExams.map((exam) => {
                // 채택 어댑터 배지는 exam.adapter(선정 어댑터)를 그대로 렌더 — 특정 어댑터 id를
                // 하드코딩하지 않는다(어댑터 격리 원칙, §5.9). also_on이 있으면(중복 회차) 우선순위
                // 채택 강조 배지, 없으면(단독 회차) 출처 배지만 소표기.
                const adopted = exam.also_on.length > 0
                return (
                  <li key={exam.exam_ref}>
                    <label className="flex w-full cursor-pointer flex-wrap items-center gap-2 rounded border border-border bg-bg px-3 py-2.5 text-sm text-primary hover:bg-surface-raised">
                      <input
                        type="radio"
                        name="fetch-exam"
                        checked={selectedExamRef === exam.exam_ref}
                        onChange={() => setSelectedExamRef(exam.exam_ref)}
                      />
                      {/* 라벨은 서버가 준 그대로 렌더 — exam_key(연도만/식별 불가 포함)를 프론트가
                          가공·재구성하지 않는다(S14 실측 6). */}
                      <span className="font-medium">{exam.label}</span>
                      {exam.is_notice && (
                        <span className="rounded-full bg-warning px-2 py-0.5 text-[11px] font-medium text-on-accent">
                          안내문
                        </span>
                      )}
                      {adopted ? (
                        <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-on-accent">
                          {adapterName(exam.adapter)} 채택
                        </span>
                      ) : (
                        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
                          {adapterName(exam.adapter)}
                        </span>
                      )}
                      {exam.also_on.length > 0 && (
                        <span className="text-[11px] text-muted">
                          ({exam.also_on.map(adapterName).join(', ')}에도 있음)
                        </span>
                      )}
                      {exam.imported && (
                        <span className="rounded-full bg-correct px-2 py-0.5 text-[11px] font-medium text-on-accent">
                          이미 반입됨
                        </span>
                      )}
                      <span className="text-xs text-muted">
                        {exam.question_count != null
                          ? `${exam.question_count}문항`
                          : `약 ${exam.estimate.questions_assumed}문항 (가정)`}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}

          {/* 안내문 게시물 토글(§4.13·§5.9 실측 6) — 회차 목록 하단. 조용한 삭제가 아니라 숨김임을
              알리기 위해 건수를 감추지 않는다(건수를 아직 모르면 "확인 중"으로 과정을 보여준다).
              건수가 확정적으로 0이면(fullExamList 도착 + notice 0건) 토글 자체를 접는다. */}
          {(noticeCount == null || noticeCount > 0) && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={toggleShowNotices}
                // fullExamList가 없으면(아직 로딩 중이거나 조회 실패) 토글을 눌러도 목록이 바뀌지
                // 않으므로 무동작 버튼을 막는다(결함1 — 라벨만 바뀌는 상태 방지).
                disabled={fullExamList == null}
                className="w-fit rounded border border-border px-3 py-1.5 text-xs text-primary hover:bg-bg disabled:opacity-50"
              >
                {showNotices
                  ? '안내문 숨기기'
                  : noticeCount != null
                    ? `안내문 ${noticeCount}건 보기`
                    : noticesMutation.isPending
                      ? '안내문 확인 중…'
                      : '안내문 보기'}
              </button>
              {noticesMutation.isError && fullExamList == null && (
                <span className="flex items-center gap-2 text-xs text-wrong">
                  안내문 목록을 불러오지 못했습니다.
                  <button
                    type="button"
                    onClick={() => selectedCert && fetchNotices(selectedCert)}
                    className="rounded border border-border px-2 py-1 text-primary hover:bg-bg"
                  >
                    다시 시도
                  </button>
                </span>
              )}
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              disabled={!selectedExam}
              onClick={() => setSubStep('confirm')}
              className="rounded bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
            >
              다음: 예상 사용량 확인
            </button>
          </div>
        </div>
      )}

      {subStep === 'confirm' && selectedExam && (
        <div className="flex flex-col gap-4">
          <div className="rounded border border-border bg-bg p-3 text-sm">
            <p className="font-medium text-primary">{selectedExam.label}</p>
            <p className="mt-1 text-xs text-muted">
              예상 문항 수 약 {selectedExam.estimate.questions_assumed}건
              {selectedExam.estimate.assumed && ' (가정치)'} · 예상 입력 토큰 약{' '}
              {selectedExam.estimate.approx_input_tokens.toLocaleString()}
              {selectedExam.estimate.assumed && ' (가정치)'}
            </p>
          </div>

          <LlmLimitBanner />

          <div>
            <p className="mb-1 text-xs font-semibold text-muted">사용 엔진</p>
            <EngineSelect value={engine} onChange={setEngine} />
          </div>

          {/* 고정 고지(설계 §4.13·§5.9) — 항상 표시, 확인 없이 실행 불가 */}
          <div className="rounded border border-warning bg-accent-soft px-3 py-2 text-sm text-primary">
            개인 학습 전용 — 수집물 재배포 금지
          </div>

          <label className="flex items-center gap-2 text-sm text-primary">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            위 내용을 확인했습니다.
          </label>

          {startErrorInfo && <LlmErrorInfoView errorInfo={startErrorInfo} />}
          {importMutation.isError && !startErrorInfo && (
            <p className="text-sm text-wrong">{errMsg(importMutation.error, '수집 시작에 실패했습니다.')}</p>
          )}

          <div className="flex justify-between">
            <button
              type="button"
              onClick={() => setSubStep('exam')}
              className="rounded border border-border px-4 py-2 text-sm text-primary hover:bg-bg"
            >
              ← 뒤로
            </button>
            <button
              type="button"
              disabled={!agreed || importMutation.isPending}
              onClick={() => startImport()}
              className="rounded bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
            >
              {importMutation.isPending ? '시작 중…' : '실행'}
            </button>
          </div>
        </div>
      )}

      {subStep === 'execute' && (
        <div className="flex flex-col gap-3">
          {running && <LlmJobProgress progress={jobQuery.data?.progress} includeDownloading={false} includeFetching />}

          {unavailable && (
            <div className="flex flex-col gap-2 rounded-lg border border-warning bg-accent-soft p-3 text-sm text-primary">
              <p className="font-medium">
                {unavailable === 'lost'
                  ? '진행 상황을 더 이상 확인할 수 없습니다'
                  : '서버에 연결하지 못했습니다'}
              </p>
              <p className="text-xs text-muted">
                {unavailable === 'lost'
                  ? '서버가 다시 시작되었거나 작업 정보가 만료되어(1시간) 이 수집 작업의 진행 상황이 사라졌습니다. 수집이 끝나기 전이었다면 반입되지 않았으니 다시 시도해 주세요.'
                  : '서버가 꺼져 있거나 다시 시작하는 중일 수 있습니다. 서버를 켠 뒤 [다시 확인]을 눌러 보세요 — 작업이 아직 살아 있으면 이어서 표시됩니다.'}
              </p>
              <div className="flex flex-wrap gap-2">
                {unavailable === 'unreachable' && (
                  <button
                    type="button"
                    onClick={() => jobQuery.refetch()}
                    className="rounded border border-border px-3 py-1.5 text-xs text-primary hover:bg-bg"
                  >
                    다시 확인
                  </button>
                )}
                <button
                  type="button"
                  onClick={resetAll}
                  className="rounded border border-border px-3 py-1.5 text-xs text-primary hover:bg-bg"
                >
                  처음부터 다시 시도
                </button>
              </div>
            </div>
          )}

          {jobFailed && (
            <div className="flex flex-col gap-2">
              <LlmErrorInfoView
                errorInfo={jobErrorInfo}
                legacyError={jobQuery.data?.error}
                // 렌더 여부는 LlmErrorInfoView가 error_info.alternatives(예: 'file_import')로
                // 판단한다 — 여기서는 kind를 미리 좁히지 않는다.
                onContinueWithFile={() => {
                  resetAll()
                  onFallbackToFile()
                }}
              />
              {isParseFailed && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      resetAll()
                      onFallbackToUrl()
                    }}
                    className="rounded border border-border px-3 py-1.5 text-xs text-primary hover:bg-bg"
                  >
                    URL로 반입
                  </button>
                  {altAdapter && (
                    <button
                      type="button"
                      onClick={() => startImport({ adapterOverride: altAdapter })}
                      disabled={importMutation.isPending}
                      className="rounded border border-border px-3 py-1.5 text-xs text-primary hover:bg-bg disabled:opacity-50"
                    >
                      {adapterName(altAdapter)}(으)로 재시도
                    </button>
                  )}
                </div>
              )}
              <button
                type="button"
                onClick={resetAll}
                className="w-fit rounded border border-border px-3 py-1.5 text-xs text-primary hover:bg-bg"
              >
                처음부터 다시
              </button>
            </div>
          )}

          {previewFetchFailed && (
            <div className="rounded border border-warning bg-accent-soft px-3 py-2 text-sm text-primary">
              {previewExpired ? (
                <p>미리보기가 만료되었습니다 (1시간 TTL). 다시 시작하세요.</p>
              ) : (
                <p>
                  수집은 완료됐지만 미리보기를 자동으로 불러오지 못했습니다
                  {jobQuery.data?.result_preview_id ? ` (preview_id: ${jobQuery.data.result_preview_id})` : ''}.
                </p>
              )}
              <button
                type="button"
                onClick={resetAll}
                className="mt-2 rounded border border-border px-3 py-1.5 text-xs text-primary hover:bg-bg"
              >
                다시 시작
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
