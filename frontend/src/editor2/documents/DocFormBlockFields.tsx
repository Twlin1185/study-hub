// 공용 폼(`components/DocEditor`)의 **본문·해설 편집 위젯** 블록 판 — stage-36 F-1(규약 A·B).
//
// 이 조각이 있는 이유: 진입점 ②~⑥(`/docs/new` · `/docs/:id/edit` · 탐색/커리큘럼 모달 3종)은 전부
// 공용 `DocEditor` 1곳을 경유하므로, 그 안의 **본문·해설 위젯을 한 번만 갈아 끼우면** 5개 진입점이
// 동시에 새 편집기로 옮겨진다(진입점별 복붙 0). 그래서 이 컴포넌트가 책임지는 것은 딱 두 가지다:
//   ① 본문·해설 **2표면**(BlockSurface — 사이드카 결선·표면별 격리·고지 전건은 그쪽이 담당)
//   ② 저장 시점에 부모가 꺼내 갈 **블록+프로젝션 한 쌍**(`build()` — 한쪽만 존재할 수 없는 모양)
//
// 여기서 **하지 않는 것**(규약 A): 제목·type·보기·정답·난이도·태그·스타일 폼 필드는 기존 `DocEditor`
// 폼이 그대로 소유한다(D7 1차 — 문서 표면 흡수 없음). 보기·정답 필드는 본문과 해설 **사이**에 놓여야
// 기존 화면 순서가 유지되므로 부모가 만든 노드를 `between`으로 받아 그 자리에 끼운다.
//
// 저장 방식은 부모를 따른다 — `DocEditor`는 [저장]/[생성] **명시 저장** 폼이고(취소·미저장 확인이
// 그 계약이다), 자동 저장은 문서 상세(`/docs/:id` [편집] = stage-35 `DocBlockEditor`)의 계약이다.
// 두 곳 모두 **저장 요청 자체는 같은 stage-35 파이프라인**(블록+프로젝션 동반 · `fromBlockNoteResult`
// 경유 · 표면별 사이드카)을 쓴다.
import { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { ReactNode, Ref } from 'react'
import type { DocumentDetail } from '../../api/types'
import { useEditorTheme } from '../blocknote/schema'
import BlockSurface, { type BlockSurfaceHandle, type SurfaceBody } from './BlockSurface'
import { readBlockFields } from '../api/documents'
import { loadSurface, type SurfaceLoad, type SurfaceSource } from './surfaceSource'

/** 저장 시점에 폼이 꺼내 가는 것 — 본문은 항상, 해설은 표면이 열려 있을 때만. */
export interface DocFormBodies {
  content: SurfaceBody
  /** null = 해설 표면 없음(개념·플래시카드) → 부모는 해설 축을 **아예 보내지 않는다**. */
  explanation: SurfaceBody | null
}

export interface DocFormBlockFieldsHandle {
  /** 표면이 아직 준비되지 않았으면 null — 부모는 그 상태로 저장하지 않는다(부분 전송 방지). */
  build: () => DocFormBodies | null
}

interface DocFormBlockFieldsProps {
  /**
   * **블록 소스로 삼을 문서**(전환 문서면 `*_blocks`가 소스 오브 트루스 — 규약 D).
   * null이면 Markdown에서 메모리 변환한다: 신규 작성(빈 문서)이거나, "창으로 열기" 이월 초안처럼
   * 서버 블록보다 우선하는 최신 Markdown이 있는 경우다(초안 우선 = DocEditor 기존 규칙).
   */
  doc: DocumentDetail | null
  /** 미전환·신규 경로의 표면 초기 본문(폼 초기값 = 이월 초안 포함). */
  initialContent: string
  initialExplanation: string
  /** 해설 표면을 보일지 — 문제·기출 타입일 때만(신규 작성은 타입 셀렉트로 도중에 바뀔 수 있다). */
  showExplanation: boolean
  /** 본문과 해설 **사이**에 그대로 끼울 부모의 폼 노드(보기·정답) — 화면 순서 보존용. */
  between?: ReactNode
  handleRef: Ref<DocFormBlockFieldsHandle>
  /** 편집이 일어났다 — 부모의 미저장(dirty) 판정에 합류한다. */
  onChange: () => void
  /** 메모리 변환이 미지원 사유를 보고했다 — 부모가 본문·해설 편집 잠김으로 전환한다(stage-43 규약 D). */
  onUnsupported: (reason: string) => void
}

interface PreparedSurfaces {
  content: SurfaceLoad
  explanation: SurfaceLoad
  /** 해설 표면을 실제로 쓸 문서인가 — 안 쓰는 해설의 미지원은 잠김 사유가 아니다. */
  explanationRelevant: boolean
}

export default function DocFormBlockFields({
  doc,
  initialContent,
  initialExplanation,
  showExplanation,
  between,
  handleRef,
  onChange,
  onUnsupported,
}: DocFormBlockFieldsProps) {
  // 로드 계산은 **마운트 1회로 고정**한다(stage-35와 같은 이유) — 부모가 리렌더돼도 편집 중인
  // 표면을 다시 만들지 않는다(편집분 되감기 0).
  const [prepared] = useState<PreparedSurfaces>(() => {
    const fields = doc ? readBlockFields(doc) : null
    return {
      content: loadSurface(fields?.content_blocks ?? null, initialContent),
      explanation: loadSurface(fields?.explanation_blocks ?? null, initialExplanation),
      // 신규 작성은 타입이 도중에 바뀔 수 있으므로 "지금 보이는가"만으로 판정하지 않는다 —
      // 초기 해설 내용이 있으면(이월 초안 등) 그것도 판정 대상이다. 마운트 1회 판정으로 고정해
      // 편집 도중에 표면이 사라지는 상태를 만들지 않는다.
      explanationRelevant: showExplanation || initialExplanation.trim() !== '',
    }
  })

  const fallbackReason = useMemo(() => {
    const reasons = [
      !prepared.content.ok ? `본문: ${prepared.content.reason}` : null,
      prepared.explanationRelevant && !prepared.explanation.ok
        ? `해설: ${prepared.explanation.reason}`
        : null,
    ].filter(Boolean)
    return reasons.length > 0 ? reasons.join(' · ') : null
  }, [prepared])

  useEffect(() => {
    if (fallbackReason) onUnsupported(fallbackReason)
    // 로드 1회 판정 — 재실행할 이유가 없다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fallbackReason])

  if (fallbackReason || !prepared.content.ok) {
    return (
      <>
        <p className="text-sm text-muted">문서를 확인하는 중…</p>
        {between}
      </>
    )
  }

  return (
    <Surfaces
      contentSource={prepared.content.source}
      explanationSource={prepared.explanation.ok ? prepared.explanation.source : null}
      showExplanation={showExplanation}
      between={between}
      handleRef={handleRef}
      onChange={onChange}
    />
  )
}

interface SurfacesProps {
  contentSource: SurfaceSource
  explanationSource: SurfaceSource | null
  showExplanation: boolean
  between?: ReactNode
  handleRef: Ref<DocFormBlockFieldsHandle>
  onChange: () => void
}

function Surfaces({
  contentSource,
  explanationSource,
  showExplanation,
  between,
  handleRef,
  onChange,
}: SurfacesProps) {
  const theme = useEditorTheme()
  const contentRef = useRef<BlockSurfaceHandle | null>(null)
  const explanationRef = useRef<BlockSurfaceHandle | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // 해설 표면은 한 번 열리면 **계속 마운트해 둔다**(타입 셀렉트를 문제 → 개념 → 문제로 오가도
  // 작성 중이던 해설을 잃지 않게). 보이지 않는 동안에는 숨기기만 하고, 저장에도 싣지 않는다.
  const explanationMounted = useRef(false)
  if (showExplanation && explanationSource) explanationMounted.current = true

  // 저장 시점의 최신 값을 읽게 ref 경유(핸들 identity가 매번 바뀌지 않도록).
  const showExplanationRef = useRef(showExplanation)
  showExplanationRef.current = showExplanation

  useImperativeHandle(
    handleRef,
    () => ({
      build: () => {
        const content = contentRef.current?.build()
        // 본문 표면이 없으면 **아무것도 돌려주지 않는다** — 부모가 절반짜리 저장을 하지 않게.
        if (!content) return null
        const explanation =
          showExplanationRef.current && explanationRef.current ? explanationRef.current.build() : null
        return { content, explanation }
      },
    }),
    [],
  )

  return (
    <>
      {notice && (
        <div className="flex items-center justify-between gap-2 rounded border border-border bg-surface px-3 py-2 text-xs text-muted">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="shrink-0 underline">
            닫기
          </button>
        </div>
      )}

      <BlockSurface
        ref={contentRef}
        label={showExplanation ? '지문 (본문)' : '본문'}
        initialBlocks={contentSource.blocks}
        sidecar={contentSource.sidecar}
        theme={theme}
        onChange={onChange}
        onNotice={setNotice}
        // 명시 저장 폼이라 조합 중 보류할 자동 저장이 없다(저장은 버튼 클릭 = 조합 확정 후).
        onComposition={noop}
      />

      {between}

      {explanationSource && (showExplanation || explanationMounted.current) && (
        <div className={showExplanation ? 'flex flex-col' : 'hidden'}>
          <BlockSurface
            ref={explanationRef}
            label="해설"
            initialBlocks={explanationSource.blocks}
            sidecar={explanationSource.sidecar}
            theme={theme}
            onChange={onChange}
            onNotice={setNotice}
            onComposition={noop}
          />
        </div>
      )}
    </>
  )
}

function noop() {}
