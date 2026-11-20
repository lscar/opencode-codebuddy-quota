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

const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : v
  return typeof n === "number" && Number.isFinite(n) ? n : 0
}

/**
 * Personal (non-enterprise) accounts cannot use get-enterprise-user-usage: the
 * gateway rejects a personal JWT with 400/403. Their quota lives in resource
 * packages returned by get-user-resource. Sum every package's cycle figures
 * (the user chose "sum all packages") and use the earliest cycle end as reset.
 */
async function fetchUserResource(
  auth: SiteAuth,
  opts: FetchUpstreamOptions,
): Promise<UpstreamReading> {
  const doFetch = opts.fetchImpl ?? fetch
  // Resource endpoint is on the intl endpoint host for personal accounts.
  const url = `${auth.endpoint}/v2/billing/meter/get-user-resource`
  const response = await doFetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${auth.accessToken}`, "Content-Type": "application/json" },
    body: "{}",
    signal: opts.signal,
  })
  if (!response.ok) throw new Error(`upstream HTTP ${response.status}`)
  const payload = (await response.json()) as {
    code?: number
    msg?: string
    data?: { Response?: { Data?: { Accounts?: Array<Record<string, unknown>> } } }
  }
  if (payload?.code !== 0) throw new Error(`upstream code ${payload?.code}: ${payload?.msg || "unknown"}`)
  const accounts = payload.data?.Response?.Data?.Accounts ?? []
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error("upstream payload has no resource packages")
  }
  let remaining = 0
  let total = 0
  const ends: string[] = []
  for (const a of accounts) {
    const rem = num(a.CycleCapacityRemainPrecise ?? a.CapacityRemainPrecise)
    const size = num(a.CycleCapacitySizePrecise ?? a.CapacitySizePrecise)
    remaining += rem
    total += size
    if (typeof a.CycleEndTime === "string") ends.push(a.CycleEndTime)
  }
  if (!Number.isFinite(total) || total <= 0) throw new Error("upstream payload is missing capacity figures")
  ends.sort()
  const at = opts.now ? opts.now() : Date.now()
  return {
    remaining: Math.max(0, remaining),
    used: Math.max(0, total - remaining),
    total,
    cycleStart: null,
    cycleEnd: ends[0] ?? null,
    resetAt: ends[0] ?? null,
    fetchedAt: new Date(at).toISOString(),
  }
}

/**
 * Fetch the site's cycle usage with its JWT. Enterprise accounts (with an
 * enterpriseId claim) use get-enterprise-user-usage; personal accounts fall
 * back to get-user-resource. For the enterprise endpoint the host is
 * `usageHost`, while `x-domain` stays the endpoint host from `apiHeaders`
 * (never the realm domain — that triggers 12403).
 */
export async function fetchUpstream(opts: FetchUpstreamOptions): Promise<UpstreamReading> {
  if (!opts.auth.enterpriseId) return fetchUserResource(opts.auth, opts)

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
