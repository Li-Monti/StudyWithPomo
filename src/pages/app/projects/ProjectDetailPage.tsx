import { useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CheckCircle2, Circle, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { Project, Task, Session } from '@/types/database'

const HISTORY_PAGE = 50

type SessionWithTag = Session & {
  tags: { name: string; color: string } | null
}

function calcHoursPerDay(project: Project, completedHours: number, nowMs: number): { hoursPerDay: number; daysLeft: number } | null {
  if (project.type !== 'academic' || !project.exam_date || !project.goal_hours) return null
  const daysLeft = Math.ceil(
    (new Date(project.exam_date).getTime() - nowMs) / 86_400_000,
  )
  if (daysLeft <= 0) return null
  const remaining = project.goal_hours - completedHours
  if (remaining <= 0) return null
  return { hoursPerDay: remaining / daysLeft, daysLeft }
}

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [savingTask, setSavingTask] = useState(false)
  // Item 1: confirmación antes de eliminar tarea
  const [deleteTaskTarget, setDeleteTaskTarget] = useState<Task | null>(null)
  const [deletingTask, setDeletingTask] = useState(false)
  // Item 13: paginación del historial
  const [displayLimit, setDisplayLimit] = useState(HISTORY_PAGE)
  const [pageLoadedAt] = useState(() => Date.now())

  const { data: project, isLoading: loadingProject } = useQuery({
    queryKey: ['project', id],
    queryFn: async () => {
      const { data } = await supabase
        .from('projects')
        .select('*')
        .eq('id', id!)
        .maybeSingle()
      return data as Project | null
    },
    enabled: !!id,
    staleTime: 30_000,
  })

  const { data: tasks = [] } = useQuery({
    queryKey: ['tasks', id],
    queryFn: async () => {
      const { data } = await supabase
        .from('tasks')
        .select('*')
        .eq('project_id', id!)
        .order('created_at', { ascending: true })
      return (data ?? []) as Task[]
    },
    enabled: !!id,
    staleTime: 30_000,
  })

  const { data: allSessions = [] } = useQuery({
    queryKey: ['projectSessions', id],
    queryFn: async () => {
      const { data } = await supabase
        .from('sessions')
        .select('id, duration_seconds, started_at, tags(name, color)')
        .eq('project_id', id!)
        .eq('session_type', 'work')
        .order('started_at', { ascending: false })
      return (data ?? []) as unknown as SessionWithTag[]
    },
    enabled: !!id,
    staleTime: 0,
  })

  const totalHours = useMemo(
    () => allSessions.reduce((acc, s) => acc + s.duration_seconds, 0) / 3600,
    [allSessions],
  )

  const sessionsThisWeek = useMemo(() => {
    const sevenDaysAgo = pageLoadedAt - 7 * 24 * 60 * 60 * 1000
    return allSessions.filter((s) => new Date(s.started_at).getTime() >= sevenDaysAgo).length
  }, [allSessions, pageLoadedAt])

  const sessions = useMemo(() => allSessions.slice(0, displayLimit), [allSessions, displayLimit])

  const academicBanner = useMemo(
    () => (project ? calcHoursPerDay(project, totalHours, pageLoadedAt) : null),
    [project, totalHours, pageLoadedAt],
  )

  const pendingTasks = useMemo(() => tasks.filter((t) => !t.completed_at), [tasks])
  const completedTasks = useMemo(() => tasks.filter((t) => t.completed_at), [tasks])

  async function handleCreateTask(e: React.FormEvent) {
    e.preventDefault()
    if (!newTaskTitle.trim() || !user || !id) return
    setSavingTask(true)
    try {
      const { error } = await supabase.from('tasks').insert({
        project_id: id,
        user_id: user.id,
        title: newTaskTitle.trim(),
      })
      if (error) {
        toast.error('No se pudo crear la tarea.')
      } else {
        queryClient.invalidateQueries({ queryKey: ['tasks', id] })
        setNewTaskTitle('')
      }
    } finally {
      setSavingTask(false)
    }
  }

  async function handleToggleTask(task: Task) {
    const { error } = await supabase
      .from('tasks')
      .update({ completed_at: task.completed_at ? null : new Date().toISOString() })
      .eq('id', task.id)
    if (!error) queryClient.invalidateQueries({ queryKey: ['tasks', id] })
  }

  // Item 1: elimina la tarea tras confirmación en el dialog
  async function confirmDeleteTask() {
    if (!deleteTaskTarget) return
    setDeletingTask(true)
    const { error } = await supabase.from('tasks').delete().eq('id', deleteTaskTarget.id)
    if (!error) queryClient.invalidateQueries({ queryKey: ['tasks', id] })
    else toast.error('No se pudo eliminar la tarea.')
    setDeletingTask(false)
    setDeleteTaskTarget(null)
  }

  if (loadingProject) {
    return <div className="flex h-full items-center justify-center text-muted-foreground">Cargando...</div>
  }

  if (!project) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
        <p>Proyecto no encontrado.</p>
        <Button variant="outline" onClick={() => navigate('/app/projects')}>Volver a proyectos</Button>
      </div>
    )
  }

  function TaskRow({ task, done }: { task: Task; done: boolean }) {
    return (
      <li className={cn('group flex items-center gap-2 rounded-md px-2 py-2 hover:bg-muted/40', done && 'opacity-60')}>
        <button
          onClick={() => void handleToggleTask(task)}
          className={cn('shrink-0 transition-colors', done ? 'text-emerald-500 hover:text-muted-foreground' : 'text-muted-foreground hover:text-foreground')}
        >
          {done ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
        </button>
        <span className={cn('flex-1 text-sm', done && 'line-through')}>{task.title}</span>
        <button
          onClick={() => setDeleteTaskTarget(task)}
          className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </li>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/app/projects')} className="shrink-0">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <span className="h-4 w-4 shrink-0 rounded-full" style={{ background: project.color }} />
        <h1 className="truncate text-2xl font-semibold">{project.name}</h1>
        <Badge variant="outline" className="shrink-0 text-xs">
          {project.type === 'academic' ? 'Académico' : 'Hobby'}
        </Badge>
      </div>

      {academicBanner && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
          Necesitás estudiar{' '}
          <span className="font-semibold">{academicBanner.hoursPerDay.toFixed(1)} hs/día</span>{' '}
          hasta el examen ({academicBanner.daysLeft} días restantes)
        </div>
      )}

      <div className="flex gap-6 rounded-xl bg-muted/40 px-5 py-4">
        <div>
          <p className="text-xs text-muted-foreground">Total</p>
          <p className="font-semibold">{totalHours.toFixed(1)} hs</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Últimos 7 días</p>
          <p className="font-semibold">{sessionsThisWeek} {sessionsThisWeek === 1 ? 'sesión' : 'sesiones'}</p>
        </div>
        {project.goal_hours != null && (
          <div>
            <p className="text-xs text-muted-foreground">Meta</p>
            <p className="font-semibold">{project.goal_hours} hs</p>
          </div>
        )}
      </div>

      {/* Tareas */}
      <section className="space-y-3">
        <h2 className="font-semibold">Tareas</h2>
        <form onSubmit={handleCreateTask} className="flex gap-2">
          <Input
            value={newTaskTitle}
            onChange={(e) => setNewTaskTitle(e.target.value)}
            placeholder="Nueva tarea... (Enter para guardar)"
            disabled={savingTask}
            className="flex-1"
          />
          <Button type="submit" size="sm" disabled={savingTask || !newTaskTitle.trim()}>Agregar</Button>
        </form>

        {tasks.length === 0 && (
          <p className="text-sm text-muted-foreground">No hay tareas. Agregá una arriba.</p>
        )}

        {pendingTasks.length > 0 && (
          <ul className="space-y-1">
            {pendingTasks.map((task) => <TaskRow key={task.id} task={task} done={false} />)}
          </ul>
        )}

        {completedTasks.length > 0 && (
          <>
            {pendingTasks.length > 0 && (
              <p className="pt-1 text-xs text-muted-foreground">
                {completedTasks.length} completada{completedTasks.length !== 1 && 's'}
              </p>
            )}
            <ul className="space-y-1">
              {completedTasks.map((task) => <TaskRow key={task.id} task={task} done={true} />)}
            </ul>
          </>
        )}
      </section>

      <Separator />

      {/* Historial */}
      <section className="space-y-3">
        <h2 className="font-semibold">Historial</h2>
        {sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aún no hay sesiones registradas.</p>
        ) : (
          <>
            <ul className="space-y-2">
              {sessions.map((s) => (
                <li key={s.id} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className="tabular-nums text-muted-foreground">
                      {new Date(s.started_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}{' '}
                      {new Date(s.started_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {s.tags && (
                      <>
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.tags.color }} />
                        <span className="text-muted-foreground">{s.tags.name}</span>
                      </>
                    )}
                  </div>
                  <span className="tabular-nums text-muted-foreground">{Math.round(s.duration_seconds / 60)}m</span>
                </li>
              ))}
            </ul>
            {/* Item 13: cargar más sesiones */}
            {allSessions.length > displayLimit && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-muted-foreground"
                onClick={() => setDisplayLimit((l) => l + HISTORY_PAGE)}
              >
                Cargar más ({allSessions.length - displayLimit} restantes)
              </Button>
            )}
          </>
        )}
      </section>

      {/* Item 1: dialog de confirmación para eliminar tarea */}
      <Dialog open={!!deleteTaskTarget} onOpenChange={(open) => { if (!open) setDeleteTaskTarget(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>¿Eliminar tarea?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Se eliminará <span className="font-semibold text-foreground">"{deleteTaskTarget?.title}"</span>. Esta acción no se puede deshacer.
          </p>
          <DialogFooter className="mt-2">
            <DialogClose render={<Button type="button" variant="outline" disabled={deletingTask} />}>
              Cancelar
            </DialogClose>
            <Button variant="destructive" onClick={() => void confirmDeleteTask()} disabled={deletingTask}>
              {deletingTask ? 'Eliminando...' : 'Eliminar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
