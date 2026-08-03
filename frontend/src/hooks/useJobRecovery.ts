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
//
// 래치 계약(stage-reviewer 지적 반영, 2026-08-03 표적 재검토) — "화면 진입(마운트) 시 복원"과
// "사용자의 명시적 닫음·재설정"을 구분해야 한다. 한 번 복원(또는 대상 부재 확인)을 마치면 그
// **컴포넌트 인스턴스 수명 동안**(=1회 마운트 동안) 다시 검사하지 않는다 — enabled가 사용자
// 조작(모달 닫기·Stepper 재설정 등)으로 다시 true가 되어도 재점화하지 않는다. 실제 "재진입"은
// 컴포넌트가 통째로 재마운트될 때만 성립한다(라우트 이탈 후 복귀, 탭 조건부 렌더 등 — 이 경우
// ref가 새로 만들어져 자연히 래치가 풀린다). 단 RegenerateJobPanel·ExplainJobPanel처럼 같은
// 컴포넌트 인스턴스가 유지된 채 대상만 바뀌는 화면(문서 상세의 doc.id 전환)은 `resetKey`로
// "이건 진짜 새 진입"을 알려 래치를 다시 연다.
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
  // 컴포넌트가 재마운트되지 않고 재사용되는 화면에서 "진짜 새 진입"을 알리는 값(예: doc.id).
  // 이 값이 바뀌면 래치를 다시 연다 — 생략(기본 화면들)하면 마운트당 정확히 1회만 검사한다.
  resetKey?: unknown
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
  resetKey,
  onRecovered,
}: UseJobRecoveryOptions): UseJobRecoveryResult {
  const jobsQuery = useLlmJobs()
  const firedRef = useRef(false)
  const onRecoveredRef = useRef(onRecovered)
  onRecoveredRef.current = onRecovered

  // resetKey가 바뀔 때만 래치를 다시 연다(진짜 새 진입 신호) — enabled 자체의 재-true 전환으로는
  // 절대 풀지 않는다(이전 버그: 모달을 닫아 enabled가 true로 돌아오면 다음 폴링에서 같은 잡을
  // 다시 "복원"해 모달이 저절로 재개방됐다).
  useEffect(() => {
    firedRef.current = false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey])

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
    // resetKey를 deps에 포함 — 값이 바뀌면(위 효과가 firedRef를 막 풀어 준 직후) enabled 값
    // 자체가 안 바뀌어도 즉시 재평가한다(다음 폴링까지 최대 15초를 기다리지 않도록).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, jobsQuery.data, kind, includeDone, resetKey])

  return { checked: jobsQuery.isFetched }
}
