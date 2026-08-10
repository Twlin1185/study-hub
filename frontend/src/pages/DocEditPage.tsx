import { useRef } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import DocEditor, { DRAFT_STORAGE_KEY } from '../components/DocEditor'
import type { FormState } from '../components/DocEditor'
import type { DocumentType } from '../api/types'

// 전용 라우트(창, stage-26 9-5) — 팝업 모달과 같은 DocEditor를 페이지로 렌더한다(저장·검증 공용).
// `/docs/new`(신규 작성, 쿼리 파라미터로 타입·분류 컨텍스트 유지) · `/docs/:id/edit`(기존 문서 수정).
const VALID_TYPES: DocumentType[] = ['concept', 'question', 'past_question', 'flashcard']

function isDocumentType(value: string | null): value is DocumentType {
  return value != null && (VALID_TYPES as string[]).includes(value)
}

// "창으로 열기" 이월 초안(10-1ⓒ 연장) — 1회성: 읽으면 즉시 삭제한다. DocEditor가 자기 form과
// 같은 형태로 직렬화해 넣어 두므로(신뢰 가능한 자체 생성 데이터) 필드 형태만 가볍게 확인한다.
function readAndClearDraft(): FormState | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_STORAGE_KEY)
    if (!raw) return null
    sessionStorage.removeItem(DRAFT_STORAGE_KEY)
    const parsed = JSON.parse(raw) as Partial<FormState> | null
    if (!parsed || typeof parsed !== 'object') return null
    const keys: (keyof FormState)[] = ['type', 'title', 'content', 'choices', 'answer', 'explanation', 'difficulty']
    if (!keys.every((k) => typeof parsed[k] === 'string')) return null
    return parsed as FormState
  } catch {
    return null
  }
}

export default function DocEditPage() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const editing = id != null
  const documentId = editing ? Number(id) : undefined

  const typeParam = searchParams.get('type')
  const defaultType = isDocumentType(typeParam) ? typeParam : 'concept'
  // 경미-4 수정: `?categoryId=abc` 같은 무효 값이 Number()로 NaN이 된 채 조용히 통과하지 않게
  // Number.isInteger로 가드한다 — 무효면 categoryId·categoryName(자동 연결 배너) 둘 다 버린다.
  const categoryIdParam = searchParams.get('categoryId')
  const parsedCategoryId = categoryIdParam !== null ? Number(categoryIdParam) : null
  const categoryId = parsedCategoryId !== null && Number.isInteger(parsedCategoryId) ? parsedCategoryId : null
  const categoryName = categoryId !== null ? searchParams.get('categoryName') : null

  // ref 가드로 정확히 한 번만 읽고 지운다 — React 18 StrictMode(dev)가 컴포넌트 본문을 두 번
  // 실행해도(부수효과 감지용) ref 객체 자체는 그대로 유지되므로 두 번째 실행에서는 이미 채워진
  // ref.current를 그대로 쓰고 sessionStorage를 다시 건드리지 않는다(그렇지 않으면 두 번째 실행이
  // 빈 스토리지를 읽어 초안을 잃는다).
  const draftRef = useRef<FormState | null | undefined>(undefined)
  if (draftRef.current === undefined) {
    draftRef.current = readAndClearDraft()
  }
  const initialDraft = draftRef.current ?? null

  return (
    <DocEditor
      variant="page"
      mode={editing ? 'edit' : 'create'}
      documentId={documentId}
      defaultType={defaultType}
      categoryId={categoryId}
      categoryName={categoryName}
      initialDraft={initialDraft}
      onClose={() => navigate(-1)}
      // 중요-1 수정: 저장 성공 후에는 문서 상세로만 이동한다(뒤로가기가 편집기로 돌아오지 않게
      // replace). onClose(navigate(-1))는 취소/닫기 전용 경로로 분리돼 있다(DocEditor 참조).
      onSaved={(saved) => navigate(`/docs/${saved.id}`, { replace: true })}
    />
  )
}
