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
    if (!user) return false

    const { data: activeData, error: activeError } = await supabase
      .from('active_sessions')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle()

    if (activeError) {
      toast.error('No se pudo leer la sesión activa.')
      console.error('completeSession active fetch failed:', activeError)
      return false
    }

    const active = activeData as ActiveSession | null
    if (!active) return false

    const { error: finishError } = await supabase.rpc('finish_active_work_session', { p_save_full: true })
    if (finishError) {
      toast.error('No se pudo guardar la sesión. Revisá tu conexión.')
      console.error('completeSession finish failed:', finishError)
      return false
    }

    queryClient.invalidateQueries({ queryKey: ['sessions'] })
    queryClient.invalidateQueries({ queryKey: ['stats'] })
    queryClient.invalidateQueries({ queryKey: ['projectHours'] })
    queryClient.invalidateQueries({ queryKey: ['todayProjectHours'] })
    if (active.project_id) {
      queryClient.invalidateQueries({ queryKey: ['projectSessions', active.project_id] })
    }

    setIdle()
    return true
  }, [user, queryClient, setIdle])

  return { completeSession }
}
