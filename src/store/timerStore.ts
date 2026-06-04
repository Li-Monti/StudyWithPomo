import { create } from 'zustand'
import type { SessionType } from '@/types/database'

export type TimerStatus = 'idle' | 'running' | 'paused' | 'completed'

interface TimerState {
  status: TimerStatus
  sessionType: SessionType
  endsAt: number | null
  remaining: number
  totalMs: number
  pausedRemainingMs: number | null
  activeProjectId: string | null
  activeTaskId: string | null
  activeTagId: string | null
  activeSessionId: string | null

  setRunning: (endsAt: number, sessionId: string, totalMs: number) => void
  setTick: (remaining: number) => void
  setCompleted: () => void
  setIdle: () => void
  setPaused: (remainingMs: number) => void
  setResumed: (endsAt: number) => void
  setTotalMs: (ms: number) => void
  setActiveProject: (projectId: string | null, taskId?: string | null) => void
  setActiveTag: (tagId: string | null) => void
  setSessionType: (type: SessionType) => void
}

export const useTimerStore = create<TimerState>((set) => ({
  status: 'idle',
  sessionType: 'work',
  endsAt: null,
  remaining: 0,
  totalMs: 0,
  pausedRemainingMs: null,
  activeProjectId: null,
  activeTaskId: null,
  activeTagId: null,
  activeSessionId: null,

  setRunning: (endsAt, sessionId, totalMs) =>
    set({ status: 'running', endsAt, remaining: Math.max(0, endsAt - Date.now()), activeSessionId: sessionId, pausedRemainingMs: null, totalMs }),

  setTick: (remaining) =>
    set({ remaining }),

  setCompleted: () =>
    set({ status: 'completed', remaining: 0, endsAt: null }),

  setIdle: () =>
    set({ status: 'idle', remaining: 0, endsAt: null, activeSessionId: null, pausedRemainingMs: null, totalMs: 0 }),

  setTotalMs: (ms) => set({ totalMs: ms }),

  setPaused: (remainingMs) =>
    set({ status: 'paused', pausedRemainingMs: remainingMs, endsAt: null }),

  setResumed: (endsAt) =>
    set({ status: 'running', endsAt, remaining: Math.max(0, endsAt - Date.now()), pausedRemainingMs: null }),

  setActiveProject: (projectId, taskId = null) =>
    set({ activeProjectId: projectId, activeTaskId: taskId }),

  setActiveTag: (tagId) =>
    set({ activeTagId: tagId }),

  setSessionType: (type) =>
    set({ sessionType: type }),
}))
