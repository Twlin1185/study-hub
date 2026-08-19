// 문서 임베드 블록의 펼친 본문 카드 (stage-36 규약 D).
//
// 리더(F43) 임베드 렌더 자산을 그대로 구성해 쓴다 — 신규 임베드 전용 렌더 경로는 만들지 않는다.
// 데이터는 `POST /api/documents/resolve-embeds`(§4.19, `EmbedResolver`)를 재사용하고, 본문은
// **공용 `MarkdownView`**로 렌더한다(임베드 전용 파서·컴포넌트 금지). 이 응답은 answer·explanation·
// style·블록 필드가 애초에 없는 봉인 스키마라(R20·§4.26 ②·§4.29 ⑤) 이 카드가 새 유출면을 열 일이 없다.
//
// 이 카드 전용 `EmbedResolver` 인스턴스를 새로 만든다 — 인스턴스 자체(캐시 Map 하나)는 가볍게 항상
// 있지만, 실제 네트워크 요청은 `EmbedCard`가 마운트될 때만 나간다. 블록이 접힌 동안에는 이 컴포넌트
// 자체가 마운트되지 않으므로(호출부 `DocEmbedRender`가 펼쳤을 때만 렌더) resolve-embeds 요청도 0이다.
//
// 중첩 깊이 — 이 카드를 `depth = MAX_EMBED_DEPTH - 1`로 seed해서 "카드 본문은 1단만 실제로 펼치고,
// 그 안에 또 임베드가 있으면 리더의 깊이 초과 자리표시자로 축약 표시"가 되게 한다. 새 규칙을 추가한
// 게 아니라 `EmbedCard`/`MarkdownView`가 이미 하는 깊이 계산에 시작값 하나만 다르게 흘려보낸
// 것뿐이다(순환 참조 방어도 `EmbedCard`의 기존 ancestors 체크를 그대로 탄다).
import { useMemo, useRef } from 'react'
import MarkdownView from '../../../components/MarkdownView'
import EmbedCard from '../../../components/markdown/EmbedCard'
import { EmbedResolver } from '../../../components/markdown/embedResolver'
import { EmbedRenderContext } from '../../../components/markdown/embedContext'
import type { EmbedRenderCtx } from '../../../components/markdown/embedContext'
import { MAX_EMBED_DEPTH } from '../../../components/markdown/refSyntax'
import { useFontScale } from '../../../hooks/useFontScale'

interface DocEmbedReadCardProps {
  target: string
  alias?: string
}

export default function DocEmbedReadCard({ target, alias }: DocEmbedReadCardProps) {
  const scale = useFontScale()
  const resolverRef = useRef<EmbedResolver | null>(null)
  if (!resolverRef.current) resolverRef.current = new EmbedResolver()

  const ctx = useMemo<EmbedRenderCtx>(
    () => ({ resolver: resolverRef.current as EmbedResolver, depth: MAX_EMBED_DEPTH - 1, ancestors: [] }),
    [],
  )

  return (
    <EmbedRenderContext.Provider value={ctx}>
      <EmbedCard
        docNo={target}
        alias={alias}
        renderContent={(content, docNo) => <MarkdownView content={content} scale={scale} docNo={docNo} />}
      />
    </EmbedRenderContext.Provider>
  )
}
