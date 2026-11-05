export type QuotaStatus = "ok" | "cached" | "stale" | "error"

export interface Quota {
  status: QuotaStatus
  remaining: number | null
  used: number | null
  total: number | null
  usedPct: number | null
  timePct: number | null
  diff: number | null
  cycleStart: string | null
  cycleEnd: string | null
  resetAt: string | null
  fetchedAt: string | null
  /** Age of the numbers in whole seconds, as the server counted it. */
  ageSeconds: number | null
  error: string | null
}

export interface NormalizeContext {
  now: number
  fallback?: Quota | null
}

const round2 = (n: number) => Math.round(n * 100) / 100

function num(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value
  return typeof n === "number" && Number.isFinite(n) ? n : null
}

/**
 * "2026-10-28 00:00:00" is the upstream's local-time format. `new Date(str)` treats it
 * as UTC in some engines, which would shift timePct by the UTC offset, so parse the
 * parts by hand into local time.
 */
export function parseLocalTime(value: unknown): number | null {
  if (typeof value !== "string") return null
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value.trim())
  if (!m) return null
  const [, y, mo, d, h, mi, s] = m.map(Number)
  const t = new Date(y, mo - 1, d, h, mi, s).getTime()
  return Number.isFinite(t) ? t : null
}

function empty(status: QuotaStatus, error: string | null): Quota {
  return {
    status,
    remaining: null,
    used: null,
    total: null,
    usedPct: null,
    timePct: null,
    diff: null,
    cycleStart: null,
    cycleEnd: null,
    resetAt: null,
    fetchedAt: null,
    ageSeconds: null,
    error,
  }
}

function timeProgress(
  startMs: number | null,
  endMs: number | null,
  atMs: number | null,
): number | null {
  if (startMs === null || endMs === null || atMs === null) return null
  if (endMs <= startMs) return null
  return round2(((atMs - startMs) / (endMs - startMs)) * 100)
}

export function normalizeQuota(payload: unknown, ctx: NormalizeContext): Quota {
  /**
   * `keepFallback` separates two different failures:
   * - the server said `ok: false` — it is unavailable, and a previous reading
   *   must not be dressed up as merely stale, so the fallback is dropped;
   * - the answer arrived but is unusable — the numbers are bad, not the line,
   *   so the last good reading still describes the quota.
   */
  const unusable = (error: string, keepFallback: boolean): Quota =>
    keepFallback && ctx.fallback ? { ...ctx.fallback, status: "stale", error } : empty("error", error)

  if (typeof payload !== "object" || payload === null) {
    return unusable(
      typeof payload === "string"
        ? `unexpected response: ${payload.slice(0, 80)}`
        : "empty response",
      true,
    )
  }

  const data = payload as Record<string, unknown>
  const error = typeof data.error === "string" ? data.error : null

  if (data.ok !== true) return unusable(error ?? "quota service reported no reading", false)

  const total = num(data.total)
  const used = num(data.used)
  const remaining = num(data.remaining)
  if (total === null || total <= 0 || used === null || remaining === null) {
    return unusable(error ?? "payload is missing a usable total/used/remaining", true)
  }

  const cycleStart = typeof data.cycleStart === "string" ? data.cycleStart : null
  const cycleEnd = typeof data.cycleEnd === "string" ? data.cycleEnd : null
  const resetAt = typeof data.resetAt === "string" ? data.resetAt : null
  const fetchedAt = typeof data.fetchedAt === "string" ? data.fetchedAt : null

  const usedPct = round2((used / total) * 100)
  // Date.parse answers NaN for an unparseable string, and `NaN ?? x` is NaN, so
  // guard with isFinite rather than relying on a nullish fallback. An unknown
  // fetch time cannot anchor the time progress: falling back to "now" would make
  // the pace drift with every render, so report no progress instead.
  const parsedAt = fetchedAt ? Date.parse(fetchedAt) : NaN
  const atMs = Number.isFinite(parsedAt) ? parsedAt : null
  // The cycle ends when the next one starts, not on its last second, so progress
  // reaches 100% exactly when the allowance resets. Using `cycleEnd` (23:59:59)
  // would read as "period over" a second before the credits come back.
  const timePct = timeProgress(
    parseLocalTime(cycleStart),
    parseLocalTime(resetAt) ?? parseLocalTime(cycleEnd),
    atMs,
  )
  // Time progress minus spend progress: positive means the credits are being
  // used more slowly than the cycle is passing, which is the healthy direction.
  const diff =
    usedPct !== null && timePct !== null && Number.isFinite(timePct) ? round2(timePct - usedPct) : null

  const status: QuotaStatus =
    data.stale === true ? "stale" : data.cached === true ? "cached" : "ok"
  const ageSeconds = num(data.ageSeconds)

  return {
    status,
    remaining,
    used,
    total,
    usedPct,
    timePct,
    diff,
    cycleStart,
    cycleEnd,
    resetAt,
    fetchedAt,
    ageSeconds: ageSeconds === null ? null : Math.round(ageSeconds),
    error: error ?? null,
  }
}

/** The number inside the capsule: remaining share as a whole 0..100, no percent sign. */
export function remainingPercent(q: Quota): number | null {
  if (q.total === null || q.total <= 0) return null
  // Derive from used rather than trusting `remaining`: the upstream clamps remaining
  // to >= 0, so an overrun would otherwise read as a healthy 89%.
  const used = q.used
  if (used === null) {
    if (q.remaining === null) return null
    return Math.min(100, Math.max(0, Math.round((q.remaining / q.total) * 100)))
  }
  const pct = Math.round(((q.total - used) / q.total) * 100)
  return Math.min(100, Math.max(0, pct))
}

/**
 * Where the time-progress marker sits on a bar whose fill is the *remaining* share.
 * The bar reads left-to-right as "what is left", so the marker is the remaining
 * share of the cycle, not the elapsed one: both are measured from the same edge.
 */
export function timeLeftPercent(q: Quota): number | null {
  if (q.timePct === null || !Number.isFinite(q.timePct)) return null
  return Math.min(100, Math.max(0, 100 - q.timePct))
}

/**
 * The remaining share at full precision, for every label that is not the capsule.
 * The capsule rounds it to a whole number; the tooltip and the dialog must agree
 * with each other, so both read this one function.
 */
export function remainingShare(q: Quota): number | null {
  if (q.usedPct === null || q.used === null || q.total === null) return null
  const pct = 100 - q.usedPct
  return Math.max(0, Math.round(pct * 100) / 100)
}
