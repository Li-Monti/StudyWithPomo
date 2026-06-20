import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, MoreHorizontal, Archive, RotateCcw, FolderOpen, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { calcAcademicDailyGoal } from '@/lib/projectGoals'
import type { Project, Tag } from '@/types/database'

const DEFAULT_COLOR = '#6366f1'

type FormState = {
  name: string
  type: 'hobby' | 'academic'
  color: string
  goal_hours: string
  exam_date: string
  default_tag_id: string
}

const EMPTY_FORM: FormState = {
  name: '',
  type: 'hobby',
  color: DEFAULT_COLOR,
  goal_hours: '',
  exam_date: '',
  default_tag_id: 'none',
}

export function ProjectsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [tab, setTab] = useState<'active' | 'archived'>('active')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [pageLoadedAt] = useState(() => Date.now())

  // Cierra el menú contextual al hacer click fuera de cualquier [data-menu-container]
  useEffect(() => {
    if (!openMenuId) return
    function onCapture(e: MouseEvent) {
      if (!(e.target as HTMLElement).closest('[data-menu-container]')) {
        setOpenMenuId(null)
      }
    }
    document.addEventListener('click', onCapture, true)
    return () => document.removeEventListener('click', onCapture, true)
  }, [openMenuId])

  const { data: projects = [] } = useQuery({
    queryKey: ['projects', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('projects')
        .select('*')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false })
      return (data ?? []) as Project[]
    },
    enabled: !!user,
    staleTime: 30_000,
  })

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
        if (s.project_id) {
          hours[s.project_id] = (hours[s.project_id] ?? 0) + s.duration_seconds / 3600
        }
      }
      return hours
    },
    enabled: !!user,
    staleTime: 0,
  })

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

  const filtered = projects.filter((p) =>
    tab === 'active' ? !p.archived_at : !!p.archived_at,
  )

  function openCreate() {
    setEditingProject(null)
    setForm(EMPTY_FORM)
    setDialogOpen(true)
  }

  function openEdit(project: Project) {
    setEditingProject(project)
    setForm({
      name: project.name,
      type: project.type,
      color: project.color,
      goal_hours: project.goal_hours != null ? String(project.goal_hours) : '',
      exam_date: project.exam_date ?? '',
      default_tag_id: project.default_tag_id ?? 'none',
    })
    setOpenMenuId(null)
    setDialogOpen(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim() || !user) return
    setSaving(true)
    const parsedHours = form.goal_hours !== '' ? parseFloat(form.goal_hours) : null
    const payload = {
      name: form.name.trim(),
      type: form.type,
      color: form.color,
      goal_hours: parsedHours !== null && !isNaN(parsedHours) && parsedHours > 0 ? parsedHours : null,
      exam_date: form.type === 'academic' && form.exam_date ? form.exam_date : null,
      default_tag_id: form.default_tag_id !== 'none' ? form.default_tag_id : null,
    }
    const { error } = editingProject
      ? await supabase.from('projects').update(payload).eq('id', editingProject.id)
      : await supabase.from('projects').insert({ ...payload, user_id: user.id })
    if (error) {
      toast.error('No se pudo guardar el proyecto.')
    } else {
      toast.success(editingProject ? 'Proyecto actualizado.' : 'Proyecto creado.')
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      setDialogOpen(false)
    }
    setSaving(false)
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    const { error } = await supabase.from('projects').delete().eq('id', deleteTarget.id)
    if (error) {
      toast.error('No se pudo eliminar el proyecto.')
    } else {
      toast.success('Proyecto eliminado.')
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['projectHours'] })
    }
    setDeleting(false)
    setDeleteTarget(null)
  }

  async function handleArchive(project: Project) {
    setOpenMenuId(null)
    const { error } = await supabase
      .from('projects')
      .update({ archived_at: project.archived_at ? null : new Date().toISOString() })
      .eq('id', project.id)
    if (error) {
      toast.error('Error al archivar el proyecto.')
    } else {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    }
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Proyectos</h1>
          <p className="text-sm text-muted-foreground">Organizá tu trabajo por proyecto.</p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="h-4 w-4" /> Nuevo proyecto
        </Button>
      </div>

      {/* Tabs activos / archivados */}
      <div className="flex gap-1 rounded-lg bg-muted/40 p-1 w-fit">
        {(['active', 'archived'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
              tab === t
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t === 'active' ? 'Activos' : 'Archivados'}
          </button>
        ))}
      </div>

      {/* Grid de proyectos */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
          <FolderOpen className="h-10 w-10 opacity-30" />
          <p className="text-sm">
            {tab === 'active'
              ? 'No tenés proyectos activos.'
              : 'No hay proyectos archivados.'}
          </p>
          {tab === 'active' && (
            <Button variant="outline" size="sm" onClick={openCreate}>
              Crear el primero
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((project) => {
            const hours = projectHours[project.id] ?? 0
            const progress =
              project.goal_hours != null
                ? Math.min(100, (hours / project.goal_hours) * 100)
                : null
            const dailyGoal = calcAcademicDailyGoal(project, hours, pageLoadedAt)
            const hoursPerDay = dailyGoal?.hoursPerDay ?? null
            const isMenuOpen = openMenuId === project.id

            return (
              <div
                key={project.id}
                onClick={() => navigate(`/app/projects/${project.id}`)}
                className="relative cursor-pointer rounded-xl border bg-card p-4 shadow-sm transition-all hover:ring-2 hover:ring-primary/20 hover:shadow-md"
              >
                {/* Menú contextual de 3 puntos */}
                <div
                  data-menu-container
                  className="absolute right-3 top-3"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => setOpenMenuId(isMenuOpen ? null : project.id)}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                  {isMenuOpen && (
                    <div className="absolute right-0 top-full z-20 mt-1 min-w-36 rounded-lg border bg-popover p-1 shadow-lg">
                      <button
                        onClick={() => openEdit(project)}
                        className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm hover:bg-accent transition-colors"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => void handleArchive(project)}
                        className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm hover:bg-accent transition-colors"
                      >
                        {project.archived_at ? (
                          <>
                            <RotateCcw className="h-3.5 w-3.5" /> Restaurar
                          </>
                        ) : (
                          <>
                            <Archive className="h-3.5 w-3.5" /> Archivar
                          </>
                        )}
                      </button>
                      <button
                        onClick={() => { setOpenMenuId(null); setDeleteTarget(project) }}
                        className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Eliminar
                      </button>
                    </div>
                  )}
                </div>

                {/* Contenido del card */}
                <div className="flex items-center gap-2 pr-8">
                  <span
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{ background: project.color }}
                  />
                  <h3 className="truncate font-semibold">{project.name}</h3>
                </div>

                <div className="mt-1.5">
                  <Badge variant="outline" className="text-xs">
                    {project.type === 'academic' ? 'Académico' : 'Hobby'}
                  </Badge>
                </div>

                {/* Banner académico */}
                {hoursPerDay !== null && hoursPerDay > 0 && (
                  <p className="mt-3 text-xs font-medium text-amber-600">
                    {hoursPerDay.toFixed(1)} hs/día necesarias
                  </p>
                )}
                {hoursPerDay === 0 && (
                  <p className="mt-3 text-xs font-medium text-emerald-600">
                    Meta alcanzada
                  </p>
                )}

                {/* Barra de progreso y horas */}
                <div className="mt-3 space-y-1.5">
                  {progress !== null && <Progress value={progress} />}
                  <p className="text-xs text-muted-foreground">
                    {hours.toFixed(1)} hs completadas
                    {project.goal_hours != null && ` / ${project.goal_hours} hs meta`}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Dialog confirmar eliminación */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>¿Eliminar proyecto?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Se eliminará <span className="font-semibold text-foreground">{deleteTarget?.name}</span> y todas sus tareas. Las sesiones registradas se conservan en el historial.
          </p>
          <DialogFooter className="mt-2">
            <DialogClose render={<Button type="button" variant="outline" disabled={deleting} />}>
              Cancelar
            </DialogClose>
            <Button variant="destructive" onClick={() => void handleDelete()} disabled={deleting}>
              {deleting ? 'Eliminando...' : 'Eliminar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog crear / editar proyecto */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingProject ? 'Editar proyecto' : 'Nuevo proyecto'}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSave} className="space-y-4 pt-1">
            <div className="space-y-1">
              <Label htmlFor="proj-name">Nombre</Label>
              <Input
                id="proj-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Mi proyecto"
                required
              />
            </div>

            <div className="space-y-1">
              <Label>Tipo</Label>
              <div className="flex gap-2">
                {(['hobby', 'academic'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, type: t }))}
                    className={cn(
                      'flex-1 rounded-lg border py-2 text-sm font-medium transition-all',
                      form.type === t
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-input text-muted-foreground hover:border-primary/50',
                    )}
                  >
                    {t === 'hobby' ? 'Hobby' : 'Académico'}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-end gap-4">
              <div className="space-y-1">
                <Label htmlFor="proj-color">Color</Label>
                <input
                  id="proj-color"
                  type="color"
                  value={form.color}
                  onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                  className="h-8 w-14 cursor-pointer rounded-md border border-input p-0.5"
                />
              </div>
              <div className="flex-1 space-y-1">
                <Label htmlFor="proj-goal">Meta de horas (opcional)</Label>
                <Input
                  id="proj-goal"
                  type="number"
                  min="0"
                  step="0.5"
                  value={form.goal_hours}
                  onChange={(e) => setForm((f) => ({ ...f, goal_hours: e.target.value }))}
                  placeholder="Ej: 50"
                />
              </div>
            </div>

            {form.type === 'academic' && (
              <div className="space-y-1">
                <Label htmlFor="proj-exam">Fecha de examen</Label>
                <Input
                  id="proj-exam"
                  type="date"
                  value={form.exam_date}
                  onChange={(e) => setForm((f) => ({ ...f, exam_date: e.target.value }))}
                />
              </div>
            )}

            <div className="space-y-1">
              <Label>Tag por defecto (opcional)</Label>
              <Select
                value={form.default_tag_id}
                onValueChange={(val) => setForm((f) => ({ ...f, default_tag_id: val ?? 'none' }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Sin tag" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin tag</SelectItem>
                  {tags.map((tag) => (
                    <SelectItem key={tag.id} value={tag.id}>
                      <span
                        className="mr-1.5 inline-block h-2 w-2 rounded-full"
                        style={{ background: tag.color }}
                      />
                      {tag.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>
                Cancelar
              </DialogClose>
              <Button type="submit" disabled={saving || !form.name.trim()}>
                {saving ? 'Guardando...' : editingProject ? 'Guardar' : 'Crear'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
