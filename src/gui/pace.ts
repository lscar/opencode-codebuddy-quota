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
 * Color by pace, not by absolute remainder: `diff = usedPct - timePct`.
 * <= 0 is green, 5 is amber, >= 10 is red, linear in between.
 */
export function paceColor(q: Quota): string {
  if (q.diff === null || q.timePct === null) return NEUTRAL
  if (q.timePct < WARMUP_TIME_PCT) return GREEN
  const diff = q.diff
  if (diff <= 0) return GREEN
  if (diff >= 10) return RED
  if (diff <= 5) return toCss(mix(GREEN, AMBER, diff / 5))
  return toCss(mix(AMBER, RED, (diff - 5) / 5))
}

export type PaceLabel = "normal" | "fast" | "over" | "unknown"

export function paceLabel(q: Quota): PaceLabel {
  if (q.diff === null || q.timePct === null) return "unknown"
  // Mirror paceColor's warm-up rule, or the dialog calls "超支" on a capsule that
  // is deliberately green because the cycle just reset.
  if (q.timePct < WARMUP_TIME_PCT) return "normal"
  if (q.diff > 5) return "over"
  if (q.diff > 0) return "fast"
  return "normal"
}

export function formatCredits(value: number | null): string {
  return value === null ? "—" : value.toFixed(2)
}

export function formatPct(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(2)}%`
}
