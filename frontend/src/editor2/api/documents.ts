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
import { api } from '../../api/client'
import { documentKeys } from '../../api/documents'
import type { DocumentDetail, DocumentStyle } from '../../api/types'
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

export function useUpdateDocumentBlocks() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: DocumentBlocksPatch) =>
      api.patch<DocumentDetailWithBlocks>(`/documents/${id}`, body),
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
