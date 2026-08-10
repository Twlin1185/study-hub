import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import DocEditor from '../components/DocEditor'
import type { DocumentType } from '../api/types'

// 전용 라우트(창, stage-26 9-5) — 팝업 모달과 같은 DocEditor를 페이지로 렌더한다(저장·검증 공용).
// `/docs/new`(신규 작성, 쿼리 파라미터로 타입·분류 컨텍스트 유지) · `/docs/:id/edit`(기존 문서 수정).
const VALID_TYPES: DocumentType[] = ['concept', 'question', 'past_question', 'flashcard']

function isDocumentType(value: string | null): value is DocumentType {
  return value != null && (VALID_TYPES as string[]).includes(value)
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

  return (
    <DocEditor
      variant="page"
      mode={editing ? 'edit' : 'create'}
      documentId={documentId}
      defaultType={defaultType}
      categoryId={categoryId}
      categoryName={categoryName}
      onClose={() => navigate(-1)}
      // 중요-1 수정: 저장 성공 후에는 문서 상세로만 이동한다(뒤로가기가 편집기로 돌아오지 않게
      // replace). onClose(navigate(-1))는 취소/닫기 전용 경로로 분리돼 있다(DocEditor 참조).
      onSaved={(saved) => navigate(`/docs/${saved.id}`, { replace: true })}
    />
  )
}
