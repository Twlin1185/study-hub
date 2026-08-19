// documents 블록 저장 API 훅 — 설계 §4.29 [S35] (stage-35 규약 B·D).
//
// **신규 엔드포인트 0** — 기존 `PATCH /api/documents/{id}`의 필드 확장만 쓴다. 조회는 기존
// `useDocument`(api/documents.ts)를 그대로 재사용하고(같은 캐시 키 = 이중 요청 0), 여기서는
// ① 응답에 늘어난 블록 3필드의 타입 ② 블록+프로젝션을 **항상 동반**해 보내는 저장 훅만 둔다.
//
// 왜 `api/types.ts`를 고치지 않는가: `DocumentDetail`에 `BlockDocument`를 얹으면 앱 코어가
// `editor2/schema`에 의존하게 된다(D9 격리 역전). 블록을 아는 쪽은 editor2뿐이므로 확장 타입을
// 여기 두고, 코어는 이 필드를 모르는 채로 그대로 통과시킨다(서버 JSON에는 이미 들어 있다).
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ApiError, api } from '../../api/client'
import { categoryKeys } from '../../api/categories'
import { documentKeys } from '../../api/documents'
import type { DocumentDetail, DocumentStyle, DocumentType } from '../../api/types'
import type { BlockDocument } from '../schema/blocks'

/** §4.29 ① — 상세 응답에만 실리는 3필드(목록·batch에는 없다). NULL = 미전환 문서. */
export interface DocumentBlockFields {
  content_blocks: BlockDocument | null
  explanation_blocks: BlockDocument | null
  blocks_version: number | null
}

export type DocumentDetailWithBlocks = DocumentDetail & Partial<DocumentBlockFields>

/** 상세 응답에서 블록 3필드를 안전하게 읽는다(구버전 서버 응답이면 전부 null = 미전환). */
export function readBlockFields(doc: DocumentDetail): DocumentBlockFields {
  const withBlocks = doc as DocumentDetailWithBlocks
  return {
    content_blocks: withBlocks.content_blocks ?? null,
    explanation_blocks: withBlocks.explanation_blocks ?? null,
    blocks_version: withBlocks.blocks_version ?? null,
  }
}

/** 전환 문서인가(§4.29 ② — 판정 단일 기준은 `blocks_version`). */
export function isConvertedDocument(doc: DocumentDetail): boolean {
  return readBlockFields(doc).blocks_version != null
}

/**
 * 저장 페이로드 — **동반 규칙 2쌍**(§4.29 ②).
 *   `content_blocks` ↔ `content` · `explanation_blocks` ↔ `explanation`
 * 한쪽만 보내면 422 `projection_required`. `explanation_blocks: null` + `explanation` 동반은
 * "해설 블록 제거"라 **정상 요청**이다(전환 상태는 본문 축으로만 판정된다).
 *
 * `blocks_version`은 요청 필드가 아니다(서버가 `content_blocks.version`을 복사한다).
 */
export interface DocumentBlocksPatch {
  id: number
  title?: string
  choices?: string[] | null
  answer?: string | null
  difficulty?: number | null
  style?: DocumentStyle | null
  content_blocks?: BlockDocument
  content?: string
  explanation_blocks?: BlockDocument | null
  explanation?: string | null
}

/**
 * 표면(`BlockSurface.build()`)이 내놓는 한 쌍 — 블록과 그 블록의 Markdown 프로젝션.
 * 이 타입의 값 **하나**에서 두 필드를 동시에 만들어야만 요청에 실을 수 있게 아래 헬퍼를 둔다.
 */
export interface SurfacePair {
  blocks: BlockDocument
  markdown: string
}

/**
 * 본문 쌍(§4.29 ② 1행) — `content_blocks`와 `content`를 **같은 표면 결과 하나**에서 함께 만든다.
 * 저장 요청을 만드는 쪽은 이 헬퍼만 쓰므로 한쪽만 실린 페이로드가 **구조적으로** 만들어지지 않는다.
 */
export function contentPair(body: SurfacePair): { content_blocks: BlockDocument; content: string } {
  return { content_blocks: body.blocks, content: body.markdown }
}

/**
 * 해설 쌍(§4.29 ② 2행) — 본문 쌍과 **독립**이다.
 *   · 표면 없음(개념·플래시카드) = `{}` → 해설 축을 아예 보내지 않는다. **중요**: 블록 없이
 *     `explanation`만 보내면 서버가 전환 해제(3컬럼 NULL)를 수행한다(§4.29 ④ — `legacy_explanation_write`).
 *   · 표면이 비었음 = `explanation_blocks: null` + `explanation: ''` → 해설 블록만 제거(전환 유지).
 */
export function explanationPair(
  body: SurfacePair | null,
): { explanation_blocks?: BlockDocument | null; explanation?: string } {
  if (body == null) return {}
  if (body.markdown.trim() === '') return { explanation_blocks: null, explanation: '' }
  return { explanation_blocks: body.blocks, explanation: body.markdown }
}

/**
 * 동반 규칙 최종 방어선(§4.29 ②) — 요청을 보내기 **직전에** 두 축 각각이 짝을 이루는지 본다.
 * 서버도 422로 막지만(`projection_required`), 프런트에서 먼저 터뜨려야 하는 이유는 반대 방향이다:
 * `content`만 실린 요청은 서버가 **성공으로 받아들이고 전환을 해제**하기 때문에(구 편집기 경로),
 * 새 편집기가 실수로 그 모양을 만들면 조용한 강등이 된다. 여기서 막는다.
 */
function assertBlockPairs(body: Record<string, unknown>): void {
  const axes: [string, string][] = [
    ['content_blocks', 'content'],
    ['explanation_blocks', 'explanation'],
  ]
  for (const [blocksKey, projectionKey] of axes) {
    const hasBlocks = body[blocksKey] !== undefined
    const hasProjection = body[projectionKey] !== undefined
    if (hasBlocks !== hasProjection) {
      throw new Error(
        `[editor2] 저장 계약 위반: ${blocksKey}와 ${projectionKey}는 항상 함께 보내야 합니다(설계 §4.29 ②).`,
      )
    }
  }
}

export function useUpdateDocumentBlocks() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: DocumentBlocksPatch) => {
      assertBlockPairs(body)
      return api.patch<DocumentDetailWithBlocks>(`/documents/${id}`, body)
    },
    // 기존 `useUpdateDocument`와 **같은 무효화 정책**을 쓴다(상세 + 목록·트리 파생 화면).
    // 편집 표면은 로드 시점의 블록·폼 값을 **고정**해 두므로(DocBlockEditor의 useState 초기화)
    // 저장 뒤 상세가 다시 들어와도 편집 중인 내용이 되감기지 않는다. 대신 편집을 끝내고 읽기
    // 화면으로 돌아갔을 때 방금 저장분이 항상 보인다(노트와 달리 문서 상세는 같은 화면이다).
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: documentKeys.detail(variables.id) })
      qc.invalidateQueries({ queryKey: documentKeys.all })
    },
  })
}

/**
 * 신규 작성 저장 페이로드 — 설계 §4.29 ⑦ [S36](신규 엔드포인트 0 · 기존 `POST /api/documents` 확장).
 *
 * **본문 쌍은 선택이 아니라 필수다**(`content_blocks`·`content` 둘 다 required) — 이 훅은 "블록
 * 표면으로 작성한 문서"의 생성 경로이고, 그 문서는 **태생 전환**이어야 하기 때문이다. 블록을
 * 동반하지 않는 생성(구 편집기·반입)은 종전 `useCreateDocument`가 그대로 담당한다(계약 무변).
 */
export interface DocumentBlocksCreate {
  type: DocumentType
  title: string
  content_blocks: BlockDocument
  content: string
  choices?: string[] | null
  answer?: string | null
  explanation_blocks?: BlockDocument | null
  explanation?: string | null
  difficulty?: number | null
  /** 생성 후 자동 연결할 분류 — POST 본문 필드가 아니라 links 체이닝이다(코어 훅과 같은 규약). */
  category_id?: number | null
}

export interface CreateDocumentWithBlocksResult {
  document: DocumentDetailWithBlocks
  linkError?: string
}

/**
 * 블록 동반 생성 훅. 코어 `useCreateDocument`와 **같은 순서·같은 무효화 정책**으로 움직이되
 * (POST /documents → 실패해도 생성은 성공으로 보는 links 체이닝 → 목록·트리 무효화), 페이로드에
 * 블록 쌍이 실린다는 점만 다르다.
 *
 * 코어 훅을 재사용하지 않고 여기 둔 이유는 D9 격리다 — `api/documents.ts`(앱 코어)는 블록 타입을
 * 알지 못한 채로 남아야 하고(`editor2/schema` 역의존 금지), stage-36 지시서의 허용 접촉점도
 * `editor2/**`와 `components/DocEditor.tsx`뿐이다.
 */
export function useCreateDocumentWithBlocks() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      category_id,
      ...body
    }: DocumentBlocksCreate): Promise<CreateDocumentWithBlocksResult> => {
      assertBlockPairs(body)
      const document = await api.post<DocumentDetailWithBlocks>('/documents', body)
      if (category_id != null) {
        try {
          await api.post<void>(`/documents/${document.id}/links`, { category_id })
        } catch (e) {
          return {
            document,
            linkError: e instanceof ApiError ? e.message : '분류 연결에 실패했습니다.',
          }
        }
      }
      return { document }
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: documentKeys.all })
      if (!result.linkError) {
        qc.invalidateQueries({ queryKey: categoryKeys.tree })
      }
    },
  })
}
