import type { ReactNode } from 'react'
import {
  DOC_BG_CLASS,
  DOC_BG_LABEL,
  DOC_BG_OPTIONS,
  DOC_FONT_LABEL,
  DOC_FONT_OPTIONS,
  DOC_SIZE_LABEL,
  DOC_SIZE_OPTIONS,
} from '../utils/docStyle'
import type { DocumentStyle } from '../api/types'

interface DocStyleFieldsProps {
  value: DocumentStyle | null
  onChange: (next: DocumentStyle | null) => void
}

function setKey<K extends keyof DocumentStyle>(
  value: DocumentStyle | null,
  key: K,
  v: DocumentStyle[K] | undefined,
): DocumentStyle | null {
  const next: DocumentStyle = { ...(value ?? {}) }
  if (v === undefined) delete next[key]
  else next[key] = v
  return Object.keys(next).length > 0 ? next : null
}

function PillButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
        active ? 'border-accent bg-accent-soft text-accent' : 'border-border text-primary hover:bg-bg'
      }`}
    >
      {children}
    </button>
  )
}

// 문서별 스타일 폼(F53 ②, 설계 §4.26 ①·screens §5.3 S28) — DocEditor(편집 모드)·문서 상세
// 양쪽에서 재사용하는 공용 서브컴포넌트. 각 항목 "전역 따름" + 화이트리스트 값 선택 + 부분
// 지정·개별 해제. 저장은 호출부가 documents PATCH `style`로 처리한다(이 컴포넌트는 상태만 다룸).
export default function DocStyleFields({ value, onChange }: DocStyleFieldsProps) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="mb-1 text-xs font-semibold text-primary">폰트</p>
        <div className="flex flex-wrap gap-1.5">
          <PillButton active={!value?.font} onClick={() => onChange(setKey(value, 'font', undefined))}>
            전역 따름
          </PillButton>
          {DOC_FONT_OPTIONS.map((f) => (
            <PillButton key={f} active={value?.font === f} onClick={() => onChange(setKey(value, 'font', f))}>
              {DOC_FONT_LABEL[f]}
            </PillButton>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1 text-xs font-semibold text-primary">글자 크기</p>
        <div className="flex flex-wrap gap-1.5">
          <PillButton active={!value?.size} onClick={() => onChange(setKey(value, 'size', undefined))}>
            전역 따름
          </PillButton>
          {DOC_SIZE_OPTIONS.map((s) => (
            <PillButton key={s} active={value?.size === s} onClick={() => onChange(setKey(value, 'size', s))}>
              {DOC_SIZE_LABEL[s]}
            </PillButton>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1 text-xs font-semibold text-primary">배경</p>
        <div className="flex flex-wrap gap-1.5">
          <PillButton active={!value?.bg} onClick={() => onChange(setKey(value, 'bg', undefined))}>
            전역 따름
          </PillButton>
          {DOC_BG_OPTIONS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onChange(setKey(value, 'bg', c))}
              aria-pressed={value?.bg === c}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                value?.bg === c ? 'border-accent text-accent' : 'border-border text-primary hover:bg-bg'
              }`}
            >
              <span className={`h-3 w-3 rounded-full border border-border ${DOC_BG_CLASS[c]}`} aria-hidden />
              {DOC_BG_LABEL[c]}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
