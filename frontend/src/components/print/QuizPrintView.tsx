import { useMemo } from 'react'
import { useCategoryTree } from '../../api/categories'
import { useDocumentsBatch } from '../../api/documents'
import { findCategory, collectLeafGroups } from '../../utils/tree'
import MarkdownView from '../MarkdownView'
import InlineRichText from '../markdown/InlineRichText'
import { useFontScale } from '../../hooks/useFontScale'
import { resolveDocStyle } from '../../utils/docStyle'
import { useLeafStudyTracks } from './useLeafStudyTracks'
import { CIRCLED_DIGITS } from '../../utils/answerFormat'

interface QuizPrintViewProps {
  categoryId: number
  includeExplanation: boolean
  answerSpace: boolean
}

function isQuestionType(type: string): boolean {
  return type === 'question' || type === 'past_question'
}

// 설계 §5.10 — 문제집: 문제(앞) / 정답·해설(뒤) 분리, 해설 제외 옵션, 풀이 여백 옵션.
export default function QuizPrintView({ categoryId, includeExplanation, answerSpace }: QuizPrintViewProps) {
  const treeQuery = useCategoryTree()
  const globalScale = useFontScale()
  const rootNode = treeQuery.data ? findCategory(treeQuery.data, categoryId) : null
  const leaves = useMemo(() => (rootNode ? collectLeafGroups(rootNode) : []), [rootNode])
  const tracks = useLeafStudyTracks(leaves)

  const questionGroups = tracks.map((t) => ({
    leaf: t.leaf,
    items: (t.data?.items ?? []).filter((it) => isQuestionType(it.type)),
  }))
  const allIds = questionGroups.flatMap((g) => g.items.map((it) => it.document_id))
  const batchQuery = useDocumentsBatch(allIds)
  const docById = new Map((batchQuery.data ?? []).map((d) => [d.id, d]))

  if (!treeQuery.data) return <p className="text-sm text-muted">불러오는 중…</p>
  if (!rootNode) return <p className="text-sm text-wrong">분류를 찾을 수 없습니다.</p>
  if (tracks.some((t) => t.isLoading) || batchQuery.isLoading) {
    return <p className="text-sm text-muted">인쇄 내용을 준비하는 중…</p>
  }

  const flatItems = questionGroups.flatMap((g) => g.items)
  if (flatItems.length === 0) {
    return <p className="text-sm text-muted">선택한 범위에 문제 문서가 없습니다.</p>
  }

  let seq = 0

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-primary">{rootNode.name} — 문제집</h1>
      <p className="mb-6 text-xs text-muted">
        생성일 {new Date().toISOString().slice(0, 10)} · 총 {flatItems.length}문항
      </p>

      {/* 문제 섹션 */}
      {questionGroups
        .filter((g) => g.items.length > 0)
        .map((g) => (
          <section key={g.leaf.id} className="mb-6">
            <h2 className="print-avoid-break mb-3 border-b border-border pb-1 text-lg font-semibold text-primary">
              {g.leaf.path}
            </h2>
            {g.items.map((it) => {
              seq += 1
              const doc = docById.get(it.document_id)
              // S28(F53 ①·⑤, §4.26 ④) — 배경은 미리보기 화면에서만, 폰트·크기는 인쇄에도 유지.
              const { scale, fontClassName, bgClassName } = resolveDocStyle(doc?.style, globalScale)
              // 검토 경미-1 수정 — style 미지정 문서까지 패딩을 넣지 않는다(DoD 4 무지정 렌더 불변).
              const boxClass = bgClassName ? 'rounded p-2' : ''
              return (
                <article
                  key={it.document_id}
                  className={`print-avoid-break mb-6 ${boxClass} ${bgClassName} ${fontClassName}`}
                >
                  <h3 className="mb-2 text-sm font-semibold text-primary">
                    {seq}. <span className="mr-1 text-xs font-normal text-muted">{it.doc_no}</span>
                    {it.title}
                  </h3>
                  <MarkdownView content={doc?.content ?? null} docNo={it.doc_no} scale={scale} />
                  {(doc?.choices ?? []).length > 0 && (
                    <ul className="mt-2 flex flex-col gap-1 text-sm text-primary">
                      {(doc?.choices ?? []).map((c, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="shrink-0 font-medium">{CIRCLED_DIGITS[i] ?? `${i + 1}.`}</span>
                          <InlineRichText content={c} scale={scale} />
                        </li>
                      ))}
                    </ul>
                  )}
                  {answerSpace && (
                    <div className="mt-3 h-24 rounded border border-dashed border-border" aria-hidden />
                  )}
                </article>
              )
            })}
          </section>
        ))}

      {/* 정답·해설 섹션 — 항상 새 페이지에서 시작 */}
      <section className="print-page">
        <h2 className="mb-3 border-b border-border pb-1 text-lg font-semibold text-primary">정답{includeExplanation ? ' 및 해설' : ''}</h2>
        <ol className="flex flex-col gap-3 text-sm text-primary">
          {flatItems.map((it, i) => {
            const doc = docById.get(it.document_id)
            return (
              <li key={it.document_id} className="print-avoid-break">
                <p className="font-medium">
                  {i + 1}. {it.doc_no} — 정답 {doc?.answer ?? '-'}
                </p>
                {includeExplanation && doc?.explanation && (
                  <div className="mt-1 text-xs text-muted">
                    <MarkdownView content={doc.explanation} />
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      </section>
    </div>
  )
}
