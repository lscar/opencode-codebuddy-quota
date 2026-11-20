import { describe, expect, it } from "bun:test"
import { join } from "node:path"
import type { SiteAuth } from "./login"
import {
  activeAccount,
  archive,
  cachePath,
  createTokenStore,
  needsRefresh,
  readCache,
  refreshSite,
  writeCache,
  type TokenCache,
} from "./token-store"

const auth = (over: Partial<SiteAuth> = {}): SiteAuth => ({
  id: "cn:u1",
  accessToken: "a1",
  refreshToken: "r1",
  expiresAt: 1_000_000,
  refreshExpiresAt: 2_000_000,
  uid: "u1",
  enterpriseId: "ent-1",
  realmDomain: "www.codebuddy.cn",
  endpoint: "https://copilot.tencent.com",
  usageHost: "https://www.codebuddy.cn",
  ...over,
})

const emptyCache = (): TokenCache => ({
  accounts: { cn: [], intl: [] },
  activeId: { cn: null, intl: null },
  selected: "cn",
})

describe("needsRefresh", () => {
  it("refreshes within 5 minutes of expiry", () => {
    expect(needsRefresh(auth({ expiresAt: 1_000_000 }), 1_000_000 - 3 * 60_000)).toBe(true)
  })
  it("does not refresh an hour before expiry", () => {
    expect(needsRefresh(auth({ expiresAt: 1_000_000 }), 1_000_000 - 3600_000)).toBe(false)
  })
})

describe("archive", () => {
  it("adds the other site without touching the first", () => {
    const cn = auth()
    let cache = archive(emptyCache(), cn)
    const intl = auth({ id: "intl:u2", uid: "u2" })
    cache = archive(cache, intl)
    expect(cache.accounts.cn.map((a) => a.id)).toEqual(["cn:u1"])
    expect(cache.accounts.intl.map((a) => a.id)).toEqual(["intl:u2"])
    expect(cache.activeId.intl).toBe("intl:u2")
  })

  it("replaces the same-site account and updates activeId", () => {
    let cache = archive(emptyCache(), auth())
    const rotated = auth({ accessToken: "a2", refreshToken: "r2" })
    cache = archive(cache, rotated)
    expect(cache.accounts.cn.length).toBe(1)
    expect(cache.accounts.cn[0].accessToken).toBe("a2")
    expect(cache.activeId.cn).toBe("cn:u1")
  })
})

describe("activeAccount", () => {
  it("returns the account matching activeId, or null", () => {
    const cache = archive(emptyCache(), auth())
    expect(activeAccount(cache, "cn")?.uid).toBe("u1")
    expect(activeAccount(cache, "intl")).toBe(null)
    expect(activeAccount({ ...cache, activeId: { cn: null, intl: null } }, "cn")).toBe(null)
  })
})

describe("readCache / writeCache / cachePath", () => {
  it("uses the v2 cache filename", () => {
    expect(cachePath("/base")).toBe(join("/base", "codebuddy-quota-v2-auth.json"))
  })

  it("round-trips the new structure", () => {
    const cache = archive(emptyCache(), auth())
    let written = ""
    writeCache(cache, (p, data) => { written = data })
    expect(written).toContain("accounts")
    const read = readCache(() => written)
    expect(activeAccount(read, "cn")?.accessToken).toBe("a1")
  })

  it("migrates the old single-SiteAuth cn/intl format", () => {
    const old = JSON.stringify({
      cn: auth(),
      intl: null,
      selected: "cn",
    })
    const read = readCache(() => old)
    expect(read.accounts.cn.length).toBe(1)
    expect(read.activeId.cn).toBe("cn:u1")
    expect(read.selected).toBe("cn")
  })
})

describe("refreshSite", () => {
  it("posts the refresh endpoint, sends X-Refresh-Token, persists rotated tokens and keeps id", async () => {
    let url = ""
    let headers: Record<string, string> = {}
    const fetchImpl = (async (u: string | URL | Request, init?: RequestInit) => {
      url = String(u)
      headers = (init?.headers ?? {}) as Record<string, string>
      return new Response(
        JSON.stringify({
          code: 0,
          data: {
            accessToken: "a-new",
            refreshToken: "r-new",
            expiresIn: 100,
            refreshExpiresIn: 200,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    }) as unknown as typeof fetch

    const next = await refreshSite(auth(), { fetchImpl, now: () => 5000 })
    expect(url).toContain("/v2/plugin/auth/token/refresh")
    expect(headers["X-Refresh-Token"]).toBe("r1")
    expect(next.accessToken).toBe("a-new")
    expect(next.refreshToken).toBe("r-new")
    expect(next.id).toBe("cn:u1")
    expect(next.expiresAt).toBe(5000 + 100 * 1000)
  })

  it("throws on failure", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ code: 1, msg: "bad" }), {
        status: 200, headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch
    await expect(refreshSite(auth(), { fetchImpl })).rejects.toThrow()
  })
})

describe("createTokenStore.ensureFresh", () => {
  it("single-flights concurrent refreshes", async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      await new Promise((r) => setTimeout(r, 10))
      return new Response(
        JSON.stringify({ code: 0, data: {
          accessToken: "a-new", refreshToken: "r-new", expiresIn: 100, refreshExpiresIn: 200,
        } }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    }) as unknown as typeof fetch

    const store = createTokenStore({ fetchImpl, now: () => 0, persist: () => {}, load: emptyCache })
    store.archive(auth({ expiresAt: -1 }))
    await Promise.all([store.ensureFresh("cn"), store.ensureFresh("cn")])
    expect(calls).toBe(1)
    expect(store.get("cn")?.refreshToken).toBe("r-new")
  })
})
