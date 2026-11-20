/**
 * The CodeBuddy enterprise usage endpoint. copilot.tencent.com and
 * www.codebuddy.cn are two entry points to the same service; the former is what
 * the official CLI and the open-platform docs use, so it is the safer default.
 * www.codebuddy.ai is a separate backend — do not mix it in.
 */
const UPSTREAM = "https://copilot.tencent.com/v2/billing/meter/get-enterprise-user-usage"

export const KEY_ENV = "OPENCODE_CODEBUDDY_API_KEY"

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
  key: string
  signal?: AbortSignal
  fetchImpl?: typeof fetch
  now?: () => number
}

/**
 * The one place the credential is read. A future config file changes only this
 * function, not the callers.
 */
export function readApiKey(): string {
  return (process.env[KEY_ENV] ?? "").trim()
}

/**
 * Upstream answers with `credit` (used) and `limitNum` (this cycle's total), so
 * `remaining` has to be derived here — a client reading a single JSON path
 * could not subtract.
 */
export async function fetchUpstream(opts: FetchUpstreamOptions): Promise<UpstreamReading> {
  const key = opts.key.trim()
  if (!key) throw new Error(`${KEY_ENV} is not set`)

  const doFetch = opts.fetchImpl ?? fetch
  const response = await doFetch(UPSTREAM, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
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
    // Clamped so an overrun reads as zero left rather than a negative balance.
    remaining: Math.max(0, total - used),
    used,
    total,
    cycleStart: typeof data.cycleStartTime === "string" ? data.cycleStartTime : null,
    cycleEnd: typeof data.cycleEndTime === "string" ? data.cycleEndTime : null,
    resetAt: typeof data.cycleResetTime === "string" ? data.cycleResetTime : null,
    fetchedAt: new Date(at).toISOString(),
  }
}
