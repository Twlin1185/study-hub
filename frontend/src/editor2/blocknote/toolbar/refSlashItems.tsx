// 슬래시 메뉴 **참조 3항목**(규약 A ① 진입) — 기본 항목에 **덧붙이기만** 한다.
//
// 기본 항목을 제거·재배치하지 않는다: "슬래시 메뉴 전면 커스터마이즈"는 M35 범위이고,
// 이 단계에서 손대면 기본 블록 삽입 경로가 조용히 좁아진다(스키마가 이미 팔레트를 좁혀 두었다).
import type { DefaultReactSuggestionItem } from '@blocknote/react'
import type { RefKind } from '../refPicker/RefTitleContext'

const GROUP = '참조'

export function refSlashItems(openPicker: (mode: RefKind) => void): DefaultReactSuggestionItem[] {
  return [
    {
      title: '참조',
      subtext: '문서 링크 칩을 넣습니다',
      aliases: ['ref', 'link', 'doc', '문서', '링크', '칩'],
      group: GROUP,
      onItemClick: () => openPicker('doc'),
    },
    {
      title: '임베드',
      subtext: '문서 임베드 블록을 넣습니다',
      aliases: ['embed', '문서임베드', '삽입'],
      group: GROUP,
      onItemClick: () => openPicker('embed'),
    },
    {
      title: '앵커',
      subtext: '이 노트의 제목(heading)으로 가는 칩을 넣습니다',
      aliases: ['anchor', '절', '제목', '목차'],
      group: GROUP,
      onItemClick: () => openPicker('anchor'),
    },
  ]
}
