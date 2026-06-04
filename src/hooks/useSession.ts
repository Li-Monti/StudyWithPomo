import { useCallback } from 'react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import { useTimerStore } from '@/store/timerStore'
import type { ActiveSession } from '@/types/database'

export function useSession() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const { setIdle } = useTimerStore()

  const completeSession = useCallback(async () => {
    if (!user) return

    const { data } = await supabase
      .from('active_sessions')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle()

    const active = data as ActiveSession | null
    if (!active) return

    // BUG 5 fix: usar ends_at como tiempo de fin canónico (más preciso que Date.now())
    // Se cap a Date.now() para evitar duraciones negativas si se llama antes de tiempo
    const scheduledEnd = new Date(active.ends_at).getTime()
    const endedAt = new Date(Math.min(scheduledEnd, Date.now()))
    const startedAt = new Date(active.started_at)
    const durationSeconds = Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000))

    // BUG 3 fix: si el insert falla, mostrar error pero de todas formas limpiar
    // para que el usuario no quede bloqueado en estado 'completed'
    const { error: insertError } = await supabase.from('sessions').insert({
      user_id: user.id,
      project_id: active.project_id,
      task_id: active.task_id,
      tag_id: active.tag_id,
      started_at: active.started_at,
      ended_at: endedAt.toISOString(),
      duration_seconds: durationSeconds,
      session_type: active.session_type,
    })

    if (insertError) {
      toast.error('No se pudo guardar la sesión. Revisá tu conexión.')
      console.error('completeSession insert failed:', insertError)
    }

    await supabase.from('active_sessions').delete().eq('user_id', user.id)

    queryClient.invalidateQueries({ queryKey: ['sessions'] })
    queryClient.invalidateQueries({ queryKey: ['stats'] })
    queryClient.invalidateQueries({ queryKey: ['projectHours'] })
    queryClient.invalidateQueries({ queryKey: ['todayProjectHours'] })
    if (active.project_id) {
      queryClient.invalidateQueries({ queryKey: ['projectSessions', active.project_id] })
    }

    setIdle()
  }, [user, queryClient, setIdle])

  return { completeSession }
}
