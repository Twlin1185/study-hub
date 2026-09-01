import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import { useApplyThemeCustom } from './hooks/useApplyThemeCustom'
import HomePage from './pages/Home'
import ExplorePage from './pages/Explore'
import DocumentDetailPage from './pages/DocumentDetail'
import DocEditPage from './pages/DocEditPage'
import SettingsPage from './pages/Settings'
import ImportPage from './pages/Import'
import CurriculumPage from './pages/Curriculum'
import CurriculumDetailPage from './pages/CurriculumDetail'
import QuizPage from './pages/Quiz'
import QuizRunPage from './pages/QuizRun'
import ExamPage from './pages/Exam'
import ExamRunPage from './pages/ExamRun'
import ReviewNotesPage from './pages/ReviewNotes'
import ReviewPage from './pages/Review'
import FlashcardsPage from './pages/Flashcards'
import StudyPage from './pages/Study'
import PrintPage from './pages/Print'
import SearchPage from './pages/Search'
import SuggestionsPage from './pages/Suggestions'

// stage-31(M31) 판정용 스파이크 — 지연 로드 청크로 분리(초기 번들 무영향, R32-c), URL 직접 진입 전용
const Editor2PocPage = lazy(() => import('./editor2/poc/PocPage'))

// 노트 — 에디터 v2 착지 표면(S33, §5.16 · stage-43 G-2 정식 승격). 편집기·Mantine 번들이 초기
// 청크에 섞이지 않도록 **지연 청크**로만 둔다(R37 — 초기 청크 증가 ≤ 5KB). 진입은 데스크톱
// 사이드바 · 모바일 좌측 드로어 '노트' 항목(`Layout.tsx`) + 직접 URL.
const NoteListPage = lazy(() => import('./editor2/pages/NoteListPage'))
const NoteEditPage = lazy(() => import('./editor2/pages/NoteEditPage'))

function App() {
  // 전역 테마 커스텀 주입(S28 — F53 ①, 설계 §4.26 ③·§7) — 신규 스토어 없음, App 최상단 1회.
  useApplyThemeCustom()
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/explore" element={<ExplorePage />} />
        <Route path="/curriculum" element={<CurriculumPage />} />
        <Route path="/curriculum/:id" element={<CurriculumDetailPage />} />
        <Route path="/quiz" element={<QuizPage />} />
        <Route path="/quiz/run" element={<QuizRunPage />} />
        <Route path="/exam" element={<ExamPage />} />
        <Route path="/exam/run" element={<ExamRunPage />} />
        <Route path="/review" element={<ReviewPage />} />
        <Route path="/flashcards" element={<FlashcardsPage />} />
        <Route path="/review-notes" element={<ReviewNotesPage />} />
        <Route path="/study/:categoryId" element={<StudyPage />} />
        <Route path="/docs/:id" element={<DocumentDetailPage />} />
        {/* 편집기 "창으로 열기"(stage-26 9-5) — 팝업과 같은 DocEditor를 전용 라우트로. */}
        <Route path="/docs/new" element={<DocEditPage />} />
        <Route path="/docs/:id/edit" element={<DocEditPage />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/print" element={<PrintPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/suggestions" element={<SuggestionsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route
          path="/notes"
          element={
            <Suspense fallback={null}>
              <NoteListPage />
            </Suspense>
          }
        />
        <Route
          path="/notes/:id"
          element={
            <Suspense fallback={null}>
              <NoteEditPage />
            </Suspense>
          }
        />
        <Route
          path="/editor2-poc"
          element={
            <Suspense fallback={null}>
              <Editor2PocPage />
            </Suspense>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}

export default App
