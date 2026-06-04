import { useRef, useCallback, useEffect } from 'react'
import { cn } from '@/lib/utils'
import type { SessionType } from '@/types/database'

const S = 256
const CX = S / 2
const CY = S / 2
const RING_R = 112
const RING_W = 10
const CLOCK_R = 94
const HANDLE_R = 9
const CIRC = 2 * Math.PI * RING_R
const TWO_PI = 2 * Math.PI

// Duration range
const MIN_MIN = 5
const MAX_MIN = 120

// Wrap-detection thresholds (radians)
// If prev > WRAP_HIGH and raw < WRAP_LOW  → forward wrap attempt → clamp to max
// If prev < WRAP_LOW  and raw > WRAP_BACK → backward wrap attempt → clamp to min
const WRAP_HIGH = Math.PI * 1.5   // 270°
const WRAP_LOW  = Math.PI / 6     // 30°
const WRAP_BACK = Math.PI * (5 / 3) // 300°

const RING_COLOR: Record<SessionType, string> = {
  work: 'var(--primary)',
  short_break: '#10b981',
  long_break: '#3b82f6',
}

function formatDuration(min: number) {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

interface CircularTimerRingProps {
  totalMs: number
  remainingMs: number
  status: 'idle' | 'running' | 'paused' | 'completed'
  sessionType: SessionType
  durationMin: number
  onDurationChange: (min: number) => void
  displayTime: string
  className?: string
}

export function CircularTimerRing({
  totalMs,
  remainingMs,
  status,
  sessionType,
  durationMin,
  onDurationChange,
  displayTime,
  className,
}: CircularTimerRingProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const dragging = useRef(false)
  // Tracks the raw radian angle of the previous drag position to detect wraps
  const prevAngleRef = useRef<number>(0)

  const isIdle = status === 'idle'
  const color = RING_COLOR[sessionType] ?? 'var(--primary)'

  // Idle: 5 min = 0° (top), 120 min = 360° (same top, full circle)
  const idleFrac = Math.max(0, Math.min(1, (durationMin - MIN_MIN) / (MAX_MIN - MIN_MIN)))
  const idleAngleRad = idleFrac * TWO_PI

  // Running/paused: fills the full circle as elapsed/total
  const runFrac = totalMs > 0
    ? Math.max(0, Math.min(1, (totalMs - remainingMs) / totalMs))
    : 0

  const arcFrac = isIdle ? idleFrac : runFrac
  const dashOffset = CIRC * (1 - arcFrac)

  // Handle sits at the end of the idle arc (top for both 5 min and 120 min)
  const handleX = CX + RING_R * Math.sin(idleAngleRad)
  const handleY = CY - RING_R * Math.cos(idleAngleRad)

  // Convert pointer position to a snapped duration in minutes.
  // Uses prevAngleRef to prevent wrapping past min or max.
  const angleToMin = useCallback((clientX: number, clientY: number): number => {
    const svg = svgRef.current
    if (!svg) return MIN_MIN
    const rect = svg.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2

    let raw = Math.atan2(clientX - cx, -(clientY - cy))
    if (raw < 0) raw += TWO_PI

    const prev = prevAngleRef.current

    // Block clockwise wrap: was near end (>270°), jumped to near start (<30°)
    if (prev > WRAP_HIGH && raw < WRAP_LOW) {
      prevAngleRef.current = TWO_PI
      return MAX_MIN
    }

    // Block counter-clockwise wrap: was near start (<30°), jumped to near end (>300°)
    if (prev < WRAP_LOW && raw > WRAP_BACK) {
      prevAngleRef.current = 0
      return MIN_MIN
    }

    prevAngleRef.current = raw
    const min = (raw / TWO_PI) * (MAX_MIN - MIN_MIN) + MIN_MIN
    return Math.max(MIN_MIN, Math.min(MAX_MIN, Math.round(min / 5) * 5))
  }, []) // stable — reads only refs, no reactive deps needed

  // Register global pointer listeners so drag works outside the SVG bounds
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (dragging.current) onDurationChange(angleToMin(e.clientX, e.clientY))
    }
    const onMouseUp = () => { dragging.current = false }
    const onTouchMove = (e: TouchEvent) => {
      if (!dragging.current) return
      e.preventDefault()
      onDurationChange(angleToMin(e.touches[0].clientX, e.touches[0].clientY))
    }
    const onTouchEnd = () => { dragging.current = false }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onTouchEnd)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
    }
  }, [angleToMin, onDurationChange])

  // On drag start: seed prevAngle from the current durationMin so wrap detection
  // knows which side of the circle we're starting from.
  function startDrag(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault()
    dragging.current = true
    prevAngleRef.current = ((durationMin - MIN_MIN) / (MAX_MIN - MIN_MIN)) * TWO_PI
  }

  const textY = isIdle ? CY - 12 : CY

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${S} ${S}`}
      width={S}
      height={S}
      className={cn('select-none', className)}
      style={{ overflow: 'visible' }}
    >
      {/* Clock face */}
      <circle cx={CX} cy={CY} r={CLOCK_R} fill="var(--card)" />

      {/* Background ring */}
      <circle
        cx={CX} cy={CY} r={RING_R}
        fill="none"
        stroke="var(--border)"
        strokeWidth={RING_W}
      />

      {/* Progress / duration arc */}
      {arcFrac > 0.004 && (
        <circle
          cx={CX} cy={CY} r={RING_R}
          fill="none"
          stroke={color}
          strokeWidth={RING_W}
          strokeLinecap="round"
          strokeDasharray={`${CIRC} ${CIRC}`}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90, ${CX}, ${CY})`}
          opacity={isIdle ? 0.35 : 1}
          style={{ transition: status === 'running' ? 'stroke-dashoffset 1s linear' : 'none' }}
        />
      )}

      {/* Time display */}
      <text
        x={CX}
        y={textY}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize="44"
        fontWeight="bold"
        fontFamily="ui-monospace, 'Cascadia Code', Menlo, Consolas, monospace"
        fill="var(--foreground)"
      >
        {displayTime}
      </text>

      {/* Duration label — idle only */}
      {isIdle && (
        <text
          x={CX}
          y={CY + 16}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="12"
          fill="var(--muted-foreground)"
        >
          {formatDuration(durationMin)}
        </text>
      )}

      {/* Drag handle — idle only */}
      {isIdle && (
        <circle
          cx={handleX}
          cy={handleY}
          r={HANDLE_R}
          fill={color}
          stroke="var(--background)"
          strokeWidth={3}
          style={{ cursor: 'grab' }}
          onMouseDown={startDrag}
          onTouchStart={startDrag}
        />
      )}
    </svg>
  )
}
