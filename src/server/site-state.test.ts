import { describe, expect, it } from "bun:test"
import type { SiteAuth } from "./login"
import { archive, type TokenCache } from "./token-store"
import { availableSites, currentSite, siteInfo } from "./site-state"

const auth = (over: Partial<SiteAuth> = {}): SiteAuth => ({
  id: "cn:u1",
  accessToken: "a1",
  refreshToken: "r1",
  expiresAt: Date.now() + 3_600_000,
  refreshExpiresAt: Date.now() + 86_400_000,
  uid: "u1",
  enterpriseId: "ent-1",
  realmDomain: "www.codebuddy.cn",
  endpoint: "https://copilot.tencent.com",
  usageHost: "https://www.codebuddy.cn",
  ...over,
})

const empty = (): TokenCache => ({
  accounts: { cn: [], intl: [] },
  activeId: { cn: null, intl: null },
  selected: "cn",
})

describe("availableSites", () => {
  it("returns both sites when both have accounts", () => {
    let c = archive(empty(), auth())
    c = archive(c, auth({ id: "intl:u2", uid: "u2", endpoint: "https://www.codebuddy.ai", usageHost: "https://www.codebuddy.ai", enterpriseId: null, realmDomain: "www.codebuddy.ai" }))
    expect(availableSites(c)).toEqual(["cn", "intl"])
  })
  it("returns only cn when only cn has an account", () => {
    expect(availableSites(archive(empty(), auth()))).toEqual(["cn"])
  })
  it("returns empty when no site has an account", () => {
    expect(availableSites(empty())).toEqual([])
  })

  it("treats a site with a failed refresh as unavailable", () => {
    const cache = archive(empty(), auth())
    expect(availableSites(cache)).toEqual(["cn"])
    expect(availableSites(cache, (s) => s === "cn")).toEqual([])
  })
})

describe("currentSite", () => {
  it("falls back to the only available site when the selected one is unavailable", () => {
    const c: TokenCache = { ...archive(empty(), auth()), selected: "intl" }
    expect(currentSite(c)).toBe("cn")
  })
  it("keeps selected when nothing is available", () => {
    expect(currentSite({ ...empty(), selected: "intl" })).toBe("intl")
  })
})

describe("siteInfo", () => {
  it("reports availability and account briefs for each site", () => {
    const c = archive(empty(), auth())
    const info = siteInfo(c)
    expect(info.selected).toBe("cn")
    const cn = info.sites.find((s) => s.site === "cn")!
    const intl = info.sites.find((s) => s.site === "intl")!
    expect(cn.available).toBe(true)
    expect(cn.accounts).toEqual([{ id: "cn:u1", label: "u1" }])
    expect(cn.activeId).toBe("cn:u1")
    expect(intl.available).toBe(false)
    expect(intl.accounts).toEqual([])
    expect(intl.activeId).toBe(null)
  })
})
