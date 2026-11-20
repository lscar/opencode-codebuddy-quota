import { spawn } from "node:child_process"
import type { Site } from "../shared"

/** Token pair returned by the login/refresh REST endpoints. */
export interface TokenPair {
  accessToken: string
  refreshToken: string
  expiresIn: number
  refreshExpiresIn: number
}

/** A credential for one site, cached by the plugin. Never sent to the GUI. */
export interface SiteAuth {
  id: string
  accessToken: string
  refreshToken: string
  expiresAt: number
  refreshExpiresAt: number
  uid: string
  enterpriseId: string | null
  realmDomain: string
  endpoint: string
  usageHost: string
}

/** Built-in site routing. `realmDomain` from the token only tags ownership. */
export const SITE_ENDPOINTS: Record<Site, { endpoint: string; usageHost: string }> = {
  cn: { endpoint: "https://copilot.tencent.com", usageHost: "https://www.codebuddy.cn" },
  intl: { endpoint: "https://www.codebuddy.ai", usageHost: "https://www.codebuddy.ai" },
}

const NO_CREDENTIALS_HEADERS: Record<string, string> = {
  "X-No-Authorization": "true",
  "X-No-User-Id": "true",
  "X-No-Enterprise-Id": "true",
  "X-No-Department-Info": "true",
  "X-No-Tenant-Id": "true",
  "Content-Type": "application/json",
  Accept: "application/json",
  "User-Agent": "CLI/2.185.0 CodeBuddy/2.185.0",
}

/** Decode a JWT payload without checking the signature; only trust our own server. */
export function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split(".")
  if (parts.length < 2) return {}
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8")
    const parsed = JSON.parse(json)
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

const asString = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null

/** Build a SiteAuth from a freshly obtained token pair. */
export function authFromToken(
  site: Site,
  token: TokenPair,
  now: () => number = Date.now,
): SiteAuth {
  const payload = decodeJwtPayload(token.accessToken)
  const uid = asString(payload.sub) ?? ""
  const enterpriseId = asString(payload.enterprise_id)
  const realmDomain = hostOf(asString(payload.iss) ?? "")
  const route = SITE_ENDPOINTS[site]
  const t = now()
  return {
    id: `${site}:${uid}`,
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    expiresAt: t + token.expiresIn * 1000,
    refreshExpiresAt: t + token.refreshExpiresIn * 1000,
    uid,
    enterpriseId,
    realmDomain,
    endpoint: route.endpoint,
    usageHost: route.usageHost,
  }
}

export interface AuthState {
  state: string
  authUrl: string
}

interface GetAuthStateDeps {
  fetchImpl?: typeof fetch
  retries?: number
}

/** Step 1 of login: ask the server for a state + browser auth URL, no credentials. */
export async function getAuthState(
  site: Site,
  deps: GetAuthStateDeps = {},
): Promise<AuthState> {
  const doFetch = deps.fetchImpl ?? fetch
  const url = `${SITE_ENDPOINTS[site].endpoint}/v2/plugin/auth/state?platform=CLI`
  const retries = deps.retries ?? 2
  let lastErr: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res: Response
    try {
      res = await doFetch(url, { method: "POST", headers: NO_CREDENTIALS_HEADERS, body: "{}" })
    } catch (err) {
      lastErr = err
      continue // network failure — retry
    }
    // A 4xx is a real answer, not a transient failure. It must bypass the retry
    // loop entirely (a throw inside the try below would be swallowed by catch).
    if (!res.ok && res.status < 500) {
      throw new Error(`auth/state HTTP ${res.status}`)
    }
    try {
      const json = (await res.json()) as {
        code?: number
        data?: { state?: string; authUrl?: string }
      }
      const state = json.data?.state
      const authUrl = json.data?.authUrl
      if (!state || !authUrl) throw new Error("auth/state missing state or authUrl")
      return { state, authUrl }
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("getAuthState failed")
}

/** Open a URL in the system default browser; opener is injectable for tests. */
export function openBrowser(
  url: string,
  deps: { opener?: (url: string) => void } = {},
): void {
  const opener =
    deps.opener ??
    ((u: string) => {
      // `cmd /c start` misparses URLs containing `&` (the authUrl always has
      // `?platform=CLI&state=...`). Use a shell-free opener on Windows.
      const cmd = process.platform === "win32" ? "rundll32" : process.platform === "darwin" ? "open" : "xdg-open"
      const args = process.platform === "win32"
        ? ["url.dll,FileProtocolHandler", u]
        : [u]
      const child = spawn(cmd, args, { detached: true, stdio: "ignore" })
      child.unref()
    })
  opener(url)
}

const PENDING_CODE = 11217

interface PollTokenDeps {
  fetchImpl?: typeof fetch
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  timeoutMs?: number
  intervalMs?: number
}

/** Step 3 of login: poll auth/token until the browser login completes. */
export async function pollToken(
  site: Site,
  state: string,
  deps: PollTokenDeps = {},
): Promise<SiteAuth> {
  const doFetch = deps.fetchImpl ?? fetch
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const timeoutMs = deps.timeoutMs ?? 5 * 60_000
  const intervalMs = deps.intervalMs ?? 1000
  const url = `${SITE_ENDPOINTS[site].endpoint}/v2/plugin/auth/token?state=${encodeURIComponent(state)}`
  const deadline = now() + timeoutMs

  for (;;) {
    const res = await doFetch(url, { method: "GET", headers: NO_CREDENTIALS_HEADERS })
    const json = (await res.json()) as {
      code?: number
      msg?: string
      data?: TokenPair
    }
    if (json.data?.accessToken) {
      return authFromToken(site, json.data, now)
    }
    // Only the documented pending code means "keep waiting". The message is
    // advisory only — relying on its text could mask a real auth error.
    const pending = json.code === PENDING_CODE
    if (!pending) {
      throw new Error(`pollToken failed: code=${json.code ?? "?"} msg=${json.msg ?? "?"}`)
    }
    if (now() >= deadline) throw new Error("pollToken timed out waiting for login")
    await sleep(intervalMs)
  }
}
