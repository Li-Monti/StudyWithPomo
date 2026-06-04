import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { AppShell } from '@/components/layout/AppShell'
import { LoginPage } from '@/pages/auth/LoginPage'
import { SignupPage } from '@/pages/auth/SignupPage'

const TimerPage = lazy(() => import('@/pages/app/timer/TimerPage').then(m => ({ default: m.TimerPage })))
const ProjectsPage = lazy(() => import('@/pages/app/projects/ProjectsPage').then(m => ({ default: m.ProjectsPage })))
const ProjectDetailPage = lazy(() => import('@/pages/app/projects/ProjectDetailPage').then(m => ({ default: m.ProjectDetailPage })))
const StatsPage = lazy(() => import('@/pages/app/stats/StatsPage').then(m => ({ default: m.StatsPage })))
const SocialPage = lazy(() => import('@/pages/app/social/SocialPage').then(m => ({ default: m.SocialPage })))
const StudyGroupPage = lazy(() => import('@/pages/app/social/StudyGroupPage').then(m => ({ default: m.StudyGroupPage })))
const SettingsPage = lazy(() => import('@/pages/app/settings/SettingsPage').then(m => ({ default: m.SettingsPage })))

const PAGE_FALLBACK = (
  <div className="flex h-full items-center justify-center text-muted-foreground">
    Cargando...
  </div>
)

// Item 3: redirige usuarios ya logueados a su destino original (deep-link)
function AuthRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const location = useLocation()
  if (!user) return <>{children}</>
  const from = (location.state as { from?: string })?.from
  return <Navigate to={from ?? '/app/timer'} replace />
}

// Item 3: guarda la ruta intentada para redirigir después del login
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <div className="flex h-screen items-center justify-center text-muted-foreground">Cargando...</div>
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />
  return <>{children}</>
}

export default function App() {
  const { user, loading } = useAuth()

  if (loading) return <div className="flex h-screen items-center justify-center text-muted-foreground">Cargando...</div>

  return (
    <Routes>
      <Route path="/login" element={<AuthRoute><LoginPage /></AuthRoute>} />
      <Route path="/signup" element={<AuthRoute><SignupPage /></AuthRoute>} />

      <Route path="/app" element={
        <ProtectedRoute>
          <AppShell />
        </ProtectedRoute>
      }>
        <Route index element={<Navigate to="timer" replace />} />
        <Route path="timer" element={<Suspense fallback={PAGE_FALLBACK}><TimerPage /></Suspense>} />
        <Route path="projects" element={<Suspense fallback={PAGE_FALLBACK}><ProjectsPage /></Suspense>} />
        <Route path="projects/:id" element={<Suspense fallback={PAGE_FALLBACK}><ProjectDetailPage /></Suspense>} />
        <Route path="stats" element={<Suspense fallback={PAGE_FALLBACK}><StatsPage /></Suspense>} />
        <Route path="social" element={<Suspense fallback={PAGE_FALLBACK}><SocialPage /></Suspense>} />
        <Route path="social/groups/:id" element={<Suspense fallback={PAGE_FALLBACK}><StudyGroupPage /></Suspense>} />
        <Route path="settings" element={<Suspense fallback={PAGE_FALLBACK}><SettingsPage /></Suspense>} />
      </Route>

      <Route path="*" element={<Navigate to={user ? '/app/timer' : '/login'} replace />} />
    </Routes>
  )
}
