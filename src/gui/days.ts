/**
 * Whole-calendar-day helpers for the "N days left" label.
 *
 * The label answers "how many days of this cycle remain", counted inclusively from
 * today through the cycle's last day. A millisecond count would instead answer
 * "how long until the reset instant", which reads as 0 on the cycle's final day —
 * the user sees the last day of the billing period as already over.
 */

/** Reads the date part of an upstream timestamp (`2026-11-27 23:59:59`) as local midnight. */
export function parseCycleDay(value: unknown): number | null {
  if (typeof value !== "string") return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim())
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
}

const DAY_MS = 86_400_000

const startOfDay = (ms: number) => {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/**
 * Days remaining in the cycle, counting today and the cycle's last day.
 * `null` when the cycle end is unusable or the cycle has already ended.
 */
export function daysLeftInCycle(cycleEnd: unknown, now: number): number | null {
  const endDay = parseCycleDay(cycleEnd)
  if (endDay === null) return null
  const today = startOfDay(now)
  if (today > endDay) return null
  return Math.round((endDay - today) / DAY_MS) + 1
}
