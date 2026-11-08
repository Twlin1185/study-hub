import { Link } from 'react-router-dom'
import type { ImportCommitResult } from '../../api/types'

export default function ResultStep({
  result,
  erroredCount,
  onRestart,
  onBackToQueue,
}: {
  result: ImportCommitResult
  erroredCount: number
  onRestart: () => void
  onBackToQueue: (() => void) | null
}) {
  return (
    <div className="flex flex-col gap-4">
      {result.recovered && (
        <div className="rounded border border-accent bg-accent-soft px-3 py-2 text-sm text-primary">
          만료된 미리보기를 보존본으로 복구해 반입했습니다 — 중복 판정은 반입 시점 DB 기준입니다.
        </div>
      )}

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

      <div className="flex flex-wrap gap-2">
        {onBackToQueue && (
          <button
            type="button"
            onClick={onBackToQueue}
            className="rounded bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90"
          >
            반입 건 목록으로
          </button>
        )}
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
