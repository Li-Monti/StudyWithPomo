import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Flame } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { supabase } from '@/lib/supabase'
import { useTheme } from 'next-themes'
import { useAuth } from '@/hooks/useAuth'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

type Period = 'day' | 'week' | 'month'

type SessionWithRefs = {
  id: string
  duration_seconds: number
  started_at: string
  project_id: string | null
  tag_id: string | null
  projects: { name: string; color: string } | null
  tags: { name: string; color: string } | null
}

function formatHoursMinutes(hours: number): string {
  const h = Math.floor(hours)
  const m = Math.round((hours - h) * 60)
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

function getPeriodStart(period: Period): Date {
  const now = new Date()
  if (period === 'day') {
    now.setHours(0, 0, 0, 0)
    return now
  }
  if (period === 'week') {
    const day = now.getDay()
    const diff = day === 0 ? -6 : 1 - day // lunes
    now.setDate(now.getDate() + diff)
    now.setHours(0, 0, 0, 0)
    return now
  }
  return new Date(now.getFullYear(), now.getMonth(), 1)
}

function buildChartData(sessions: SessionWithRefs[], period: Period) {
  if (period === 'day') {
    // Agrupa sesiones por hora de inicio y muestra acumulado hora a hora
    const byHour: Record<number, number> = {}
    sessions.forEach((s) => {
      const hour = new Date(s.started_at).getHours()
      byHour[hour] = (byHour[hour] ?? 0) + s.duration_seconds / 3600
    })

    const currentHour = new Date().getHours()
    const result: { label: string; cumulative: number }[] = []
    let cumulative = 0

    for (let h = 0; h <= currentHour; h++) {
      cumulative += byHour[h] ?? 0
      result.push({
        label: `${String(h).padStart(2, '0')}:00`,
        cumulative: parseFloat(cumulative.toFixed(2)),
      })
    }
    return result
  }

  const byDay: Record<string, number> = {}
  sessions.forEach((s) => {
    const day = s.started_at.slice(0, 10)
    byDay[day] = (byDay[day] ?? 0) + s.duration_seconds / 3600
  })

  const start = getPeriodStart(period)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const result: { label: string; cumulative: number }[] = []
  const cursor = new Date(start)
  let cumulative = 0

  while (cursor <= today) {
    const key = cursor.toISOString().slice(0, 10)
    cumulative += byDay[key] ?? 0

    const label =
      period === 'week'
        ? cursor.toLocaleDateString('es-AR', { weekday: 'short' })
        : String(cursor.getDate())

    result.push({ label, cumulative: parseFloat(cumulative.toFixed(2)) })
    cursor.setDate(cursor.getDate() + 1)
  }
  return result
}

function calcStreak(days: string[]): number {
  if (days.length === 0) return 0
  const uniqueDays = [...new Set(days)].sort().reverse()
  let streak = 0
  const cursor = new Date()
  cursor.setHours(0, 0, 0, 0)

  for (const day of uniqueDays) {
    const d = new Date(day + 'T00:00:00')
    if (d.getTime() === cursor.getTime()) {
      streak++
      cursor.setDate(cursor.getDate() - 1)
    } else if (d < cursor) {
      break
    }
  }
  return streak
}

export function StatsPage() {
  const { user } = useAuth()
  const { resolvedTheme } = useTheme()
  const [period, setPeriod] = useState<Period>('week')

  // Lee el color primario real desde el DOM (las CSS vars son oklch, no hsl)
  const lineColor = useMemo(() => {
    void resolvedTheme
    if (typeof window === 'undefined') return '#000'
    return getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()
  }, [resolvedTheme])

  const { data: sessions = [] } = useQuery({
    queryKey: ['stats', user?.id, period],
    queryFn: async () => {
      const start = getPeriodStart(period)
      const { data } = await supabase
        .from('sessions')
        .select('id, duration_seconds, started_at, project_id, tag_id, projects(name, color), tags(name, color)')
        .eq('user_id', user!.id)
        .eq('session_type', 'work')
        .gte('started_at', start.toISOString())
        .order('started_at')
      return (data ?? []) as unknown as SessionWithRefs[]
    },
    enabled: !!user,
    staleTime: 0,
  })

  const { data: allDays = [] } = useQuery({
    queryKey: ['allSessionDays', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('sessions')
        .select('started_at')
        .eq('user_id', user!.id)
        .eq('session_type', 'work')
        .order('started_at', { ascending: false })
      return (data ?? []).map((s) => s.started_at.slice(0, 10))
    },
    enabled: !!user,
    staleTime: 0,
  })

  const totalHours = sessions.reduce((acc, s) => acc + s.duration_seconds, 0) / 3600
  const streak = calcStreak(allDays)
  const chartData = buildChartData(sessions, period)

  const byProject = sessions.reduce(
    (acc, s) => {
      if (!s.project_id || !s.projects) return acc
      acc[s.project_id] ??= { name: s.projects.name, color: s.projects.color, hours: 0 }
      acc[s.project_id].hours += s.duration_seconds / 3600
      return acc
    },
    {} as Record<string, { name: string; color: string; hours: number }>,
  )
  const projectList = Object.values(byProject).sort((a, b) => b.hours - a.hours)
  const maxProjectHours = projectList[0]?.hours ?? 1

  const byTag = sessions.reduce(
    (acc, s) => {
      const key = s.tag_id ?? '__none__'
      const name = s.tags?.name ?? 'Sin categoría'
      const color = s.tags?.color ?? '#94a3b8'
      acc[key] ??= { name, color, hours: 0 }
      acc[key].hours += s.duration_seconds / 3600
      return acc
    },
    {} as Record<string, { name: string; color: string; hours: number }>,
  )
  const tagList = Object.values(byTag).sort((a, b) => b.hours - a.hours)
  const maxTagHours = tagList[0]?.hours ?? 1

  const PERIOD_LABELS: Record<Period, string> = {
    day: 'Hoy',
    week: 'Esta semana',
    month: 'Este mes',
  }

  const tooltipStyle = {
    backgroundColor: 'hsl(var(--popover))',
    border: '1px solid hsl(var(--border))',
    borderRadius: '8px',
    color: 'hsl(var(--popover-foreground))',
    fontSize: '12px',
    padding: '6px 10px',
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Estadísticas</h1>
        <p className="text-sm text-muted-foreground">Tu progreso de estudio y trabajo.</p>
      </div>

      {/* Selector de período */}
      <div className="flex gap-1 rounded-lg bg-muted/40 p-1 w-fit">
        {(['day', 'week', 'month'] as const).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={cn(
              'rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
              period === p
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {p === 'day' ? 'Hoy' : p === 'week' ? 'Semana' : 'Mes'}
          </button>
        ))}
      </div>

      {/* Stats rápidas */}
      <div className="grid grid-cols-3 gap-4 rounded-xl bg-muted/40 px-5 py-4">
        <div>
          <p className="text-xs text-muted-foreground">{PERIOD_LABELS[period]}</p>
          <p className="text-xl font-semibold">{formatHoursMinutes(totalHours)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Sesiones</p>
          <p className="text-xl font-semibold">{sessions.length}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Racha actual</p>
          <div className="flex items-center gap-1.5">
            <Flame
              className={cn(
                'h-4 w-4',
                streak > 0 ? 'text-orange-500' : 'text-muted-foreground/40',
              )}
            />
            <p className="text-xl font-semibold">
              {streak} {streak === 1 ? 'día' : 'días'}
            </p>
          </div>
        </div>
      </div>

      {/* Gráfico de líneas acumulado */}
      {sessions.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center py-16 text-sm text-muted-foreground">
            No hay sesiones en este período.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Horas acumuladas</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  interval={period === 'day' ? 2 : 0}
                />
                <YAxis
                  width={40}
                  tick={{ fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => typeof v === 'number' ? `${v.toFixed(0)}h` : v}
                />
                <Tooltip
                  formatter={(value) => [
                    typeof value === 'number' ? formatHoursMinutes(value) : '0m',
                    'Acumulado',
                  ]}
                  cursor={{ stroke: 'rgba(128,128,128,0.3)', strokeWidth: 1 }}
                  contentStyle={tooltipStyle}
                  labelStyle={{ color: 'hsl(var(--muted-foreground))' }}
                  itemStyle={{ color: 'hsl(var(--foreground))' }}
                />
                <Line
                  type="monotone"
                  dataKey="cumulative"
                  stroke={lineColor}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Desglose por proyecto */}
      {projectList.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-semibold">Por proyecto</h2>
          <ul className="space-y-3">
            {projectList.map((p) => (
              <li key={p.name} className="space-y-1">
                <div className="flex items-center gap-2 text-sm">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: p.color }}
                  />
                  <span className="flex-1 truncate">{p.name}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {formatHoursMinutes(p.hours)}
                  </span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${(p.hours / maxProjectHours) * 100}%`,
                      background: p.color,
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Desglose por categoría */}
      {tagList.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-semibold">Por categoría</h2>
          <ul className="space-y-3">
            {tagList.map((t) => (
              <li key={t.name} className="space-y-1">
                <div className="flex items-center gap-2 text-sm">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: t.color }}
                  />
                  <span className="flex-1 truncate">{t.name}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {formatHoursMinutes(t.hours)}
                  </span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${(t.hours / maxTagHours) * 100}%`,
                      background: t.color,
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
