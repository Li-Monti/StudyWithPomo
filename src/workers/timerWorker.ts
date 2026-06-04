type WorkerMessage =
  | { type: 'start'; endsAt: number }
  | { type: 'stop' }

type WorkerEvent =
  | { type: 'tick'; remaining: number }
  | { type: 'complete' }

let intervalId: ReturnType<typeof setInterval> | null = null

self.onmessage = (e: MessageEvent<WorkerMessage>) => {
  if (e.data.type === 'start') {
    if (intervalId !== null) clearInterval(intervalId)

    const endsAt = e.data.endsAt
    intervalId = setInterval(() => {
      const remaining = Math.max(0, endsAt - Date.now())
      const msg: WorkerEvent = remaining > 0
        ? { type: 'tick', remaining }
        : { type: 'complete' }
      self.postMessage(msg)
      if (remaining === 0) {
        clearInterval(intervalId!)
        intervalId = null
      }
    }, 1000)
  }

  if (e.data.type === 'stop') {
    if (intervalId !== null) {
      clearInterval(intervalId)
      intervalId = null
    }
  }
}
