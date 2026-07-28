import { useState } from 'react'
import { useFetchAdapters, useSetQnetKey, useDeleteQnetKey } from '../../api/fetch'
import { ApiError } from '../../api/client'

function errMsg(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback
}

// 설계 §4.13(S14)·§5.11 — 큐넷 오픈API 서비스키 카드. F34 LlmEngineSection의 API 키 카드 UX를
// 그대로 미러한다: 즉석 검증 실패 사유 표시 → 성공 시에만 suffix 마스킹 표시, 삭제 버튼.
// 데이터 출처는 GET /api/fetch/adapters의 qnet 항목(key_registered·key_suffix·available·notice) —
// 반입 화면([사이트에서 가져오기])과 같은 쿼리 캐시를 공유하므로 여기서 등록/삭제하면 그 화면의
// available·배지도 자동으로 갱신된다(별도 상태 없음).
export default function QnetKeySection() {
  const adaptersQuery = useFetchAdapters()
  const setKey = useSetQnetKey()
  const deleteKey = useDeleteQnetKey()

  const [keyInput, setKeyInput] = useState('')
  const [keyError, setKeyError] = useState<string | null>(null)
  const [keySaved, setKeySaved] = useState(false)

  const qnet = adaptersQuery.data?.find((a) => a.id === 'qnet')

  function handleSaveKey() {
    if (!keyInput.trim()) {
      setKeyError('서비스키를 입력하세요.')
      return
    }
    setKeyError(null)
    setKey.mutate(keyInput.trim(), {
      onSuccess: () => {
        setKeyInput('')
        setKeySaved(true)
        window.setTimeout(() => setKeySaved(false), 1500)
      },
      onError: (e) => setKeyError(errMsg(e, '연결 테스트에 실패했습니다. 키를 확인하세요.')),
    })
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <h3 className="mb-1 text-sm font-semibold text-primary">큐넷 오픈API</h3>
      <p className="mb-3 text-xs text-muted">
        공공데이터포털 서비스키를 등록하면 반입 화면의 [사이트에서 가져오기]에서 큐넷 국가자격
        공개문제(실기 작업형·도면)를 검색해 가져올 수 있습니다.
      </p>

      <div className="rounded border border-border bg-bg p-3">
        {adaptersQuery.isLoading && <p className="text-xs text-muted">상태 확인 중…</p>}
        {adaptersQuery.isError && <p className="text-xs text-wrong">상태를 불러오지 못했습니다.</p>}

        {qnet?.key_registered ? (
          <div className="flex flex-col gap-2 text-xs">
            <p className="text-correct">
              ✓ 등록됨 — <code className="rounded bg-surface px-1">…{qnet.key_suffix}</code>
            </p>
            <button
              type="button"
              onClick={() => deleteKey.mutate()}
              disabled={deleteKey.isPending}
              className="w-fit rounded border border-border px-2 py-1 text-xs text-wrong hover:bg-surface disabled:opacity-50"
            >
              {deleteKey.isPending ? '삭제 중…' : '키 삭제'}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <input
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="공공데이터포털 서비스키"
              autoComplete="off"
              className="rounded border border-border bg-surface px-3 py-2 text-sm text-primary outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={handleSaveKey}
              disabled={setKey.isPending}
              className="w-fit rounded bg-accent px-3 py-1.5 text-xs font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
            >
              {setKey.isPending ? '연결 테스트 중…' : keySaved ? '저장됨' : '연결 테스트 후 저장'}
            </button>
            {keyError && <p className="text-xs text-wrong">{keyError}</p>}
            <p className="text-[11px] text-muted">
              키는 서버의 secrets.json에만 저장되며(DB·백업 제외) 이 화면에는 다시 표시되지
              않습니다.
            </p>
          </div>
        )}
      </div>

      {/* 커버리지 한계(§4.13·§5.9 실측 5, 리스크 1) — 정적 문구로 고정 노출한다(서버 notice에
          의존하지 않음). 이유: 미등록 상태에서는 백엔드가 notice를 "서비스키 등록 필요…"로
          덮어써(fetch_service.py notice_override) 실기 위주·필기 범위 밖이라는 사실이 어디에도
          안 뜬다 — 정작 사용자가 기대를 형성하는 등록 직전 시점에 안내가 사라지는 문제였다
          (2026-07-27 검토 지적). 등록 여부와 무관하게 항상 보이도록 조건 없이 렌더한다. */}
      <p className="mt-3 rounded border border-warning bg-accent-soft px-3 py-2 text-xs text-primary">
        큐넷 공개문제는 실기 작업형·도면 위주입니다 — 필기·필답형 기출(예: 품질경영기사)은 이
        API에 없으니, 그런 자료는 반입 화면의 [파일] 또는 [URL]로 반입하세요.
      </p>
      {qnet?.notice && <p className="mt-2 text-[11px] text-muted">{qnet.notice}</p>}

      <p className="mt-3 text-[11px] text-muted">
        발급 방법: <a
          href="https://www.data.go.kr"
          target="_blank"
          rel="noreferrer"
          className="text-accent hover:underline"
        >
          공공데이터포털
        </a>
        에서 "국가자격 공개문제 조회 서비스"를 검색해 활용신청 후 발급받은 서비스키를
        입력하세요(승인까지 시일이 걸릴 수 있습니다).
      </p>
    </section>
  )
}
