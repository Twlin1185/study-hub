// stage-31(M31) 판정용 스파이크 — BlockNote 가능성·한계 집중 분석의 실측 표면.
// 프로덕션 진입점 없음(URL 직접 진입 전용). 게이트 판정 후 폐기 가능해야 한다.
import {
  BlockNoteSchema,
  defaultInlineContentSpecs,
  defaultStyleSpecs,
  type PartialBlock,
} from '@blocknote/core'
import { useCreateBlockNote } from '@blocknote/react'
import { BlockNoteView } from '@blocknote/mantine'
import '@blocknote/mantine/style.css'
import './poc.css'
import { useRef, useState } from 'react'
import { useThemeStore } from '../../stores/theme'
import { highlightSpec, refChipSpec, spoilerSpec } from './specs'

const schema = BlockNoteSchema.create({
  styleSpecs: { ...defaultStyleSpecs, highlight: highlightSpec, spoiler: spoilerSpec },
  inlineContentSpecs: { ...defaultInlineContentSpecs, refChip: refChipSpec },
})

type PocBlock = PartialBlock<
  typeof schema.blockSchema,
  typeof schema.inlineContentSchema,
  typeof schema.styleSchema
>

// 장문 하네스 — 실사용 문서를 흉내 낸 혼합 블록(헤딩·중첩 목록·서식 문단·한글 장문)
function makeBlocks(n: number): PocBlock[] {
  const blocks: PocBlock[] = []
  for (let i = 0; i < n; i++) {
    if (i % 40 === 0) {
      blocks.push({
        type: 'heading',
        props: { level: ((i / 40) % 3) + 1 },
        content: `${i}절 — 대량 문서 반응성 실측용 헤딩`,
      } as PocBlock)
    } else if (i % 17 === 0) {
      blocks.push({
        type: 'bulletListItem',
        content: `중첩 목록 항목 ${i} — 들여쓰기 자식 포함`,
        children: [{ type: 'bulletListItem', content: `자식 항목 ${i}-1` } as PocBlock],
      } as PocBlock)
    } else if (i % 10 === 0) {
      blocks.push({
        type: 'paragraph',
        content: [
          { type: 'text', text: `문단 ${i} — `, styles: {} },
          { type: 'text', text: '형광펜 구간', styles: { highlight: 'yellow' } },
          { type: 'text', text: '과 ', styles: {} },
          { type: 'text', text: '숨김 구간', styles: { spoiler: true } },
          { type: 'text', text: '이 섞인 서식 문단이다. ', styles: {} },
          { type: 'refChip', props: { refType: 'doc', targetId: `${i}`, label: `참조 ${i}` } },
        ],
      } as PocBlock)
    } else {
      blocks.push({
        type: 'paragraph',
        content:
          `문단 ${i} — 기출문제 해설처럼 한 문단이 길게 이어지는 경우를 흉내 낸다. ` +
          '데이터베이스 정규화는 이상 현상을 제거하기 위해 릴레이션을 분해하는 과정이며, ' +
          '제1정규형부터 BCNF까지 단계적으로 함수 종속을 정리한다. 학습 모드에서는 이런 ' +
          '장문 해설 블록이 수백 개 이어지는 문서가 실제로 존재한다.',
      } as PocBlock)
    }
  }
  return blocks
}

const initialContent: PocBlock[] = [
  { type: 'heading', props: { level: 1 }, content: 'M31 스파이크 — BlockNote 판정 표면' } as PocBlock,
  {
    type: 'paragraph',
    content: [
      { type: 'text', text: '방언 커스텀 스펙 3종: ', styles: {} },
      { type: 'text', text: '형광펜(==)', styles: { highlight: 'yellow' } },
      { type: 'text', text: ' · ', styles: {} },
      { type: 'text', text: '스포일러(||) — 클릭해 공개', styles: { spoiler: true } },
      { type: 'text', text: ' · ', styles: {} },
      { type: 'refChip', props: { refType: 'doc', targetId: '42', label: '참조 문서 42' } },
    ],
  } as PocBlock,
  {
    type: 'bulletListItem',
    content: '중첩 블록 확인 — Tab으로 들여쓰기, 드래그 핸들로 재배열',
    children: [{ type: 'bulletListItem', content: '자식 항목 (드래그로 끌어 올려보기)' } as PocBlock],
  } as PocBlock,
  {
    type: 'table',
    content: {
      type: 'tableContent',
      rows: [
        { cells: ['구분', '자체 구현(A)', 'BlockNote(B)'] },
        { cells: ['undo', '자체 스택 필요', 'ProseMirror history'] },
        { cells: ['표 편집', '보류', '기본 내장'] },
      ],
    },
  } as PocBlock,
  { type: 'paragraph', content: '슬래시 메뉴는 새 줄에서 "/" 입력. 아래 IME 체크리스트로 한글 실측.' } as PocBlock,
]

export default function PocPage() {
  const mode = useThemeStore((s) => s.mode)
  const isDark =
    mode === 'dark' ||
    (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  const editor = useCreateBlockNote({ schema, initialContent })

  const [loadMs, setLoadMs] = useState<number | null>(null)
  const [blockCount, setBlockCount] = useState(initialContent.length)
  const [jsonKb, setJsonKb] = useState<number | null>(null)
  const [typeStats, setTypeStats] = useState<{ avg: number; max: number } | null>(null)
  const typeSamples = useRef<number[]>([])

  const loadDoc = (n: number) => {
    const blocks = makeBlocks(n)
    const t0 = performance.now()
    editor.replaceBlocks(editor.document, blocks)
    // 더블 rAF = 다음 페인트 완료 시점 근사
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        setLoadMs(Math.round(performance.now() - t0))
        setBlockCount(n)
        setJsonKb(Math.round(JSON.stringify(editor.document).length / 1024))
        typeSamples.current = []
        setTypeStats(null)
      }),
    )
  }

  // 타이핑 반응성: keydown → 다음 페인트까지의 지연(최근 60타 이동 평균·최대)
  const onKeyDownCapture = (e: React.KeyboardEvent) => {
    if (e.key.length !== 1 && e.key !== 'Enter' && e.key !== 'Backspace') return
    const t0 = performance.now()
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const s = typeSamples.current
        s.push(performance.now() - t0)
        if (s.length > 60) s.shift()
        const avg = s.reduce((a, b) => a + b, 0) / s.length
        setTypeStats({ avg: Math.round(avg * 10) / 10, max: Math.round(Math.max(...s)) })
      }),
    )
  }

  return (
    <div className="poc-page">
      <h1 style={{ fontSize: 18, fontWeight: 700 }}>
        에디터 v2 스파이크 (stage-31 · 판정용 — 프로덕션 미노출)
      </h1>
      <div className="poc-controls">
        <span>장문 하네스:</span>
        <button onClick={() => loadDoc(1000)}>1k 블록</button>
        <button onClick={() => loadDoc(3000)}>3k 블록</button>
        <button onClick={() => loadDoc(6000)}>6k 블록</button>
        <span style={{ width: 12 }} />
        <button onClick={() => editor.toggleStyles({ highlight: 'yellow' })}>형광펜</button>
        <button onClick={() => editor.toggleStyles({ spoiler: true })}>스포일러</button>
        <button
          onClick={() =>
            editor.insertInlineContent([
              { type: 'refChip', props: { refType: 'doc', targetId: '7', label: '참조 문서 7' } },
              ' ',
            ])
          }
        >
          참조 칩 삽입
        </button>
      </div>
      <div className="poc-stats">
        <span>블록 수: {blockCount.toLocaleString()}</span>
        {loadMs !== null && <span>로드(교체→페인트): {loadMs.toLocaleString()}ms</span>}
        {jsonKb !== null && <span>블록 JSON 크기: {jsonKb.toLocaleString()}KB</span>}
        {typeStats && (
          <span>
            타이핑 지연(키다운→페인트): 평균 {typeStats.avg}ms · 최대 {typeStats.max}ms
          </span>
        )}
      </div>
      <div className="poc-editor-frame" onKeyDownCapture={onKeyDownCapture}>
        <BlockNoteView editor={editor} theme={isDark ? 'dark' : 'light'} />
      </div>
      <div className="poc-ime-note">
        <b>한글 IME 실측 체크리스트 (R35·R31 — 실기기에서 확인)</b>
        <br />① 한글 연속 타이핑 후 <b>Enter</b> — 직전 음절이 사라지지 않는가 (알려진 이슈 1679)
        <br />② 새 줄에서 <b>/이미지</b> 처럼 한글로 슬래시 메뉴 필터 — 메뉴가 닫히지 않고 필터되는가
        <br />③ 조합 중(밑줄 상태) 형광펜 버튼 클릭 — 조합이 깨지지 않는가
        <br />④ 조합 중 blur(다른 곳 클릭) — 마지막 음절이 확정되는가
        <br />⑤ 폰(안드로이드 크롬): 백스페이스로 목록 항목 삭제, 음절 단위 삭제 동작
        <br />⑥ 3k 블록 로드 후 문서 중간에서 한글 타이핑 — 지연 체감 여부 (위 통계 참조)
      </div>
    </div>
  )
}
