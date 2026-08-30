// 에디터 v2 — 고정 열 다단 **정규화**(stage-41 2차 규약 A 불변식 ①~④)
//
// 변환기(mdastToBlocks)·어댑터(fromBlockNote)·편집기 훅이 **같은 함수**를 공유한다: 세 표면이
// 다른 규칙을 쓰면 저장·재열람에서 구조가 흔들린다(1차 교훈 — 규약 A "정규화 함수 1개").
//
// 이 파일은 **순수 함수만** 둔다 — 런타임 의존 0(`@blocknote/*` import 0 · DOM 접근 0). 편집기
// 훅이 "변경 없음"을 값싸게 판정할 수 있도록 **바뀐 것이 없으면 입력과 같은 객체 참조**를
// 돌려준다(불필요한 dispatch = 1차 프리즈의 원인이었다).
import { blockChildren } from './blocks'
import type { Block, ColumnBlock, ColumnsBlock } from './blocks'

/**
 * `column` 자식이 하나도 없을 때 `count` 표기를 보고 **새로 만드는** 단 수의 상한.
 * 정규 도메인은 2·3이고 유입 4·5단도 그대로 만든다 — 상한은 `n=99999` 같은 병적 입력이
 * 문서를 부풀리는 것만 막는다(그 경우에도 내용은 1단에 전부 살아 있어 손실 0이다).
 */
export const MAX_GENERATED_COLUMNS = 12

export interface ColumnsNormalizeOptions {
  /**
   * 새로 만드는 블록(빈 단·빈 문단)의 id 생성기. 기본값은 **컨테이너 id에서 파생한 결정적
   * 문자열**(`<id>~1`, `<id>~2` …)이고 이미 쓰인 id는 건너뛴다 — 순수 함수를 유지하려고
   * 난수·전역 카운터를 쓰지 않는다. 변환기는 자기 시퀀스(`b12`)를, 편집기는 엔진 id 생성기를
   * 넘겨 각자의 관례를 지킨다.
   */
  makeId?: () => string
}

function collectIds(blocks: Block[], into: Set<string>): void {
  for (const block of blocks) {
    into.add(block.id)
    collectIds(blockChildren(block), into)
  }
}

function derivedIdFactory(block: ColumnsBlock): () => string {
  const used = new Set<string>()
  collectIds([block], used)
  let n = 0
  return () => {
    let id = ''
    do {
      n += 1
      id = `${block.id}~${n}`
    } while (used.has(id))
    used.add(id)
    return id
  }
}

/** 새로 만드는 단의 기본 자식 — 빈 문단 1개(불변식 ③: 클릭으로 들어갈 자리). */
function emptyParagraph(id: string): Block {
  return { id, type: 'paragraph', content: [] }
}

/**
 * 고정 열 다단 컨테이너를 **정규 상태**로 만든다(stage-41 2차 규약 A · 결정 ④).
 *
 *  ① `children`은 전부 `column` — 아닌 자식은 **직전 `column`의 끝**으로 옮긴다
 *     (앞에 `column`이 없으면 **첫 `column`의 앞**으로. 1차 레거시 `:::columns{n=2}` + 평문
 *     자식이 이 경로로 1단에 모인다)
 *  ② `column`이 0개면 `count`개 만든다(내용은 1단으로) · **`count`는 `column` 수로 갱신**한다
 *     (children이 정본이고 `n=`은 표기다)
 *  ③ 각 `column.children`은 1개 이상(비었으면 빈 문단 삽입)
 *  ④ `column`의 부모가 `columns`가 아닌 경우의 해제는 **트리 순회**(`unwrapStrayColumns` /
 *     `normalizeColumnsTree`)가 맡는다 — 이 함수는 컨테이너 하나만 본다.
 *
 * `attrs`·`meta`·id는 손대지 않는다(값 보존). **바뀐 것이 없으면 입력 객체를 그대로** 돌려준다.
 */
export function normalizeColumnsBlock(
  block: ColumnsBlock,
  options?: ColumnsNormalizeOptions,
): ColumnsBlock {
  const source = block.children ?? []
  const cols: ColumnBlock[] = []
  const front: Block[] = []
  let changed = false
  // id 생성기는 **실제로 필요할 때만** 만든다(정규 상태 입력에서 트리 순회 비용 0).
  let idSource: (() => string) | undefined = options?.makeId
  const makeId = () => {
    if (!idSource) idSource = derivedIdFactory(block)
    return idSource()
  }

  // ① 비-column 자식 흡수
  for (const child of source) {
    if (child.type === 'column') {
      cols.push(child)
      continue
    }
    changed = true
    if (cols.length === 0) {
      front.push(child)
      continue
    }
    const last = cols[cols.length - 1]
    cols[cols.length - 1] = { ...last, children: [...(last.children ?? []), child] }
  }

  // ② column 0개 = 새로 만든다(내용은 1단). `count`가 수가 아니거나 없으면 **기본 2**
  // (스키마 기본값·파서의 `n` 결손 기본과 같은 값 — 편집기 계층 정규화와도 정렬).
  if (cols.length === 0) {
    const raw = Number(block.count)
    const want = Math.min(Math.max(Number.isFinite(raw) ? Math.trunc(raw) : 2, 1), MAX_GENERATED_COLUMNS)
    for (let i = 0; i < want; i += 1) {
      cols.push({ id: makeId(), type: 'column', children: i === 0 ? front.slice() : [] })
    }
    front.length = 0
    changed = true
  } else if (front.length > 0) {
    cols[0] = { ...cols[0], children: [...front, ...(cols[0].children ?? [])] }
    front.length = 0
  }

  // ③ 빈 단 = 빈 문단 1개
  for (let i = 0; i < cols.length; i += 1) {
    if ((cols[i].children ?? []).length === 0) {
      cols[i] = { ...cols[i], children: [emptyParagraph(makeId())] }
      changed = true
    }
  }

  if (!changed && cols.length === block.count) return block
  return { ...block, count: cols.length, children: cols }
}

function withChildren(block: Block, children: Block[]): Block {
  switch (block.type) {
    case 'quote':
    case 'callout':
    case 'columns':
    case 'column':
    case 'listItem':
      return { ...block, children }
    default:
      return block
  }
}

function walk(list: Block[], parentIsColumns: boolean, normalize: boolean): Block[] {
  const out: Block[] = []
  let changed = false
  for (const block of list) {
    // 불변식 ④ — `columns` 밖의 `column`은 **자식을 제자리에 승격**하고 사라진다
    // (엔진 기본 승격 동작·드래그·유입 JSON이 만들 수 있는 상태다).
    if (block.type === 'column' && !parentIsColumns) {
      out.push(...walk(block.children ?? [], false, normalize))
      changed = true
      continue
    }
    const kids = blockChildren(block)
    const nextKids = walk(kids, block.type === 'columns', normalize)
    let next: Block = nextKids === kids ? block : withChildren(block, nextKids)
    if (normalize && next.type === 'columns') next = normalizeColumnsBlock(next)
    if (next !== block) changed = true
    out.push(next)
  }
  return changed ? out : list
}

/**
 * 불변식 ④만 — 트리 전체에서 **부모가 `columns`가 아닌 `column`**을 해제한다(자식은 제자리 승격).
 * 바뀐 것이 없으면 입력 배열을 그대로 돌려준다.
 */
export function unwrapStrayColumns(blocks: Block[]): Block[] {
  return walk(blocks, false, false)
}

/**
 * 트리 전체 정규화 — 불변식 ④(해제) + 모든 `columns`에 `normalizeColumnsBlock`(①~③).
 * 저장 경로(어댑터 되읽기)와 편집기 정규화 훅이 쓰는 진입점이다. 바뀐 것이 없으면 입력 배열 그대로.
 */
export function normalizeColumnsTree(blocks: Block[]): Block[] {
  return walk(blocks, false, true)
}
