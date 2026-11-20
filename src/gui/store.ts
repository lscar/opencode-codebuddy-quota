import type { Site } from "../shared"
import { normalizeQuota, type Quota } from "./quota"

/** The shape `ctx.client.rpc(CodebuddyQuota)` satisfies; kept loose so tests can fake it. */
export interface QuotaClient {
  read(input: { site?: Site }): Promise<unknown>
  login?(input: { site: Site }): Promise<unknown>
}

export interface QuotaStore {
  read(): Quota
  subscribe(listener: (q: Quota) => void): () => void
  refresh(options?: { force?: boolean; maxAgeMs?: number; site?: Site }): Promise<void>
  login(site: Site): Promise<boolean>
  start(): () => void
}

/** Background safety net only; the capsule refreshes on hover and the dialog on open. */
const REFRESH_MS = 30 * 60_000
/** Hover refreshes only when the reading is older than this, so mouse traffic cannot spam. */
export const HOVER_MIN_AGE_MS = 60_000
const STALE_AFTER_RESUME_MS = 2 * 60_000

const idle = (status: "error", error: string | null): Quota => ({
  status,
  site: "cn",
  sites: [
    { site: "cn", available: false, accounts: [], activeId: null },
    { site: "intl", available: false, accounts: [], activeId: null },
  ],
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
})

/**
 * One read of the quota over the plugin RPC.
 *
 * Both a rejection (`RPC is unavailable`, the server restarting) and an explicit
 * `ok: false` mean "no answer", but they keep the previous numbers differently:
 * a rejection keeps them and marks them stale, because the quota itself is
 * probably fine; `ok: false` is the server saying it has nothing, so the old
 * numbers are dropped rather than dressed up as merely stale.
 */
export async function readQuota(opts: {
  client: QuotaClient
  fallback?: Quota | null
  now?: number
  site?: Site
}): Promise<Quota> {
  const now = opts.now ?? Date.now()
  let body: unknown
  try {
    body = await opts.client.read(opts.site ? { site: opts.site } : {})
  } catch (error) {
    const message = String((error as Error)?.message ?? error)
    return opts.fallback
      ? { ...opts.fallback, status: "stale", error: message }
      : idle("error", message)
  }
  // An explicit "unavailable" must never be dressed up as a stale number, so
  // the fallback is deliberately not offered here.
  return normalizeQuota(body, { now })
}

export function createQuotaStore(client: () => QuotaClient): QuotaStore {
  let current: Quota = normalizeQuota(null, { now: Date.now() })
  let lastAttempt = 0
  let inflight: Promise<void> | null = null
  let pendingSite: Site | null = null
  let started = false
  const listeners = new Set<(q: Quota) => void>()

  const emit = (next: Quota) => {
    current = next
    for (const listener of listeners) listener(next)
  }

  /**
   * `force` skips every GUI-side age check (the dialog's refresh button); the
   * server's own 30-second cache still applies behind it.
   * `maxAgeMs` refreshes only when the last attempt is older than that, which is
   * how hover keeps working without spamming on every pointer move.
   */
  const refresh = async (options: { force?: boolean; maxAgeMs?: number; site?: Site } = {}) => {
    // One request at a time: without this, a forced refresh racing a hover refresh
    // can land out of order and let the older reading win.
    if (inflight) {
      // A different site requested while another read is in flight must not be
      // silently dropped — queue it to run once the current read settles.
      if (options.site && options.site !== current.site) pendingSite = options.site
      return inflight
    }
    const now = Date.now()
    const maxAge = options.force ? 0 : (options.maxAgeMs ?? REFRESH_MS)
    if (now - lastAttempt < maxAge) return
    lastAttempt = now

    inflight = (async () => {
      try {
        // Only a reading that actually carried data is worth falling back to.
        const usable = current.remaining !== null ? current : null
        let next: Quota
        try {
          // Read the client per request: it changes when the server restarts.
          next = await readQuota({ client: client(), fallback: usable, site: options.site })
        } catch (error) {
          // `client()` itself can throw when the server client is unavailable,
          // which is the same situation as a rejected RPC call.
          const message = String((error as Error)?.message ?? error)
          next = usable ? { ...usable, status: "stale", error: message } : idle("error", message)
        }
        emit(next)
      } finally {
        inflight = null
        const queued = pendingSite
        pendingSite = null
        if (queued) void refresh({ force: true, site: queued })
      }
    })()

    return inflight
  }

  const start = () => {
    if (started) return () => {}
    started = true
    const hasDocument = typeof globalThis.document !== "undefined"
    const tick = () => {
      // A hidden window must not poll; on return, refresh only if the data aged.
      if (hasDocument && globalThis.document.hidden) return
      void refresh()
    }
    const onVisible = () => {
      if (globalThis.document.hidden) return
      if (Date.now() - lastAttempt >= STALE_AFTER_RESUME_MS) void refresh()
    }
    const timer = setInterval(tick, REFRESH_MS)
    if (hasDocument) globalThis.document.addEventListener("visibilitychange", onVisible)
    // The one place the capsule gets its first number without any interaction.
    void refresh({ force: true })
    return () => {
      clearInterval(timer)
      if (hasDocument) globalThis.document.removeEventListener("visibilitychange", onVisible)
      started = false
    }
  }

  return {
    read: () => current,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    refresh,
    async login(site) {
      try {
        const loginFn = client().login
        if (!loginFn) return false
        const result = (await loginFn({ site })) as { ok?: boolean } | null
        const ok = result?.ok === true
        if (ok) await refresh({ force: true, site })
        return ok
      } catch {
        return false
      }
    },
    start,
  }
}
