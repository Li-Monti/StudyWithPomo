import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import { Plus, Trash2, Bell, BellOff, Volume2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import type { Tag } from '@/types/database'

interface ConfigForm {
  work_min: number
  short_break_min: number
  long_break_min: number
  pomodoros_per_cycle: number
}

const DEFAULTS: ConfigForm = {
  work_min: 25,
  short_break_min: 5,
  long_break_min: 15,
  pomodoros_per_cycle: 4,
}

export function SettingsPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const { theme, setTheme } = useTheme()
  const [form, setForm] = useState<ConfigForm>(DEFAULTS)
  const [saving, setSaving] = useState(false)

  // Item 7: volumen del sonido (0-100, guardado en localStorage)
  const [soundVolume, setSoundVolume] = useState(() => {
    const stored = localStorage.getItem('pomodoroSoundVolume')
    return stored ? Math.round(parseFloat(stored) * 100) : 50
  })

  // Item 2: estado del permiso de notificaciones
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'denied',
  )

  // Item 16: form para nuevo tag personalizado
  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState('#6366f1')
  const [savingTag, setSavingTag] = useState(false)
  const [deletingTagId, setDeletingTagId] = useState<string | null>(null)

  const { data: config } = useQuery({
    queryKey: ['timerConfig', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('timer_configs')
        .select('*')
        .eq('user_id', user!.id)
        .maybeSingle()
      return data ?? DEFAULTS
    },
    enabled: !!user,
    staleTime: Infinity,
  })

  useEffect(() => {
    if (!config) return
    queueMicrotask(() => {
      setForm({
        work_min: config.work_min,
        short_break_min: config.short_break_min,
        long_break_min: config.long_break_min,
        pomodoros_per_cycle: config.pomodoros_per_cycle,
      })
    })
  }, [config])

  // Item 16: tags personalizados del usuario
  const { data: customTags = [] } = useQuery({
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

  const userTags = customTags.filter((t) => !t.is_default)

  function field(key: keyof ConfigForm) {
    return {
      value: form[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
        const v = parseInt(e.target.value, 10)
        if (!isNaN(v)) setForm(f => ({ ...f, [key]: v }))
      },
      type: 'number' as const,
      min: 1,
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return
    setSaving(true)
    const { error } = await supabase
      .from('timer_configs')
      .upsert({ user_id: user.id, ...form }, { onConflict: 'user_id' })
    if (error) {
      toast.error('No se pudo guardar la configuración.')
    } else {
      toast.success('Configuración guardada.')
      queryClient.invalidateQueries({ queryKey: ['timerConfig'] })
    }
    setSaving(false)
  }

  // Item 5: restaurar valores por defecto
  async function handleReset() {
    if (!user) return
    setForm(DEFAULTS)
    const { error } = await supabase
      .from('timer_configs')
      .upsert({ user_id: user.id, ...DEFAULTS }, { onConflict: 'user_id' })
    if (!error) {
      toast.success('Valores restaurados.')
      queryClient.invalidateQueries({ queryKey: ['timerConfig'] })
    }
  }

  // Item 2: solicitar permiso de notificaciones
  async function handleRequestNotification() {
    if (typeof Notification === 'undefined') return
    const result = await Notification.requestPermission()
    setNotifPermission(result)
    if (result === 'granted') toast.success('Notificaciones activadas.')
    else toast.error('Permiso denegado.')
  }

  // Item 7: guardar volumen en localStorage
  function handleVolumeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = parseInt(e.target.value)
    setSoundVolume(v)
    localStorage.setItem('pomodoroSoundVolume', String(v / 100))
  }

  // Item 16: crear tag personalizado
  async function handleCreateTag(e: React.FormEvent) {
    e.preventDefault()
    if (!newTagName.trim() || !user) return
    setSavingTag(true)
    const { error } = await supabase.from('tags').insert({
      user_id: user.id,
      name: newTagName.trim(),
      color: newTagColor,
      is_default: false,
    })
    if (error) {
      toast.error('No se pudo crear la etiqueta.')
    } else {
      toast.success('Etiqueta creada.')
      queryClient.invalidateQueries({ queryKey: ['tags'] })
      setNewTagName('')
    }
    setSavingTag(false)
  }

  // Item 16: eliminar tag personalizado
  async function handleDeleteTag(tagId: string) {
    setDeletingTagId(tagId)
    const { error } = await supabase.from('tags').delete().eq('id', tagId)
    if (error) {
      toast.error('No se pudo eliminar la etiqueta.')
    } else {
      queryClient.invalidateQueries({ queryKey: ['tags'] })
    }
    setDeletingTagId(null)
  }

  return (
    <div className="mx-auto max-w-xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Ajustes</h1>
        <p className="text-sm text-muted-foreground">Configurá los tiempos de tu Pomodoro.</p>
      </div>

      {/* Apariencia */}
      <Card>
        <CardHeader>
          <CardTitle>Apariencia</CardTitle>
          <CardDescription>Elegí el tema de la interfaz.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            {(['light', 'dark', 'system'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTheme(t)}
                className={cn(
                  'flex-1 rounded-lg border py-2 text-sm font-medium transition-all',
                  theme === t
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-input text-muted-foreground hover:border-primary/50',
                )}
              >
                {t === 'light' ? 'Claro' : t === 'dark' ? 'Oscuro' : 'Sistema'}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Timer */}
      <Card>
        <CardHeader>
          <CardTitle>Timer</CardTitle>
          <CardDescription>Los cambios aplican al guardar.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="work_min">Tiempo del pomodoro (min)</Label>
                <Input id="work_min" {...field('work_min')} max={120} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pomodoros_per_cycle">Descanso largo después de</Label>
                <Input id="pomodoros_per_cycle" {...field('pomodoros_per_cycle')} max={12} />
              </div>
            </div>

            <Separator />

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="short_break_min">Descanso corto (min)</Label>
                <Input id="short_break_min" {...field('short_break_min')} max={60} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="long_break_min">Descanso largo (min)</Label>
                <Input id="long_break_min" {...field('long_break_min')} max={60} />
              </div>
            </div>

            <div className="flex gap-2">
              <Button type="submit" className="flex-1" disabled={saving}>
                {saving ? 'Guardando...' : 'Guardar cambios'}
              </Button>
              {/* Item 5: restaurar valores por defecto */}
              <Button type="button" variant="outline" onClick={() => void handleReset()}>
                Restablecer
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Item 7: volumen del sonido */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Volume2 className="h-4 w-4" /> Sonido
          </CardTitle>
          <CardDescription>Volumen del sonido al completar un pomodoro.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-4">
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={soundVolume}
              onChange={handleVolumeChange}
              className="flex-1 accent-primary"
            />
            <span className="w-10 text-right text-sm font-medium tabular-nums">{soundVolume}%</span>
          </div>
          {soundVolume === 0 && (
            <p className="text-xs text-muted-foreground">Sonido desactivado.</p>
          )}
        </CardContent>
      </Card>

      {/* Item 2: notificaciones de browser */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {notifPermission === 'granted' ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
            Notificaciones
          </CardTitle>
          <CardDescription>
            Recibí una notificación cuando el pomodoro termine, incluso con la pestaña en segundo plano.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {notifPermission === 'granted' ? (
            <div className="flex items-center gap-2 text-sm text-emerald-600">
              <Bell className="h-4 w-4" />
              Notificaciones activadas
            </div>
          ) : notifPermission === 'denied' ? (
            <p className="text-sm text-muted-foreground">
              El permiso fue denegado. Para activarlas, habilitá las notificaciones en la configuración del navegador.
            </p>
          ) : (
            <Button variant="outline" onClick={() => void handleRequestNotification()}>
              Activar notificaciones
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Item 16: etiquetas personalizadas */}
      <Card>
        <CardHeader>
          <CardTitle>Mis etiquetas</CardTitle>
          <CardDescription>Creá etiquetas propias para clasificar tus sesiones.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Form para crear nueva etiqueta */}
          <form onSubmit={handleCreateTag} className="flex items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="tag-color">Color</Label>
              <input
                id="tag-color"
                type="color"
                value={newTagColor}
                onChange={(e) => setNewTagColor(e.target.value)}
                className="h-9 w-12 cursor-pointer rounded-md border border-input p-0.5"
              />
            </div>
            <div className="flex-1 space-y-1">
              <Label htmlFor="tag-name">Nombre</Label>
              <Input
                id="tag-name"
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                placeholder="Ej: Lectura"
                disabled={savingTag}
              />
            </div>
            <Button type="submit" size="sm" disabled={savingTag || !newTagName.trim()} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" /> Agregar
            </Button>
          </form>

          {/* Lista de etiquetas personalizadas */}
          {userTags.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tenés etiquetas personalizadas todavía.</p>
          ) : (
            <ul className="space-y-2">
              {userTags.map((tag) => (
                <li key={tag.id} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: tag.color }} />
                  <span className="flex-1 text-sm font-medium">{tag.name}</span>
                  <button
                    onClick={() => void handleDeleteTag(tag.id)}
                    disabled={deletingTagId === tag.id}
                    className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Etiquetas del sistema (solo lectura) */}
          <Separator />
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">Etiquetas del sistema</p>
            <div className="flex flex-wrap gap-2">
              {customTags.filter((t) => t.is_default).map((tag) => (
                <span
                  key={tag.id}
                  className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium"
                  style={{ borderColor: tag.color + '60', color: tag.color }}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: tag.color }} />
                  {tag.name}
                </span>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
