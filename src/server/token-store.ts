import { chmodSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { Site } from "../shared"
import { refreshHeaders } from "./headers"
import type { SiteAuth } from "./login"

/** Two-site cache. `accounts`/`activeId` reserve room for future multi-account. */
export interface TokenCache {
  accounts: Record<Site, SiteAuth[]>
  activeId: Record<Site, string | null>
  selected: Site
}

export const CACHE_FILENAME = "codebuddy-quota-v2-auth.json"

export function cachePath(dir?: string): string {
  const base = dir ?? join(homedir(), ".config", "opencode")
  return join(base, CACHE_FILENAME)
}

const emptyCache = (): TokenCache => ({
  accounts: { cn: [], intl: [] },
  activeId: { cn: null, intl: null },
  selected: "cn",
})

type ReadFile = () => string
type WriteFile = (path: string, data: string) => void

const defaultRead = (path: string): ReadFile => () => readFileSync(path, "utf8")
const defaultWrite = (_path: string): WriteFile => (p, data) => {
  writeFileSync(p, data, { mode: 0o600 })
  // `mode` only applies on create; tighten an existing (e.g. 0644) file too.
  try { chmodSync(p, 0o600) } catch { /* no-op on platforms without POSIX modes */ }
}

const isSite = (v: unknown): v is Site => v === "cn" || v === "intl"

/** Guard against a hand-corrupted cache entry with missing/ill-typed fields. */
const isSiteAuth = (v: unknown): v is SiteAuth => {
  if (typeof v !== "object" || v === null) return false
  const a = v as Record<string, unknown>
  return (
    typeof a.id === "string" &&
    typeof a.accessToken === "string" &&
    typeof a.refreshToken === "string" &&
    typeof a.expiresAt === "number" &&
    typeof a.refreshExpiresAt === "number" &&
    typeof a.uid === "string" &&
    typeof a.endpoint === "string" &&
    typeof a.usageHost === "string" &&
    (a.enterpriseId === null || typeof a.enterpriseId === "string")
  )
}
const filterAuths = (v: unknown): SiteAuth[] =>
  Array.isArray(v) ? (v as unknown[]).filter(isSiteAuth) : []

/** Read the cache, migrating the old flat `{ cn, intl, selected }` format. */
export function readCache(readFile?: ReadFile): TokenCache {
  const raw = readFile ? readFile() : (() => {
    try {
      return defaultRead(cachePath())()
    } catch {
      return ""
    }
  })()
  if (!raw) return emptyCache()
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return emptyCache()
  }

  // New format: { accounts, activeId, selected }
  if (parsed.accounts && typeof parsed.accounts === "object") {
    const accounts = parsed.accounts as Record<string, unknown>
    const active = (parsed.activeId ?? {}) as Record<string, unknown>
    const cn = filterAuths(accounts.cn)
    const intl = filterAuths(accounts.intl)
    const selectSite = isSite(parsed.selected) ? parsed.selected : "cn"
    const pick = (listed: unknown, accounts: SiteAuth[]): string | null => {
      const id = typeof listed === "string" ? listed : (accounts[0]?.id ?? null)
      return id && accounts.some((a) => a.id === id) ? id : (accounts[0]?.id ?? null)
    }
    return {
      accounts: { cn, intl },
      activeId: { cn: pick(active.cn, cn), intl: pick(active.intl, intl) },
      selected: selectSite,
    }
  }

  // Old format: { cn: SiteAuth|null, intl: SiteAuth|null, selected }
  const cn = isSiteAuth(parsed.cn) ? parsed.cn : null
  const intl = isSiteAuth(parsed.intl) ? parsed.intl : null
  const accounts: Record<Site, SiteAuth[]> = {
    cn: cn ? [cn] : [],
    intl: intl ? [intl] : [],
  }
  return {
    accounts,
    activeId: { cn: cn?.id ?? null, intl: intl?.id ?? null },
    selected: isSite(parsed.selected) ? parsed.selected : "cn",
  }
}

export function writeCache(cache: TokenCache, writeFile?: WriteFile, dir?: string): void {
  const path = cachePath(dir)
  const target = writeFile ?? defaultWrite(path)
  target(path, JSON.stringify(cache, null, 2))
}

/** The currently active account for a site; callers never handle 1 vs N. */
export function activeAccount(cache: TokenCache, site: Site): SiteAuth | null {
  const id = cache.activeId[site]
  if (!id) return null
  return cache.accounts[site].find((a) => a.id === id) ?? null
}

/** Store/replace an account for its site and make it active there. */
export function archive(cache: TokenCache, incoming: SiteAuth): TokenCache {
  const site: Site = incoming.id.startsWith("intl:") ? "intl" : "cn"
  const list = cache.accounts[site].filter((a) => a.id !== incoming.id)
  list.push(incoming)
  return {
    ...cache,
    accounts: { ...cache.accounts, [site]: list },
    activeId: { ...cache.activeId, [site]: incoming.id },
  }
}

export function needsRefresh(auth: SiteAuth, now: number): boolean {
  return now >= auth.expiresAt - 5 * 60_000
}

interface RefreshDeps {
  fetchImpl?: typeof fetch
  now?: () => number
}

/** Refresh via the proprietary REST endpoint; token pair rotates. */
export async function refreshSite(
  auth: SiteAuth,
  deps: RefreshDeps = {},
): Promise<SiteAuth> {
  const doFetch = deps.fetchImpl ?? fetch
  const now = deps.now ?? Date.now
  const url = `${auth.endpoint}/v2/plugin/auth/token/refresh`
  const res = await doFetch(url, {
    method: "POST",
    headers: refreshHeaders(auth),
    body: "{}",
  })
  const json = (await res.json()) as {
    code?: number
    msg?: string
    data?: {
      accessToken?: string
      refreshToken?: string
      expiresIn?: number
      refreshExpiresIn?: number
    }
  }
  if (json.code !== 0 || !json.data?.accessToken || !json.data?.refreshToken) {
    throw new Error(`refresh failed: code=${json.code ?? "?"} msg=${json.msg ?? "?"}`)
  }
  const t = now()
  return {
    ...auth,
    accessToken: json.data.accessToken,
    refreshToken: json.data.refreshToken,
    expiresAt: t + (json.data.expiresIn ?? 0) * 1000,
    refreshExpiresAt: t + (json.data.refreshExpiresIn ?? 0) * 1000,
  }
}

export interface TokenStore {
  get(site: Site): SiteAuth | null
  activeAccount(site: Site): SiteAuth | null
  ensureFresh(site: Site): Promise<SiteAuth>
  archive(auth: SiteAuth): void
  select(site: Site): void
  all(): TokenCache
  /** True when the last refresh for this site failed (in-memory only). */
  refreshFailed(site: Site): boolean
}

interface StoreDeps extends RefreshDeps {
  fetchImpl?: typeof fetch
  now?: () => number
  persist?: (cache: TokenCache) => void
  load?: () => TokenCache
}

/** In-memory store backed by the cache file; per-site single-flight refresh. */
export function createTokenStore(deps: StoreDeps = {}): TokenStore {
  let cache = deps.load ? deps.load() : readCache()
  const persist = deps.persist ?? ((c: TokenCache) => writeCache(c))
  const inFlight: Partial<Record<Site, Promise<SiteAuth>>> = {}
  const refreshErrors: Record<Site, boolean> = { cn: false, intl: false }
  const lastRefreshAt: Partial<Record<Site, number>> = {}
  const nowOf = deps.now ?? Date.now

  const save = () => persist(cache)

  return {
    get: (site) => activeAccount(cache, site),
    activeAccount: (site) => activeAccount(cache, site),
    all: () => cache,
    archive: (auth) => {
      cache = archive(cache, auth)
      save()
    },
    select: (site) => {
      if (cache.selected !== site) {
        cache = { ...cache, selected: site }
        save()
      }
    },
    refreshFailed: (site) => refreshErrors[site],
    ensureFresh: (site) => {
      const current = activeAccount(cache, site)
      if (!current) return Promise.reject(new Error(`no account for ${site}`))
      if (!needsRefresh(current, nowOf())) return Promise.resolve(current)
      // Cooldown: a short-TTL token that is already inside the 5-minute window
      // must not be refreshed again on every request right after a refresh —
      // but never hand back a token that has actually expired.
      if (
        lastRefreshAt[site] !== undefined &&
        nowOf() - lastRefreshAt[site]! < 60_000 &&
        nowOf() < current.expiresAt
      ) {
        return Promise.resolve(current)
      }
      const existing = inFlight[site]
      if (existing) return existing
      const task = refreshSite(current, deps)
        .then((next) => {
          cache = archive(cache, next)
          refreshErrors[site] = false
          lastRefreshAt[site] = nowOf()
          save()
          return next
        })
        .catch((error) => {
          refreshErrors[site] = true
          throw error
        })
        .finally(() => {
          delete inFlight[site]
        })
      inFlight[site] = task
      return task
    },
  }
}
