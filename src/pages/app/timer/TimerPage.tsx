import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Play, Square, SkipForward, Pause, Coffee, ChevronDown, ChevronLeft } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useTimer } from '@/hooks/useTimer'
import { useSession } from '@/hooks/useSession'
import { useTimerStore } from '@/store/timerStore'
import { CircularTimerRing } from '@/components/timer/CircularTimerRing'
import { TagSelector } from '@/components/timer/TagSelector'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { calcAcademicDailyGoal } from '@/lib/projectGoals'
import type { SessionType, Tag, Project } from '@/types/database'

const SESSION_LABELS: Record<SessionType, string> = {
  work: 'Tag:',
  short_break: 'Descanso corto',
  long_break: 'Descanso largo',
}

function formatTime(ms: number) {
  const total = Math.ceil(ms / 1000)
  const m = Math.floor(total / 60).toString().padStart(2, '0')
  const s = (total % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

function formatDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes === 0) return `${seconds}s`
  if (seconds === 0) return `${minutes}m`
  return `${minutes}m ${seconds}s`
}

type ProjectForTimer = Pick<Project, 'id' | 'name' | 'color' | 'type' | 'goal_hours' | 'exam_date' | 'default_tag_id'>

// Item 7: genera un "ding" con Web Audio API sin depender de archivos externos
function playCompletionSound() {
  const volume = parseFloat(localStorage.getItem('pomodoroSoundVolume') ?? '0.5')
  if (volume === 0) return
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.15)
    gain.gain.setValueAtTime(volume * 0.7, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.9)
    osc.start()
    osc.stop(ctx.currentTime + 0.9)
  } catch {
    // AudioContext no disponible o bloqueado por el browser
  }
}

export function TimerPage() {
  const { user } = useAuth()
  const { status, sessionType, remaining, totalMs, pausedRemainingMs, start, startBreakPaused, pause, resume, stop, stopAndSaveWorkSession, setSessionType } = useTimer()
  const { completeSession } = useSession()
  const { activeTagId, setActiveTag, activeProjectId, setActiveProject } = useTimerStore()

  // Derivados del estado del timer — declarados temprano para evitar TDZ en useEffect
  const isBreak = sessionType !== 'work'
  const isIdle = status === 'idle'
  const isPaused = status === 'paused'
  const isRunning = status === 'running'

  // MEJORA 1: persiste la duración personalizada del anillo entre recargas
  const [customWorkMin, setCustomWorkMin] = useState<number | null>(() => {
    const stored = localStorage.getItem('customWorkMin')
    return stored ? Number(stored) : null
  })
  const [showTagMenu, setShowTagMenu] = useState(false)
  const [showProjectMenu, setShowProjectMenu] = useState(false)
  const [stopDialogOpen, setStopDialogOpen] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [pageLoadedAt] = useState(() => Date.now())
  // Persiste en localStorage para mantener el estado al cambiar de pestaña
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    const stored = localStorage.getItem('timerSidebarOpen')
    return stored === null ? true : stored === 'true'
  })
  const tagMenuRef = useRef<HTMLDivElement>(null)
  const projectMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    localStorage.setItem('timerSidebarOpen', String(sidebarOpen))
  }, [sidebarOpen])

  useEffect(() => {
    if (customWorkMin !== null) {
      localStorage.setItem('customWorkMin', String(customWorkMin))
    } else {
      localStorage.removeItem('customWorkMin')
    }
  }, [customWorkMin])

  // Item 14: atajos de teclado Space (pausar/reanudar) y Escape (detener)
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault()
        if (isRunning) void pause()
        else if (isPaused) void resume()
      }
      if (e.code === 'Escape' && (isRunning || isPaused) && !isBreak) {
        setStopDialogOpen(true)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isRunning, isPaused, isBreak, pause, resume, stop])

  // Close tag menu when clicking outside
  useEffect(() => {
    if (!showTagMenu) return
    function onOutsideClick(e: MouseEvent) {
      if (tagMenuRef.current && !tagMenuRef.current.contains(e.target as Node)) {
        setShowTagMenu(false)
      }
    }
    document.addEventListener('mousedown', onOutsideClick)
    return () => document.removeEventListener('mousedown', onOutsideClick)
  }, [showTagMenu])

  // Close project menu when clicking outside
  useEffect(() => {
    if (!showProjectMenu) return
    function onOutsideClick(e: MouseEvent) {
      if (projectMenuRef.current && !projectMenuRef.current.contains(e.target as Node)) {
        setShowProjectMenu(false)
      }
    }
    document.addEventListener('mousedown', onOutsideClick)
    return () => document.removeEventListener('mousedown', onOutsideClick)
  }, [showProjectMenu])

  // Load timer config — Infinity porque solo cambia desde SettingsPage (que invalida la query)
  const { data: config } = useQuery({
    queryKey: ['timerConfig', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('timer_configs')
        .select('*')
        .eq('user_id', user!.id)
        .maybeSingle()
      return data ?? { work_min: 25, short_break_min: 5, long_break_min: 15, pomodoros_per_cycle: 4 }
    },
    enabled: !!user,
    staleTime: Infinity,
  })

  // Load tags — Infinity porque raramente cambian
  const { data: tags = [] } = useQuery({
    queryKey: ['tags', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('tags')
        .select('*')
        .order('is_default', { ascending: false })
        .order('name')
      return (data ?? []) as Tag[]
    },
    enabled: !!user,
    staleTime: Infinity,
  })

  // Active projects — key separada para no compartir cache con ProjectsPage
  const { data: projects = [] } = useQuery({
    queryKey: ['projects', 'timer', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('projects')
        .select('id, name, color, type, goal_hours, exam_date, default_tag_id')
        .eq('user_id', user!.id)
        .is('archived_at', null)
        .order('created_at', { ascending: false })
      return (data ?? []) as ProjectForTimer[]
    },
    enabled: !!user,
    staleTime: 30_000,
  })

  // Horas de hoy por proyecto — staleTime: 0 para reflejar cada sesión completada
  const { data: todayProjectHours = {} } = useQuery({
    queryKey: ['todayProjectHours', user?.id],
    queryFn: async () => {
      const startOfDay = new Date()
      startOfDay.setHours(0, 0, 0, 0)
      const { data } = await supabase
        .from('sessions')
        .select('project_id, duration_seconds')
        .eq('user_id', user!.id)
        .eq('session_type', 'work')
        .gte('started_at', startOfDay.toISOString())
        .not('project_id', 'is', null)
      const hours: Record<string, number> = {}
      for (const s of data ?? []) {
        if (s.project_id) hours[s.project_id] = (hours[s.project_id] ?? 0) + s.duration_seconds / 3600
      }
      return hours
    },
    enabled: !!user,
    staleTime: 0,
  })

  // Horas totales por proyecto — staleTime: 0 para reflejar cada sesión completada
  const { data: projectHours = {} } = useQuery({
    queryKey: ['projectHours', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('sessions')
        .select('project_id, duration_seconds')
        .eq('user_id', user!.id)
        .eq('session_type', 'work')
        .not('project_id', 'is', null)
      const hours: Record<string, number> = {}
      for (const s of data ?? []) {
        if (s.project_id) hours[s.project_id] = (hours[s.project_id] ?? 0) + s.duration_seconds / 3600
      }
      return hours
    },
    enabled: !!user,
    staleTime: 0,
  })

  // Today's completed work sessions
  const { data: todaySessions = [] } = useQuery({
    queryKey: ['sessions', 'today', user?.id],
    queryFn: async () => {
      const startOfDay = new Date()
      startOfDay.setHours(0, 0, 0, 0)
      const { data } = await supabase
        .from('sessions')
        .select('*, projects(name, color)')
        .eq('user_id', user!.id)
        .eq('session_type', 'work')
        .gte('started_at', startOfDay.toISOString())
        .order('started_at', { ascending: false })
        .limit(20)
      return data ?? []
    },
    enabled: !!user,
    staleTime: 0,
  })

  const todaySeconds = todaySessions.reduce((acc: number, s: { duration_seconds: number }) => acc + s.duration_seconds, 0)

  // Handle timer complete — sequenced to avoid setIdle() racing with startBreakPaused()
  useEffect(() => {
    if (status !== 'completed') return

    if (sessionType === 'work') {
      // BUG 1 fix: +1 porque todaySessions aún no incluye la sesión que acaba de completarse
      const isLong = (todaySessions.length + 1) % (config?.pomodoros_per_cycle ?? 4) === 0
      const breakType: 'short_break' | 'long_break' = isLong ? 'long_break' : 'short_break'
      const breakMin = isLong ? (config?.long_break_min ?? 15) : (config?.short_break_min ?? 5)

      ;(async () => {
        const saved = await completeSession()
        if (!saved) return
        // Item 7: sonido al completar
        playCompletionSound()
        // Item 2: notificación de browser si el permiso está concedido
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification('¡Pomodoro completado! 🍅', {
            body: isLong ? 'Tomá un descanso largo.' : 'Tomá un descanso corto.',
            icon: '/favicon.svg',
            silent: true,
          })
        }
        toast.success('¡Pomodoro completado! Tomá un descanso.')
        await startBreakPaused(breakMin * 60 * 1000, breakType)
      })()
    } else {
      playCompletionSound()
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification('¡Descanso terminado!', { body: 'Es hora de volver al trabajo.', silent: true })
      }
      toast.info('¡Descanso terminado!')
      setSessionType('work')
      void stop()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  function getWorkDurationMs() {
    const min = customWorkMin ?? config?.work_min ?? 25
    return min * 60 * 1000
  }

  function handleStart() {
    void start(getWorkDurationMs())
  }

  async function handleConfirmStop() {
    setStopping(true)
    const saved = await stopAndSaveWorkSession()
    setStopping(false)
    if (saved) setStopDialogOpen(false)
  }

  // Pills solo interactivos cuando el timer está detenido (idle)
  const pillLocked = !isIdle

  const displayMs = isIdle
    ? getWorkDurationMs()
    : isPaused
    ? (pausedRemainingMs ?? remaining)
    : remaining

  const workMin = customWorkMin ?? config?.work_min ?? 25
  const ringRemainingMs = isIdle ? 0 : (isPaused ? (pausedRemainingMs ?? remaining) : remaining)
  const stopSavedMs = Math.max(0, totalMs - ringRemainingMs)

  const selectedTag = tags.find((t: Tag) => t.id === activeTagId)
  const selectedProject = projects.find((p) => p.id === activeProjectId)

  // Inline styles for tinted pills when a selection is active
  const pillStyle = selectedTag
    ? { borderColor: selectedTag.color + '80', backgroundColor: selectedTag.color + '18' }
    : undefined

  const projectPillStyle = selectedProject
    ? { borderColor: selectedProject.color + '80', backgroundColor: selectedProject.color + '18' }
    : undefined

  // Proyectos con meta pendiente (académico: meta diaria; hobby: meta total sin alcanzar)
  const pendingProjects = projects
    .filter((p) => {
      if (!p.goal_hours) return false
      if (p.type === 'academic' && p.exam_date) {
        const dailyGoal = calcAcademicDailyGoal(p, projectHours[p.id] ?? 0, pageLoadedAt)
        if (dailyGoal === null) return false
        return (todayProjectHours[p.id] ?? 0) < dailyGoal.hoursPerDay
      }
      if (p.type === 'hobby') {
        // Mostrar proyectos hobby cuya meta total aún no se alcanzó
        return (projectHours[p.id] ?? 0) < p.goal_hours
      }
      return false
    })
    .map((p) => ({
      ...p,
      dailyGoal: calcAcademicDailyGoal(p, projectHours[p.id] ?? 0, pageLoadedAt)?.hoursPerDay ?? null,
      todayHours: todayProjectHours[p.id] ?? 0,
    }))

  // Sidebar content — reutilizado en desktop y mobile
  const sidebarContent = (
    <div className="space-y-4">
      {/* Sesiones de hoy */}
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Hoy</h2>
        <Badge variant="secondary">
          {Math.floor(todaySeconds / 3600)}h {Math.floor((todaySeconds % 3600) / 60)}m
        </Badge>
      </div>
      <Separator />
      {todaySessions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hay sesiones hoy todavía.</p>
      ) : (
        <ul className="space-y-2">
          {(todaySessions as Array<{
            id: string
            duration_seconds: number
            started_at: string
            projects: { name: string; color: string } | null
          }>).map((s) => (
            <li key={s.id} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                {s.projects && (
                  <span className="h-2 w-2 rounded-full" style={{ background: s.projects.color }} />
                )}
                <span className="text-muted-foreground">
                  {new Date(s.started_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                </span>
                {s.projects && <span className="font-medium">{s.projects.name}</span>}
              </div>
              <span className="tabular-nums text-muted-foreground">
                {Math.round(s.duration_seconds / 60)}m
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Objetivos diarios */}
      {pendingProjects.length > 0 && (
        <>
          <Separator />
          <h2 className="font-semibold">Objetivos diarios</h2>
          <div className="space-y-3">
            {pendingProjects.map((p) => {
              const totalHours = projectHours[p.id] ?? 0
              const progress = p.goal_hours
                ? Math.min(100, (totalHours / p.goal_hours) * 100)
                : null
              const hoursPerDay = p.dailyGoal

              return (
                <div key={p.id} className="rounded-xl border bg-card p-4 shadow-sm">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{ background: p.color }}
                    />
                    <span className="truncate text-sm font-semibold">{p.name}</span>
                  </div>
                  <div className="mt-1.5">
                    <Badge variant="outline" className="text-xs">
                      {p.type === 'academic' ? 'Académico' : 'Hobby'}
                    </Badge>
                  </div>
                  {hoursPerDay !== null && hoursPerDay > 0 && (
                    <p className="mt-2 text-xs font-medium text-amber-600">
                      {hoursPerDay.toFixed(1)} hs/día necesarias
                    </p>
                  )}
                  <div className="mt-2 space-y-1.5">
                    {progress !== null && <Progress value={progress} />}
                    <p className="text-xs text-muted-foreground">
                      {totalHours.toFixed(1)} hs completadas
                      {p.goal_hours != null && ` / ${p.goal_hours} hs meta`}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )

  return (
    <div className="flex h-full flex-col gap-6 p-6 md:flex-row overflow-hidden">

      {/* ── Timer panel ── */}
      <div className="flex flex-1 flex-col items-center justify-center gap-6">

        {/* Pills: Tag + Proyecto */}
        <div className="flex flex-wrap items-center justify-center gap-2">

          {/* Tag pill */}
          <div className="relative" ref={tagMenuRef}>
            <button
              onClick={() => !pillLocked && setShowTagMenu(v => !v)}
              style={pillStyle}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-all duration-200',
                isBreak
                  ? 'border-emerald-300/60 text-emerald-600 cursor-default'
                  : isRunning
                  ? 'cursor-default opacity-60'
                  : 'cursor-pointer hover:shadow-sm hover:scale-[1.02] active:scale-100',
                !pillLocked && !selectedTag && 'border-primary/30 text-primary',
                !pillLocked && selectedTag && 'text-foreground',
              )}
            >
              {isBreak && <Coffee className="h-3.5 w-3.5" />}
              <span>{SESSION_LABELS[sessionType]}</span>
              {!isBreak && (
                <>
                  <span className="text-muted-foreground/60">·</span>
                  {selectedTag ? (
                    <span className="font-semibold" style={{ color: selectedTag.color }}>
                      {selectedTag.name}
                    </span>
                  ) : (
                    <span className="text-muted-foreground/70 font-normal">Sin especificar</span>
                  )}
                </>
              )}
              {!isBreak && (
                <ChevronDown
                  className={cn(
                    'h-3.5 w-3.5 opacity-40 transition-transform duration-200',
                    showTagMenu && 'rotate-180 opacity-70',
                  )}
                />
              )}
            </button>

            {/* Tag popover */}
            {showTagMenu && !pillLocked && (
              <div className="animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 duration-150 absolute left-1/2 top-full z-20 mt-2 w-64 -translate-x-1/2 rounded-xl border bg-card p-3 shadow-lg">
                <p className="mb-2 text-xs font-medium text-muted-foreground">Categoría</p>
                {tags.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Sin etiquetas disponibles</p>
                ) : (
                  <TagSelector
                    tags={tags}
                    selectedTagId={activeTagId}
                    onChange={(id) => {
                      setActiveTag(id)
                      setShowTagMenu(false)
                    }}
                  />
                )}
              </div>
            )}
          </div>

          {/* Proyecto pill */}
          <div className="relative" ref={projectMenuRef}>
            <button
              onClick={() => !pillLocked && setShowProjectMenu(v => !v)}
              style={projectPillStyle}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-all duration-200',
                isBreak
                  ? 'border-transparent text-muted-foreground/40 cursor-default'
                  : isRunning
                  ? 'cursor-default opacity-60'
                  : 'cursor-pointer hover:shadow-sm hover:scale-[1.02] active:scale-100',
                !pillLocked && !selectedProject && 'border-primary/30 text-primary',
                !pillLocked && selectedProject && 'text-foreground',
              )}
            >
              <span>Proyecto:</span>
              <span className="text-muted-foreground/60">·</span>
              {selectedProject ? (
                <>
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: selectedProject.color }}
                  />
                  <span className="font-semibold" style={{ color: selectedProject.color }}>
                    {selectedProject.name}
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground/70 font-normal">Sin especificar</span>
              )}
              {!isBreak && (
                <ChevronDown
                  className={cn(
                    'h-3.5 w-3.5 opacity-40 transition-transform duration-200',
                    showProjectMenu && 'rotate-180 opacity-70',
                  )}
                />
              )}
            </button>

            {/* Proyecto popover */}
            {showProjectMenu && !pillLocked && (
              <div className="animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 duration-150 absolute left-1/2 top-full z-20 mt-2 w-64 -translate-x-1/2 rounded-xl border bg-card p-3 shadow-lg">
                <p className="mb-2 text-xs font-medium text-muted-foreground">Proyecto</p>
                {projects.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Sin proyectos activos</p>
                ) : (
                  <div className="flex flex-col gap-1">
                    <button
                      onClick={() => { setActiveProject(null, null); setShowProjectMenu(false) }}
                      className={cn(
                        'rounded-lg border px-3 py-1.5 text-left text-xs font-medium transition-all',
                        !activeProjectId
                          ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                          : 'bg-muted/40 border-transparent text-muted-foreground hover:bg-muted/70 hover:text-foreground',
                      )}
                    >
                      Sin proyecto
                    </button>
                    {projects.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          const isDeselecting = p.id === activeProjectId
                          setActiveProject(isDeselecting ? null : p.id, null)
                          // Item 4: auto-seleccionar tag por defecto del proyecto
                          if (!isDeselecting && p.default_tag_id) setActiveTag(p.default_tag_id)
                          setShowProjectMenu(false)
                        }}
                        className={cn(
                          'flex items-center gap-2 rounded-lg border px-3 py-1.5 text-left text-xs font-medium transition-all',
                          activeProjectId === p.id
                            ? 'border-transparent text-white shadow-sm'
                            : 'bg-muted/40 border-transparent text-muted-foreground hover:bg-muted/70 hover:text-foreground',
                        )}
                        style={
                          activeProjectId === p.id
                            ? { backgroundColor: p.color, borderColor: p.color }
                            : undefined
                        }
                      >
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{
                            background: activeProjectId === p.id ? 'rgba(255,255,255,0.7)' : p.color,
                          }}
                        />
                        {p.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

        </div>

        {/* Circular ring timer */}
        <CircularTimerRing
          totalMs={totalMs}
          remainingMs={ringRemainingMs}
          status={status}
          sessionType={sessionType}
          durationMin={workMin}
          onDurationChange={(min) => isIdle && !isBreak && setCustomWorkMin(min)}
          displayTime={formatTime(displayMs)}
        />

        {/* Controls */}
        <div className="flex gap-3">
          {isIdle && !isBreak && (
            <Button size="lg" onClick={handleStart} className="gap-2">
              <Play className="h-5 w-5" /> Iniciar
            </Button>
          )}

          {isPaused && isBreak && (
            <>
              <Button size="lg" onClick={() => void resume()} className="gap-2 bg-emerald-600 hover:bg-emerald-700">
                <Play className="h-5 w-5" /> Iniciar descanso
              </Button>
              <Button size="lg" variant="outline" onClick={() => { setSessionType('work'); void stop() }} className="gap-2">
                <SkipForward className="h-5 w-5" /> Saltar
              </Button>
            </>
          )}

          {isRunning && isBreak && (
            <>
              <Button size="lg" variant="secondary" onClick={() => void pause()} className="gap-2">
                <Pause className="h-5 w-5" /> Pausar
              </Button>
              <Button size="lg" variant="outline" onClick={() => { setSessionType('work'); void stop() }} className="gap-2">
                <SkipForward className="h-5 w-5" /> Saltar
              </Button>
            </>
          )}

          {isPaused && !isBreak && (
            <>
              <Button size="lg" onClick={() => void resume()} className="gap-2">
                <Play className="h-5 w-5" /> Reanudar
              </Button>
              <Button size="lg" variant="destructive" onClick={() => setStopDialogOpen(true)} className="gap-2">
                <Square className="h-5 w-5" /> Detener
              </Button>
            </>
          )}

          {isRunning && !isBreak && (
            <>
              <Button size="lg" variant="secondary" onClick={() => void pause()} className="gap-2">
                <Pause className="h-5 w-5" /> Pausar
              </Button>
              <Button size="lg" variant="destructive" onClick={() => setStopDialogOpen(true)} className="gap-2">
                <Square className="h-5 w-5" /> Detener
              </Button>
            </>
          )}
        </div>

        {isIdle && !isBreak && (
          <p className="text-xs text-muted-foreground">
            Estas listo para una sesion mas?
          </p>
        )}
      </div>

      {/* ── Sidebar colapsable (desktop) ── */}
      <div className="hidden md:flex items-stretch">
        <div className="flex items-center">
          <button
            onClick={() => setSidebarOpen(v => !v)}
            title={sidebarOpen ? 'Ocultar historial' : 'Mostrar historial'}
            className="flex h-10 w-5 items-center justify-center rounded-l-md border-y border-l bg-card/80 shadow-sm hover:bg-accent transition-colors"
          >
            <ChevronLeft
              className={cn(
                'h-3.5 w-3.5 text-muted-foreground transition-transform duration-300',
                !sidebarOpen && 'rotate-180',
              )}
            />
          </button>
        </div>

        <div
          className={cn(
            'overflow-hidden transition-all duration-300 ease-in-out',
            sidebarOpen ? 'w-72 opacity-100' : 'w-0 opacity-0',
          )}
        >
          <div className="w-72 border-l pl-5">
            {sidebarContent}
          </div>
        </div>
      </div>

      {/* ── Sidebar mobile ── */}
      <div className="md:hidden w-full">
        {sidebarContent}
      </div>

      <Dialog open={stopDialogOpen} onOpenChange={setStopDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Guardar progreso y detener?</DialogTitle>
            <DialogDescription>
              {stopSavedMs >= 1000
                ? `Se guardará una sesión de ${formatDuration(stopSavedMs)} como tiempo trabajado.`
                : 'Aún no hay tiempo suficiente para guardar. El timer se detendrá sin registrar sesión.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStopDialogOpen(false)} disabled={stopping}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={() => void handleConfirmStop()} disabled={stopping}>
              {stopping ? 'Guardando...' : stopSavedMs >= 1000 ? 'Guardar y detener' : 'Detener sin guardar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}
