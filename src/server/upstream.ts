import { apiHeaders } from "./headers"
import type { SiteAuth } from "./login"

export interface UpstreamReading {
  remaining: number
  used: number
  total: number
  cycleStart: string | null
  cycleEnd: string | null
  resetAt: string | null
  fetchedAt: string
}

export interface FetchUpstreamOptions {
  auth: SiteAuth
  signal?: AbortSignal
  fetchImpl?: typeof fetch
  now?: () => number
}

/**
 * Fetch the site's cycle usage with its JWT. The endpoint host is `usageHost`,
 * while `x-domain` stays the endpoint host from `apiHeaders` (never the realm
 * domain — that triggers 12403).
 */
export async function fetchUpstream(opts: FetchUpstreamOptions): Promise<UpstreamReading> {
  const doFetch = opts.fetchImpl ?? fetch
  const url = `${opts.auth.usageHost}/v2/billing/meter/get-enterprise-user-usage`
  const response = await doFetch(url, {
    method: "POST",
    headers: { ...apiHeaders(opts.auth), "Content-Type": "application/json" },
    body: "{}",
    signal: opts.signal,
  })

  if (!response.ok) throw new Error(`upstream HTTP ${response.status}`)

  const payload = (await response.json()) as {
    code?: number
    msg?: string
    data?: Record<string, unknown>
  }
  if (payload?.code !== 0) throw new Error(`upstream code ${payload?.code}: ${payload?.msg || "unknown"}`)

  const data = payload.data ?? {}
  const used = Number(data.credit)
  const total = Number(data.limitNum)
  if (!Number.isFinite(used) || !Number.isFinite(total)) {
    throw new Error("upstream payload is missing credit/limitNum")
  }

  const at = opts.now ? opts.now() : Date.now()
  return {
    remaining: Math.max(0, total - used),
    used,
    total,
    cycleStart: typeof data.cycleStartTime === "string" ? data.cycleStartTime : null,
    cycleEnd: typeof data.cycleEndTime === "string" ? data.cycleEndTime : null,
    resetAt: typeof data.cycleResetTime === "string" ? data.cycleResetTime : null,
    fetchedAt: new Date(at).toISOString(),
  }
}
