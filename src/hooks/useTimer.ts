import { useEffect, useRef, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTimerStore } from '@/store/timerStore'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import type { ActiveSession } from '@/types/database'

type WorkerEvent =
  | { type: 'tick'; remaining: number }
  | { type: 'complete' }

export function useTimer() {
  const workerRef = useRef<Worker | null>(null)
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const {
    status, sessionType, endsAt, remaining, totalMs, pausedRemainingMs,
    activeProjectId, activeTaskId, activeTagId,
    setRunning, setTick, setCompleted, setIdle, setPaused, setResumed, setTotalMs, setSessionType,
  } = useTimerStore()

  useEffect(() => {
    workerRef.current = new Worker(
      new URL('@/workers/timerWorker.ts', import.meta.url),
      { type: 'module' },
    )
    workerRef.current.onmessage = (e: MessageEvent<WorkerEvent>) => {
      if (e.data.type === 'tick') setTick(e.data.remaining)
      if (e.data.type === 'complete') setCompleted()
    }
    return () => workerRef.current?.terminate()
  }, [setTick, setCompleted])

  // Resume active session from DB on mount.
  // La bandera `cancelled` previene la doble-inserción que causa React StrictMode
  // al invocar effects dos veces en desarrollo (mount → cleanup → remount).
  // El cleanup setea cancelled=true antes de que el segundo fetch pueda procesar.
  useEffect(() => {
    if (!user) return
    let cancelled = false

    supabase
      .from('active_sessions')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        const session = data as ActiveSession | null
        if (!session) return

        // Restore project + tag selection
        if (session.project_id) useTimerStore.getState().setActiveProject(session.project_id, session.task_id)
        if (session.tag_id) useTimerStore.getState().setActiveTag(session.tag_id)

        // Handle paused break
        if (session.paused_remaining_ms != null) {
          const total = session.total_ms
          setTotalMs(total)
          setSessionType(session.session_type)
          setPaused(session.paused_remaining_ms)
          return
        }

        const endsAt = new Date(session.ends_at).getTime()
        if (endsAt > Date.now()) {
          const total = session.total_ms
          setSessionType(session.session_type)
          setRunning(endsAt, session.id, total)
          workerRef.current?.postMessage({ type: 'start', endsAt })
        } else {
          if (session.session_type === 'work') {
            void finishExpiredSession()
          } else {
            // Expired break — just clear it and go idle
            void supabase.from('active_sessions').delete().eq('id', session.id)
            setIdle()
          }
        }
      })

    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  // Recalculate on tab focus
  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === 'visible' && endsAt && status === 'running') {
        const r = Math.max(0, endsAt - Date.now())
        setTick(r)
        if (r === 0) setCompleted()
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [endsAt, status, setTick, setCompleted])

  const start = useCallback(async (durationMs: number) => {
    if (!user) return
    const now = Date.now()
    const endsAt = now + durationMs

    const { data, error } = await supabase
      .from('active_sessions')
      .upsert({
        user_id: user.id,
        project_id: activeProjectId,
        task_id: activeTaskId,
        tag_id: activeTagId,
        started_at: new Date(now).toISOString(),
        ends_at: new Date(endsAt).toISOString(),
        session_type: sessionType,
        paused_remaining_ms: null,
        total_ms: durationMs,
        elapsed_ms: 0,
        last_started_at: new Date(now).toISOString(),
      }, { onConflict: 'user_id' })
      .select()
      .single()

    if (error) {
      toast.error(`No se pudo iniciar la sesión: ${error.message}`)
      console.error('start() failed:', error)
      return
    }
    if (!data) return

    const session = data as ActiveSession
    setRunning(endsAt, session.id, durationMs)
    workerRef.current?.postMessage({ type: 'start', endsAt })
  }, [user, activeProjectId, activeTaskId, activeTagId, sessionType, setRunning])

  // Start a break session (shown paused until user clicks start)
  const startBreakPaused = useCallback(async (durationMs: number, type: 'short_break' | 'long_break') => {
    if (!user) return
    const now = Date.now()
    const { data, error } = await supabase
      .from('active_sessions')
      .upsert({
        user_id: user.id,
        project_id: null,
        task_id: null,
        tag_id: null,
        started_at: new Date(now).toISOString(),
        ends_at: new Date(now + durationMs).toISOString(),
        session_type: type,
        paused_remaining_ms: durationMs,
        total_ms: durationMs,
        elapsed_ms: 0,
        last_started_at: null,
      }, { onConflict: 'user_id' })
      .select()
      .single()

    if (error) {
      toast.error('No se pudo iniciar el descanso.')
      console.error('startBreakPaused() failed:', error)
      setIdle()
      return
    }

    const session = data as ActiveSession | null
    setSessionType(type)
    if (session) useTimerStore.getState().setRunning(now + durationMs, session.id, durationMs)
    // Override back to paused (setRunning sets status to running)
    setPaused(durationMs)
  }, [user, setSessionType, setPaused, setIdle])

  const pause = useCallback(async () => {
    try {
      if (user) {
        const { data: activeData, error: fetchError } = await supabase
          .from('active_sessions')
          .select('*')
          .eq('user_id', user.id)
          .maybeSingle()

        if (fetchError) throw fetchError
        const active = activeData as ActiveSession | null
        if (!active) return

        const now = Date.now()
        const activeEndsAt = new Date(active.ends_at).getTime()
        const activeLastStartedAt = active.last_started_at
          ? new Date(active.last_started_at).getTime()
          : null
        const elapsedMs = Math.min(
          active.total_ms,
          active.elapsed_ms + (activeLastStartedAt ? Math.max(0, now - activeLastStartedAt) : 0),
        )
        const pausedMs = Math.max(0, activeEndsAt - now)

        const { error: updateError } = await supabase
          .from('active_sessions')
          .update({
            paused_remaining_ms: pausedMs,
            elapsed_ms: elapsedMs,
            last_started_at: null,
          })
          .eq('user_id', user.id)
        if (updateError) throw updateError

        workerRef.current?.postMessage({ type: 'stop' })
        setPaused(pausedMs)
        return
      }
      workerRef.current?.postMessage({ type: 'stop' })
      setPaused(remaining)
    } catch (err) {
      // Reiniciar worker si no se pudo guardar la pausa en DB
      if (endsAt) workerRef.current?.postMessage({ type: 'start', endsAt })
      toast.error('No se pudo pausar la sesión.')
      console.error('pause() failed:', err)
    }
  }, [user, remaining, endsAt, setPaused])

  const resume = useCallback(async () => {
    const ms = pausedRemainingMs ?? remaining
    if (!ms || !user) return
    const now = Date.now()
    const newEndsAt = now + ms

    try {
      const { error } = await supabase
        .from('active_sessions')
        .update({
          ends_at: new Date(newEndsAt).toISOString(),
          paused_remaining_ms: null,
          last_started_at: new Date(now).toISOString(),
        })
        .eq('user_id', user.id)
      if (error) throw error

      setResumed(newEndsAt)
      workerRef.current?.postMessage({ type: 'start', endsAt: newEndsAt })
    } catch (err) {
      toast.error('No se pudo reanudar la sesión.')
      console.error('resume() failed:', err)
    }
  }, [user, pausedRemainingMs, remaining, setResumed])

  const stop = useCallback(async () => {
    try {
      if (user) {
        const { error } = await supabase.from('active_sessions').delete().eq('user_id', user.id)
        if (error) throw error
      }
      workerRef.current?.postMessage({ type: 'stop' })
      setIdle()
    } catch (err) {
      toast.error('No se pudo detener la sesión.')
      console.error('stop() failed:', err)
    }
  }, [user, setIdle])

  const stopAndSaveWorkSession = useCallback(async () => {
    if (!user) return false
    try {
      const { error } = await supabase.rpc('finish_active_work_session', { p_save_full: false })
      if (error) throw error

      workerRef.current?.postMessage({ type: 'stop' })
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      queryClient.invalidateQueries({ queryKey: ['stats'] })
      queryClient.invalidateQueries({ queryKey: ['projectHours'] })
      queryClient.invalidateQueries({ queryKey: ['todayProjectHours'] })
      queryClient.invalidateQueries({ queryKey: ['projectSessions'] })
      setIdle()
      return true
    } catch (err) {
      toast.error('No se pudo guardar y detener la sesión.')
      console.error('stopAndSaveWorkSession() failed:', err)
      return false
    }
  }, [user, queryClient, setIdle])

  return { status, sessionType, remaining, totalMs, pausedRemainingMs, start, startBreakPaused, pause, resume, stop, stopAndSaveWorkSession, setSessionType }
}

// BUG 4 fix: try-catch para evitar que errores silenciosos dejen la sesión atrapada en active_sessions
async function finishExpiredSession() {
  try {
    const { error } = await supabase.rpc('finish_active_work_session', { p_save_full: true })
    if (error) throw error
  } catch (err) {
    // Dejar la sesión en active_sessions; se reintentará en la próxima carga
    console.error('finishExpiredSession() failed, will retry on next load:', err)
  }
}
