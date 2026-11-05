import type { Quota } from "./quota"

export const GREEN = "#4ade80"
export const AMBER = "#f5c246"
export const RED = "#f87171"
export const NEUTRAL = "#8b90a0"

/** Below this share of the cycle, elapsed-time progress is too jumpy to color by. */
const WARMUP_TIME_PCT = 3

type Rgb = [number, number, number]

const hex = (value: string): Rgb => [
  parseInt(value.slice(1, 3), 16),
  parseInt(value.slice(3, 5), 16),
  parseInt(value.slice(5, 7), 16),
]

const mix = (from: string, to: string, t: number): Rgb => {
  const a = hex(from)
  const b = hex(to)
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ]
}

const toCss = ([r, g, b]: Rgb) => `rgb(${r}, ${g}, ${b})`

/**
 * Color by pace, not by absolute remainder: `diff` is time progress minus spend
 * progress. A gap of +5 or more is comfortable, 0 is the amber midline, -5 or
 * more is an overrun, linear in between.
 */
export function paceColor(q: Quota): string {
  if (q.diff === null || q.timePct === null) return NEUTRAL
  if (q.timePct < WARMUP_TIME_PCT) return GREEN
  const diff = q.diff
  if (diff >= 5) return GREEN
  if (diff <= -5) return RED
  // The gap is negative here, so remap it onto 0..1 for the ramp.
  return toCss(mix(AMBER, diff < 0 ? RED : GREEN, Math.abs(diff) / 5))
}

export type PaceLabel = "normal" | "ahead" | "fast" | "over" | "unknown"

export function paceLabel(q: Quota): PaceLabel {
  if (q.diff === null || q.timePct === null) return "unknown"
  // Mirror paceColor's warm-up rule, or the dialog calls "超支" on a capsule that
  // is deliberately green because the cycle just reset.
  if (q.timePct < WARMUP_TIME_PCT) return "normal"
  if (q.diff >= 5) return "normal"
  if (q.diff >= 0) return "ahead"
  if (q.diff > -5) return "fast"
  return "over"
}

export function formatCredits(value: number | null): string {
  return value === null ? "—" : value.toFixed(2)
}

export function formatPct(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(2)}%`
}

/**
 * Absolute progress, not pace: how much of the cycle's credits are spent, or how
 * much of its time has elapsed. Both are coloured the same way, so the two bars
 * in the dialog's status line can be compared at a glance.
 */
export function progressColor(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return NEUTRAL
  if (value >= 50) return GREEN
  if (value >= 20) return AMBER
  return RED
}

/**
 * The gap between time and spend, in percentage points, with the sign kept.
 * Positive means spending lags the clock (the good case); negative means the
 * credits are going faster than the cycle.
 */
export function signedPp(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—"
  if (value === 0) return "0.00 pp"
  return `${value > 0 ? "+" : "-"}${Math.abs(value).toFixed(2)} pp`
}

export function signedPpColor(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return NEUTRAL
  return value >= 0 ? GREEN : RED
}
