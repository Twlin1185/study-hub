import { useEffect, useRef } from 'react'
import { useLlmJobs } from '../api/llm'
import type { LlmJobItem, LlmJobKind, LlmJobRef } from '../api/types'

// 설계 §4.24 ⑤·ⓓ, §5.14(S22, F48) — 공용 재진입 복원 훅. 화면 진입 시 전역 잡 목록
// (GET /api/llm/jobs, useLlmJobs 캐시 — JobCenterPanel·사이드바 배지와 쿼리 키 공유라 중복
// 폴링 없음)에서 자기 kind(+ref 일치)의 running·queued 잡을 재발견하면 onRecovered로 그 잡을
// 1회 통지한다. 화면은 이를 받아 자기 kind의 기존 상태 엔드포인트 폴링을 재개하고
// "진행 중 작업을 복원했습니다" 소표기를 띄운다(F40-① recovered 전례).
//
// 적용 화면 6곳(§4.24 ⓓ)이 이 훅 1개를 공유한다 — 화면별 개별 구현 금지. 이미 로컬에 추적 중인
// 잡이 있는 화면은 enabled:false로 꺼서 재복원 시도를 막는다(중복 렌더 금지, RegenerateJobPanel
// 기존 진행 배지 전례).
export interface UseJobRecoveryOptions {
  kind: LlmJobKind
  // 생략하면 kind만으로 매칭한다(화면이 재진입 시 자기 참조를 아직 모르는 경우 — 예: 위저드가
  // prepare 이전 상태로 새로 마운트된 경우, §4.24 ⑤). 값을 주면 kind+ref 둘 다 일치해야 한다.
  matchRef?: (ref: LlmJobRef) => boolean
  enabled: boolean
  // 기본은 running·queued만 재발견(§4.24 ⑤ 원 계약). true면 done(TTL 내)도 재발견 대상에
  // 포함한다 — done 결과 복원은 "화면 재량"이라 화면이 필요할 때만 켠다(예: AppliedExamPanel의
  // 결과 요약·[응시 시작] 복원).
  includeDone?: boolean
  onRecovered: (job: LlmJobItem) => void
}

export interface UseJobRecoveryResult {
  // 전역 잡 목록의 첫 조회가 끝났는가 — 화면이 "복원되지 않았으니 평소 흐름(예: prepare 자동
  // 호출)으로 진행"을 판단하려면 이 값이 true가 될 때까지 기다려야 경합이 없다(ImproveGenWizard
  // 전례 — 잡 목록 응답보다 먼저 prepare를 쏘면 복원 판정을 영영 못 볼 수 있다).
  checked: boolean
}

export function useJobRecovery({
  kind,
  matchRef,
  enabled,
  includeDone,
  onRecovered,
}: UseJobRecoveryOptions): UseJobRecoveryResult {
  const jobsQuery = useLlmJobs()
  const firedRef = useRef(false)
  const onRecoveredRef = useRef(onRecovered)
  onRecoveredRef.current = onRecovered

  useEffect(() => {
    if (!enabled || firedRef.current) return
    const items = jobsQuery.data?.items ?? []
    const found = items.find((it) => {
      if (it.kind !== kind) return false
      const statusOk = it.status === 'running' || it.status === 'queued' || (includeDone && it.status === 'done')
      if (!statusOk) return false
      return matchRef ? matchRef(it.ref ?? {}) : true
    })
    if (found) {
      firedRef.current = true
      onRecoveredRef.current(found)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, jobsQuery.data, kind, includeDone])

  // 화면이 다시 enabled:true가 되면(예: 결과를 버리고 처음부터 다시 시작) 다음 진입에서 또
  // 복원을 시도할 수 있게 래치를 푼다.
  useEffect(() => {
    if (enabled) firedRef.current = false
  }, [enabled])

  return { checked: jobsQuery.isFetched }
}
