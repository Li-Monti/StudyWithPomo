import { useState, useEffect } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { Timer, FolderOpen, BarChart2, Users, Settings, LogOut, Loader2, WifiOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'

const navItems = [
  { to: '/app/timer', icon: Timer, label: 'Timer' },
  { to: '/app/projects', icon: FolderOpen, label: 'Proyectos' },
  { to: '/app/stats', icon: BarChart2, label: 'Estadísticas' },
  { to: '/app/social', icon: Users, label: 'Social' },
  { to: '/app/settings', icon: Settings, label: 'Ajustes' },
]

export function AppShell() {
  const navigate = useNavigate()
  const [loggingOut, setLoggingOut] = useState(false)
  const [isOnline, setIsOnline] = useState(navigator.onLine)

  // Item 12: detectar pérdida/recuperación de conexión
  useEffect(() => {
    const setOnline = () => setIsOnline(true)
    const setOffline = () => setIsOnline(false)
    window.addEventListener('online', setOnline)
    window.addEventListener('offline', setOffline)
    return () => {
      window.removeEventListener('online', setOnline)
      window.removeEventListener('offline', setOffline)
    }
  }, [])

  // Item 11: loading state para evitar doble-click en logout
  async function handleLogout() {
    setLoggingOut(true)
    await supabase.auth.signOut()
    navigate('/login')
  }

  return (
    <div className="flex h-screen bg-background">
      <aside className="flex w-16 flex-col items-center gap-2 border-r bg-card py-4 md:w-56 md:items-start md:px-3">
        <div className="mb-4 flex items-center gap-2 px-2">
          <Timer className="h-6 w-6 text-primary" />
          <span className="hidden text-lg font-semibold md:block">Pomo</span>
        </div>

        {/* Item 12: banner de sin conexión */}
        {!isOnline && (
          <div className="mx-1 mb-1 flex w-full items-center gap-1.5 rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">
            <WifiOff className="h-3 w-3 shrink-0" />
            <span className="hidden md:block">Sin conexión</span>
          </div>
        )}

        <nav className="flex flex-1 flex-col gap-1 w-full">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-2 py-2 text-sm font-medium transition-colors',
                  'hover:bg-accent hover:text-accent-foreground',
                  isActive
                    ? 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground'
                    : 'text-muted-foreground',
                )
              }
            >
              <Icon className="h-5 w-5 shrink-0" />
              <span className="hidden md:block">{label}</span>
            </NavLink>
          ))}
        </nav>

        <Button
          variant="ghost"
          size="sm"
          className="mt-auto flex w-full items-center gap-3 justify-start text-muted-foreground"
          onClick={handleLogout}
          disabled={loggingOut}
        >
          {loggingOut
            ? <Loader2 className="h-5 w-5 shrink-0 animate-spin" />
            : <LogOut className="h-5 w-5 shrink-0" />}
          <span className="hidden md:block">{loggingOut ? 'Saliendo...' : 'Salir'}</span>
        </Button>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
