import { describe, expect, it } from "bun:test"
import { makeRpcHandlers } from "./src/server/rpc-handlers"
import type { TokenStore, TokenCache } from "./src/server/token-store"
import type { QuotaSource, Reading } from "./src/server/quota-source"
import type { Site } from "./src/shared"

const reading = (): Reading => ({
  remaining: 100, used: 10, total: 110,
  cycleStart: null, cycleEnd: null, resetAt: null,
  fetchedAt: "2026-11-20T00:00:00.000Z", stale: false, error: null, cached: false, ageSeconds: 0,
})

const emptyCache = (selected: Site = "cn"): TokenCache => ({
  accounts: { cn: [], intl: [] },
  activeId: { cn: null, intl: null },
  selected,
})

import type { SiteAuth } from "./src/server/login"

const validAuth = (site: Site): SiteAuth => ({
  id: `${site}:u1`, accessToken: "a", refreshToken: "r",
  expiresAt: Date.now() + 3_600_000, refreshExpiresAt: Date.now() + 86_400_000,
  uid: "u1", enterpriseId: null, realmDomain: site === "cn" ? "www.codebuddy.cn" : "www.codebuddy.ai",
  endpoint: site === "cn" ? "https://copilot.tencent.com" : "https://www.codebuddy.ai",
  usageHost: site === "cn" ? "https://www.codebuddy.cn" : "https://www.codebuddy.ai",
})

type FakeStore = TokenStore & {
  _selects: Site[]
  _cache: () => TokenCache
  _setFailed: (s: Site, v: boolean) => void
}

function fakeStore(opts: {
  onSelect?: (s: Site) => void
  onArchive?: () => void
  failedBefore?: Partial<Record<Site, boolean>>
  withAccount?: Site
} = {}): FakeStore {
  let cache = emptyCache()
  if (opts.withAccount) {
    const a = validAuth(opts.withAccount)
    cache = {
      ...cache,
      accounts: { ...cache.accounts, [opts.withAccount]: [a] },
      activeId: { ...cache.activeId, [opts.withAccount]: a.id },
    }
  }
  const failed: Record<Site, boolean> = { cn: false, intl: false, ...opts.failedBefore }
  return {
    select: (s) => { opts.onSelect?.(s); if (cache.selected !== s) cache = { ...cache, selected: s } },
    all: () => cache,
    refreshFailed: (s) => failed[s],
    archive: opts.onArchive ?? (() => {}),
    get: () => null,
    activeAccount: () => null,
    ensureFresh: async () => { throw new Error("unused") },
    _selects: [],
    _cache: () => cache,
    _setFailed: (s, v) => { failed[s] = v },
  }
}

function fakeSource(opts: {
  signalSeen?: (s: AbortSignal) => void
  onRead?: () => void
} = {}) {
  return {
    read: async (_site: Site, signal?: AbortSignal) => {
      if (signal) opts.signalSeen?.(signal)
      opts.onRead?.()
      return reading()
    },
  } as unknown as QuotaSource
}

describe("RPC handler assembly", () => {
  it("persists an explicitly requested site (B2 wiring)", async () => {
    let selected: Site | null = null as Site | null
    const store = fakeStore({ onSelect: (s) => { selected = s } })
    const handlers = makeRpcHandlers({ store, source: fakeSource(), log: () => {} })
    await handlers.read({ site: "intl" }, { signal: new AbortController().signal })
    expect(selected).toBe("intl")
    expect(store._cache().selected).toBe("intl")
  })

  it("renders availability from the cache AFTER the read, not a stale verdict (H1)", async () => {
    // Stale session: refresh failed -> site-state marks it unavailable.
    const store = fakeStore({ failedBefore: { cn: true }, withAccount: "cn" })
    const source = fakeSource({ onRead: () => store._setFailed("cn", false) }) // refresh succeeds during read
    const handlers = makeRpcHandlers({ store, source, log: () => {} })
    const out = await handlers.read({ site: "cn" }, { signal: new AbortController().signal })
    expect(out.ok).toBe(true)
    expect(out.sites.find((s) => s.site === "cn")?.available).toBe(true) // H1: not "needs login"
  })

  it("passes the caller's abort signal through to the source", async () => {
    const controller = new AbortController()
    let seen: AbortSignal | undefined
    const handlers = makeRpcHandlers({
      store: fakeStore(), source: fakeSource({ signalSeen: (s) => { seen = s } }), log: () => {},
    })
    await handlers.read({}, { signal: controller.signal })
    expect(seen).toBe(controller.signal)
  })

  it("single-flights concurrent logins for the same site (M3 wiring)", async () => {
    let calls = 0
    let release: () => void = () => {}
    const handlers = makeRpcHandlers({
      store: fakeStore(), source: fakeSource(), log: () => {},
      performLogin: async () => { calls += 1; await new Promise<void>((r) => { release = r }); return validAuth("cn") },
    })
    const a = handlers.login({ site: "cn" })
    const b = handlers.login({ site: "cn" })
    release()
    const [ra, rb] = await Promise.all([a, b])
    expect(calls).toBe(1)
    expect(ra.ok && rb.ok).toBe(true)
  })

  it("archives the account after a successful login", async () => {
    let archived = false
    const handlers = makeRpcHandlers({
      store: fakeStore({ onArchive: () => { archived = true } }),
      source: fakeSource(), log: () => {},
      performLogin: async () => validAuth("intl"),
    })
    const out = await handlers.login({ site: "intl" })
    expect(out.ok).toBe(true)
    expect(archived).toBe(true)
  })

  it("returns an error result (never throws) when login fails", async () => {
    const handlers = makeRpcHandlers({
      store: fakeStore(), source: fakeSource(), log: () => {},
      performLogin: async () => { throw new Error("browser closed") },
    })
    const out = await handlers.login({ site: "intl" })
    expect(out.ok).toBe(false)
    expect(out.error).toContain("browser closed")
  })
})
