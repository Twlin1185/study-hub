// 노트 편집 표면의 **방언 UI 진입점 2개**(stage-34 Phase 2-B).
//
//   <RefUiProvider editor={editor}>            ← BlockNoteView **바깥**(칩 노드 뷰가 컨텍스트를 구독)
//     <BlockNoteView … formattingToolbar={false} slashMenu={false}>
//       <NoteEditorDialectUI />                ← BlockNoteView **children**
//     </BlockNoteView>
//   </RefUiProvider>
//
// 나머지 기본 UI(사이드 메뉴·드래그 핸들·링크 툴바·표 핸들·이모지)는 그대로 켜져 있다.
export { default as RefUiProvider } from './refPicker/RefUiProvider'
export { default as NoteEditorDialectUI } from './NoteEditorDialectUI'
