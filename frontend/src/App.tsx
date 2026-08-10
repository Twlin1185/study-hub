import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
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

function App() {
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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}

export default App
