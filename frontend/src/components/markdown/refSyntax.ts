// 참조 문법 상수·정규식·자리표시자 문구 (설계 §4.19 ①④⑤ 확정본 — 문구를 그대로 상수화).
// 이 파일은 렌더러(MarkdownView)와 편집 도우미(DocEditor)가 함께 참조하는 단일 출처다.
import GithubSlugger from 'github-slugger'

export type RefKind = 'embed' | 'link' | 'anchor'

export interface ParsedRef {
  kind: RefKind
  // embed·link = doc_no ("DOC-0012") / anchor = 헤딩 텍스트("절 제목")
  target: string
  // `|별칭` — 표시 전용. 참조 키는 항상 target.
  alias: string
}

// §4.19 ① 정규식 3종을 하나의 스캐너로 합친다. **임베드 대안이 먼저**여야
// `![[…]]`가 링크 칩으로 잘못 매칭되지 않는다(`!`를 임베드 대안이 먼저 소비).
// doc_no = DOC-\d{4,} (대소문자 구분 — 소문자 doc- 불인정).
export const REF_SCAN_RE =
  /!\[\[(DOC-\d{4,})(?:\|([^\]|\n]+))?\]\]|\[\[(DOC-\d{4,})(?:\|([^\]|\n]+))?\]\]|\[\[#([^\]|\n]+)(?:\|([^\]|\n]+))?\]\]/g

// 정규식 매치 → ParsedRef. 매치 그룹 순서는 REF_SCAN_RE 대안 순서와 1:1.
export function parseRefMatch(m: RegExpExecArray): ParsedRef | null {
  if (m[1]) return { kind: 'embed', target: m[1], alias: (m[2] ?? '').trim() }
  if (m[3]) return { kind: 'link', target: m[3], alias: (m[4] ?? '').trim() }
  if (m[5]) return { kind: 'anchor', target: m[5].trim(), alias: (m[6] ?? '').trim() }
  return null
}

// 해석 요청(doc_no 수집)은 본문 정규식 스캔이 아니라 **렌더된 참조 노드**가 각자 요청하고
// embedResolver가 마이크로태스크 단위로 묶는다 — 코드 블록 안 참조까지 긁어오는 본문 스캔 경로는
// 두지 않는다(§4.19 ① 코드 블록 제외 원칙과 어긋나므로 의도적으로 없음).

// ---- 임베드 깊이 (§4.19 ④) ----
// 루트 본문 = 깊이 0, 임베드 = 1, 임베드 안 임베드 = 2까지 펼침. 3부터 자리표시자.
export const MAX_EMBED_DEPTH = 2

// ---- directive 기본 라벨 (§4.19 ②) ----
export const FOLD_DEFAULT_LABEL = '접힌 구간'
export const HIDE_DEFAULT_LABEL = '가려진 내용'

// ---- 자리표시자 4종 확정 문구 (§4.19 ④ 표) ----
// 링크 칩의 부재·삭제 툴팁에도 같은 문구를 재사용한다.
export function cyclePlaceholder(docNo: string): string {
  return `순환 참조 — ${docNo}는 이미 펼쳐져 있습니다`
}

export function deletedPlaceholder(docNo: string, title?: string | null): string {
  const label = title ? `${docNo} · ${title}` : docNo
  return `삭제된 문서 (${label}) — 내용은 표시되지 않습니다. 복원하면 다시 보입니다`
}

export function missingPlaceholder(docNo: string): string {
  return `존재하지 않는 참조 (${docNo})`
}

export function depthPlaceholder(docNo: string, title?: string | null): string {
  const label = title ? `${docNo} · ${title}` : docNo
  return `깊이 제한(${MAX_EMBED_DEPTH}단)으로 펼치지 않은 문서 (${label})`
}

// ---- 헤딩 슬러그 (§4.19 ⑤) ----
// 헤딩 id 부여는 rehype-slug(내부 github-slugger), `[[#…]]` 매칭은 **같은 github-slugger**로
// 슬러그화해 비교한다(규칙 이원화 금지). 새 slugger 인스턴스를 쓰므로 중복 접미(-1,-2)는 붙지
// 않고 항상 "첫 번째 동일 제목 헤딩"을 가리킨다.
export function slugifyHeading(text: string): string {
  return new GithubSlugger().slug(text)
}
