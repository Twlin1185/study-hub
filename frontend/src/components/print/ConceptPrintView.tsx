import { useMemo } from 'react'
import { useCategoryTree } from '../../api/categories'
import { useDocumentsBatch } from '../../api/documents'
import { findCategory, collectLeafGroups } from '../../utils/tree'
import MarkdownView from '../MarkdownView'
import { useLeafStudyTracks } from './useLeafStudyTracks'

interface ConceptPrintViewProps {
  categoryId: number
}

// 설계 §5.10 — 개념 정리본: 목차 자동 생성 + doc_no 표시. 선택 분류 하위의 리프 챕터마다
// study-track(정렬 순서)을 모아 개념(concept) 문서만 발췌하고, documents/batch로 본문을 채운다.
export default function ConceptPrintView({ categoryId }: ConceptPrintViewProps) {
  const treeQuery = useCategoryTree()
  const rootNode = treeQuery.data ? findCategory(treeQuery.data, categoryId) : null
  const leaves = useMemo(() => (rootNode ? collectLeafGroups(rootNode) : []), [rootNode])
  const tracks = useLeafStudyTracks(leaves)

  const conceptGroups = tracks.map((t) => ({
    leaf: t.leaf,
    items: (t.data?.items ?? []).filter((it) => it.type === 'concept'),
  }))
  const allIds = conceptGroups.flatMap((g) => g.items.map((it) => it.document_id))
  const batchQuery = useDocumentsBatch(allIds)
  const docById = new Map((batchQuery.data ?? []).map((d) => [d.id, d]))

  if (!treeQuery.data) return <p className="text-sm text-muted">불러오는 중…</p>
  if (!rootNode) return <p className="text-sm text-wrong">분류를 찾을 수 없습니다.</p>
  if (tracks.some((t) => t.isLoading) || batchQuery.isLoading) {
    return <p className="text-sm text-muted">인쇄 내용을 준비하는 중…</p>
  }

  const hasAny = conceptGroups.some((g) => g.items.length > 0)
  if (!hasAny) {
    return <p className="text-sm text-muted">선택한 범위에 개념 문서가 없습니다.</p>
  }

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-primary">{rootNode.name} — 개념 정리본</h1>
      <p className="mb-6 text-xs text-muted">생성일 {new Date().toISOString().slice(0, 10)}</p>

      {/* 목차 */}
      <section className="print-avoid-break mb-8">
        <h2 className="mb-2 text-base font-semibold text-primary">목차</h2>
        <ol className="list-decimal pl-5 text-sm text-primary">
          {conceptGroups
            .filter((g) => g.items.length > 0)
            .map((g) => (
              <li key={g.leaf.id} className="mb-1">
                <span className="font-medium">{g.leaf.path}</span>
                <ul className="list-disc pl-5">
                  {g.items.map((it) => (
                    <li key={it.document_id}>
                      <a href={`#doc-${it.document_id}`} className="text-accent underline">
                        {it.doc_no} {it.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
        </ol>
      </section>

      {/* 본문 */}
      {conceptGroups
        .filter((g) => g.items.length > 0)
        .map((g) => (
          <section key={g.leaf.id} className="mb-6">
            <h2 className="print-avoid-break mb-3 border-b border-border pb-1 text-lg font-semibold text-primary">
              {g.leaf.path}
            </h2>
            {g.items.map((it) => {
              const doc = docById.get(it.document_id)
              return (
                <article key={it.document_id} id={`doc-${it.document_id}`} className="print-page mb-5">
                  <h3 className="mb-1 text-base font-semibold text-primary">
                    <span className="mr-2 text-xs font-normal text-muted">{it.doc_no}</span>
                    {it.title}
                  </h3>
                  {/* 인쇄 뷰도 같은 공용 렌더러 — 임베드는 펼쳐서, fold/hide는 전부 공개해 출력된다
                      (설계 §4.19 ⑧). docNo는 순환 검출의 시작점. */}
                  <MarkdownView content={doc?.content ?? null} docNo={it.doc_no} />
                </article>
              )
            })}
          </section>
        ))}
    </div>
  )
}
