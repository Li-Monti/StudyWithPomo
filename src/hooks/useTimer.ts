import { useEffect, useRef, useCallback } from 'react'
import { toast } from 'sonner'
import { useTimerStore } from '@/store/timerStore'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import type { ActiveSession, SessionType } from '@/types/database'

type WorkerEvent =
  | { type: 'tick'; remaining: number }
  | { type: 'complete' }

export function useTimer() {
  const workerRef = useRef<Worker | null>(null)
  const { user } = useAuth()
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
          const total = new Date(session.ends_at).getTime() - new Date(session.started_at).getTime()
          setTotalMs(total)
          setSessionType(session.session_type)
          setPaused(session.paused_remaining_ms)
          return
        }

        const endsAt = new Date(session.ends_at).getTime()
        if (endsAt > Date.now()) {
          const total = endsAt - new Date(session.started_at).getTime()
          setSessionType(session.session_type)
          setRunning(endsAt, session.id, total)
          workerRef.current?.postMessage({ type: 'start', endsAt })
        } else {
          if (session.session_type === 'work') {
            void finishExpiredSession(session)
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
    const { data, error } = await supabase
      .from('active_sessions')
      .upsert({
        user_id: user.id,
        project_id: null,
        task_id: null,
        tag_id: null,
        started_at: new Date().toISOString(),
        ends_at: new Date(Date.now() + durationMs).toISOString(),
        session_type: type,
        paused_remaining_ms: durationMs,
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
    if (session) useTimerStore.getState().setRunning(Date.now() + durationMs, session.id, durationMs)
    // Override back to paused (setRunning sets status to running)
    setPaused(durationMs)
  }, [user, setSessionType, setPaused, setIdle])

  const pause = useCallback(async () => {
    workerRef.current?.postMessage({ type: 'stop' })
    try {
      if (user) {
        await supabase
          .from('active_sessions')
          .update({ paused_remaining_ms: remaining })
          .eq('user_id', user.id)
      }
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
    const newEndsAt = Date.now() + ms

    try {
      await supabase
        .from('active_sessions')
        .update({
          ends_at: new Date(newEndsAt).toISOString(),
          paused_remaining_ms: null,
        })
        .eq('user_id', user.id)

      setResumed(newEndsAt)
      workerRef.current?.postMessage({ type: 'start', endsAt: newEndsAt })
    } catch (err) {
      toast.error('No se pudo reanudar la sesión.')
      console.error('resume() failed:', err)
    }
  }, [user, pausedRemainingMs, remaining, setResumed])

  const stop = useCallback(async () => {
    workerRef.current?.postMessage({ type: 'stop' })
    try {
      if (user) {
        await supabase.from('active_sessions').delete().eq('user_id', user.id)
      }
      setIdle()
    } catch (err) {
      toast.error('No se pudo detener la sesión.')
      console.error('stop() failed:', err)
    }
  }, [user, setIdle])

  return { status, sessionType, remaining, totalMs, pausedRemainingMs, start, startBreakPaused, pause, resume, stop, setSessionType }
}

// BUG 4 fix: try-catch para evitar que errores silenciosos dejen la sesión atrapada en active_sessions
async function finishExpiredSession(session: ActiveSession) {
  try {
    const endedAt = new Date()
    const startedAt = new Date(session.started_at)
    const durationSeconds = Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000))

    await supabase.from('sessions').insert({
      user_id: session.user_id,
      project_id: session.project_id,
      task_id: session.task_id,
      tag_id: session.tag_id,
      started_at: session.started_at,
      ended_at: endedAt.toISOString(),
      duration_seconds: durationSeconds,
      session_type: session.session_type as SessionType,
    })

    await supabase.from('active_sessions').delete().eq('id', session.id)
  } catch (err) {
    // Dejar la sesión en active_sessions; se reintentará en la próxima carga
    console.error('finishExpiredSession() failed, will retry on next load:', err)
  }
}
