import type { UpstreamReading } from "./upstream"

/**
 * A reading plus the freshness verdict. `fetchedAt` is null only when nothing
 * has ever been read successfully — every numeric field is null then, so a
 * caller can tell "no data" from "stale data" without a separate flag.
 */
export interface Reading {
  remaining: number | null
  used: number | null
  total: number | null
  cycleStart: string | null
  cycleEnd: string | null
  resetAt: string | null
  fetchedAt: string | null
  stale: boolean
  error: string | null
}

export interface QuotaSource {
  read(signal?: AbortSignal): Promise<Reading>
}

export interface QuotaSourceDeps {
  fetchUpstream: (signal?: AbortSignal) => Promise<UpstreamReading>
  now?: () => number
  minRefreshMs?: number
}

export const MIN_REFRESH_MS = 30_000

const EMPTY: Reading = {
  remaining: null,
  used: null,
  total: null,
  cycleStart: null,
  cycleEnd: null,
  resetAt: null,
  fetchedAt: null,
  stale: false,
  error: null,
}

/**
 * One reading shared by every window.
 *
 * The cache exists to bound how often the upstream is asked, not to make a
 * refresh feel instant: an explicit "refresh" in the UI still lands here, and
 * inside `minRefreshMs` it gets the cached answer. Concurrent readers share one
 * in-flight call so several windows opening at once cost one request.
 *
 * A failure is never cached — otherwise a 30-second window of "key missing"
 * would hide a key the user just fixed.
 */
export function createQuotaSource(deps: QuotaSourceDeps): QuotaSource {
  const now = deps.now ?? Date.now
  const minRefreshMs = deps.minRefreshMs ?? MIN_REFRESH_MS

  let cached: { reading: UpstreamReading; at: number } | null = null
  // A failure is not cached as a value, but its time is: while the upstream is
  // down every hover and every window would otherwise start its own retry, and
  // with several windows open that turns one broken endpoint into a flood.
  let failedAt: number | null = null
  let lastError: string | null = null
  let inflight: Promise<Reading> | null = null

  const fresh = (reading: UpstreamReading): Reading => ({ ...reading, stale: false, error: null })

  // The last good numbers survive a failed refresh so the GUI can show "stale"
  // with the real figure instead of blanking out.
  const fallback = (error: string): Reading =>
    cached ? { ...cached.reading, stale: true, error } : { ...EMPTY, stale: true, error: error }

  const load = async (signal?: AbortSignal): Promise<Reading> => {
    try {
      const reading = await deps.fetchUpstream(signal)
      cached = { reading, at: now() }
      failedAt = null
      lastError = null
      return fresh(reading)
    } catch (error) {
      const message = String((error as Error)?.message ?? error)
      failedAt = now()
      lastError = message
      return fallback(message)
    }
  }

  return {
    async read(signal?: AbortSignal) {
      // A signal that is already cancelled must not start or join any work.
      if (signal?.aborted) return fallback(String(signal.reason ?? "aborted"))

      if (cached && now() - cached.at < minRefreshMs) return fresh(cached.reading)
      if (failedAt !== null && now() - failedAt < minRefreshMs) {
        return fallback(lastError ?? "upstream unavailable")
      }
      // Set before awaiting so a second caller in the same tick joins this call
      // rather than starting another.
      if (!inflight) {
        inflight = load(signal).finally(() => {
          inflight = null
        })
      }
      return inflight
    },
  }
}
