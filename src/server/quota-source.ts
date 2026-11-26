import type { Site } from "../shared"
import type { UpstreamReading } from "./upstream"

/**
 * A reading plus the freshness verdict. `fetchedAt` is null only when nothing
 * has ever been read successfully — every numeric field is null then.
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
  /** This answer was served from the cache; the upstream was not called. */
  cached: boolean
  /** How old the numbers are, in whole seconds. Null when there are no numbers. */
  ageSeconds: number | null
}

export interface QuotaSource {
  read(site: Site, signal?: AbortSignal): Promise<Reading>
  /**
   * Called after a fresh login. Drops the failure cooldown *and* the cached
   * reading, so the next read re-fetches with the new token instead of serving
   * the old account's numbers from the 30-second cache.
   */
  clearFailure(site: Site): void
}

export interface QuotaSourceDeps {
  /** Site-based fetch callback; the server wraps it over store.ensureFresh + fetchUpstream. */
  readForSite: (site: Site, signal?: AbortSignal) => Promise<UpstreamReading>
  now?: () => number
  minRefreshMs?: number
}

export const MIN_REFRESH_MS = 30_000

const EMPTY: Reading = {
  remaining: null, used: null, total: null,
  cycleStart: null, cycleEnd: null, resetAt: null,
  fetchedAt: null, stale: false, error: null, cached: false, ageSeconds: null,
}

interface SiteState {
  cached: { reading: UpstreamReading; at: number } | null
  failedAt: number | null
  lastError: string | null
  inflight: Promise<Reading> | null
  /** Bumped on clearFailure so a read that began with an old token cannot write
   * its late result back into the cache after a new login. */
  epoch: number
}

const newState = (): SiteState => ({ cached: null, failedAt: null, lastError: null, inflight: null, epoch: 0 })

/** Per-site cache: one broken site cannot starve the other. */
export function createQuotaSource(deps: QuotaSourceDeps): QuotaSource {
  const now = deps.now ?? Date.now
  const minRefreshMs = deps.minRefreshMs ?? MIN_REFRESH_MS
  const states: Record<Site, SiteState> = { cn: newState(), intl: newState() }

  const ageOf = (at: number) => Math.max(0, Math.round((now() - at) / 1000))
  const fresh = (r: UpstreamReading): Reading => ({ ...r, stale: false, error: null, cached: false, ageSeconds: 0 })
  const fromCache = (e: { reading: UpstreamReading; at: number }): Reading => ({
    ...e.reading, stale: false, error: null, cached: true, ageSeconds: ageOf(e.at),
  })
  const fallback = (state: SiteState, error: string): Reading =>
    state.cached
      ? { ...state.cached.reading, stale: true, error, cached: false, ageSeconds: ageOf(state.cached.at) }
      : { ...EMPTY, stale: true, error }

  const load = async (site: Site, state: SiteState, signal?: AbortSignal): Promise<Reading> => {
    const epoch = state.epoch
    try {
      const reading = await deps.readForSite(site, signal)
      // A clearFailure (new login) may have happened while this request was in
      // flight. Its result belongs to the old token — return it to this caller
      // but never cache it, so the next read fetches with the new token.
      if (state.epoch !== epoch) return fresh(reading)
      state.cached = { reading, at: now() }
      state.failedAt = null
      state.lastError = null
      return fresh(reading)
    } catch (error) {
      const message = String((error as Error)?.message ?? error)
      if (state.epoch !== epoch) return fallback(state, message)
      state.failedAt = now()
      state.lastError = message
      return fallback(state, message)
    }
  }

  return {
    clearFailure(site) {
      const state = states[site]
      state.epoch += 1
      state.failedAt = null
      state.lastError = null
      state.cached = null
      // Release the single-flight slot so the next read starts a fresh request
      // with the new token instead of awaiting the stale in-flight one.
      state.inflight = null
    },
    async read(site, signal) {
      const state = states[site]
      if (signal?.aborted) return fallback(state, String(signal.reason ?? "aborted"))
      if (state.cached && now() - state.cached.at < minRefreshMs) return fromCache(state.cached)
      if (state.failedAt !== null && now() - state.failedAt < minRefreshMs) {
        return fallback(state, state.lastError ?? "upstream unavailable")
      }
      if (!state.inflight) {
        // Identity check: a clearFailure may have released the slot and a newer
        // request taken it while this one was still in flight. Only the current
        // owner may clear it — otherwise a late old request would drop the new
        // one's slot and cause a redundant upstream call.
        const pending = load(site, state, signal).finally(() => {
          if (state.inflight === pending) state.inflight = null
        })
        state.inflight = pending
      }
      return state.inflight
    },
  }
}
