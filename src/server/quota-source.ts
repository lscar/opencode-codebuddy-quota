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
}

const newState = (): SiteState => ({ cached: null, failedAt: null, lastError: null, inflight: null })

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
    try {
      const reading = await deps.readForSite(site, signal)
      state.cached = { reading, at: now() }
      state.failedAt = null
      state.lastError = null
      return fresh(reading)
    } catch (error) {
      const message = String((error as Error)?.message ?? error)
      state.failedAt = now()
      state.lastError = message
      return fallback(state, message)
    }
  }

  return {
    async read(site, signal) {
      const state = states[site]
      if (signal?.aborted) return fallback(state, String(signal.reason ?? "aborted"))
      if (state.cached && now() - state.cached.at < minRefreshMs) return fromCache(state.cached)
      if (state.failedAt !== null && now() - state.failedAt < minRefreshMs) {
        return fallback(state, state.lastError ?? "upstream unavailable")
      }
      if (!state.inflight) {
        state.inflight = load(site, state, signal).finally(() => { state.inflight = null })
      }
      return state.inflight
    },
  }
}
