import { Route, useRoute } from './components/router.tsx';
import { Shell } from './components/Shell.tsx';
import { AppearanceProvider, AuthProvider, ToastProvider, useAuth } from './state/app.tsx';
import { Spinner } from './components/ui.tsx';
import { LoginPage } from './pages/Login.tsx';
import { DashboardPage } from './pages/Dashboard.tsx';
import { LibraryPage } from './pages/Library.tsx';
import { ReaderPage } from './pages/Reader.tsx';
import { ChatPage } from './pages/Chat.tsx';
import { NotesPage } from './pages/Notes.tsx';
import { ReviewPage } from './pages/Review.tsx';
import { QuizzesPage } from './pages/Quizzes.tsx';
import { PlannerPage } from './pages/Planner.tsx';
import { FocusPage } from './pages/Focus.tsx';
import { StatsPage } from './pages/Stats.tsx';
import { JobsPage } from './pages/Jobs.tsx';
import { SettingsPage } from './pages/Settings.tsx';

function Routes() {
  const { path } = useRoute();
  return (
    <Shell>
      <Route pattern="/" path={path} render={() => <DashboardPage />} />
      <Route pattern="/library" path={path} render={() => <LibraryPage />} />
      <Route pattern="/library/:id" path={path} render={(p) => <ReaderPage documentId={p.id!} />} />
      <Route pattern="/tutor" path={path} render={() => <ChatPage kind="tutor" />} />
      <Route pattern="/tutor/:id" path={path} render={(p) => <ChatPage kind="tutor" conversationId={p.id!} />} />
      <Route pattern="/chat" path={path} render={() => <ChatPage kind="chat" />} />
      <Route pattern="/chat/:id" path={path} render={(p) => <ChatPage kind="chat" conversationId={p.id!} />} />
      <Route pattern="/notes" path={path} render={() => <NotesPage />} />
      <Route pattern="/notes/:id" path={path} render={(p) => <NotesPage selectedId={p.id!} />} />
      <Route pattern="/review" path={path} render={() => <ReviewPage />} />
      <Route pattern="/quizzes" path={path} render={() => <QuizzesPage />} />
      <Route pattern="/planner" path={path} render={() => <PlannerPage />} />
      <Route pattern="/focus" path={path} render={() => <FocusPage />} />
      <Route pattern="/stats" path={path} render={() => <StatsPage />} />
      <Route pattern="/jobs" path={path} render={() => <JobsPage />} />
      <Route pattern="/settings" path={path} render={() => <SettingsPage />} />
    </Shell>
  );
}

function Gate() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner label="Starting Lumen…" />;
  if (!user) return <LoginPage />;
  return <Routes />;
}

export function App() {
  return (
    <AuthProvider>
      <AppearanceProvider>
        <ToastProvider>
          <Gate />
        </ToastProvider>
      </AppearanceProvider>
    </AuthProvider>
  );
}
