import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import HomePage from './pages/Home'
import ExplorePage from './pages/Explore'
import DocumentDetailPage from './pages/DocumentDetail'
import SettingsPage from './pages/Settings'
import ImportPage from './pages/Import'
import CurriculumPage from './pages/Curriculum'
import CurriculumDetailPage from './pages/CurriculumDetail'
import QuizPage from './pages/Quiz'
import QuizRunPage from './pages/QuizRun'
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
        <Route path="/review" element={<ReviewPage />} />
        <Route path="/flashcards" element={<FlashcardsPage />} />
        <Route path="/review-notes" element={<ReviewNotesPage />} />
        <Route path="/study/:categoryId" element={<StudyPage />} />
        <Route path="/docs/:id" element={<DocumentDetailPage />} />
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
