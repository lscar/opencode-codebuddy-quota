import { describe, expect, it } from "bun:test"
import type { SiteAuth } from "./login"
import { apiHeaders, CLI_VERSION, refreshHeaders } from "./headers"

const base: SiteAuth = {
  id: "cn:uid-1",
  accessToken: "jwt-cn",
  refreshToken: "refresh-cn",
  expiresAt: 0,
  refreshExpiresAt: 0,
  uid: "uid-1",
  enterpriseId: "ent-1",
  realmDomain: "www.codebuddy.cn",
  endpoint: "https://copilot.tencent.com",
  usageHost: "https://www.codebuddy.cn",
}

const intl: SiteAuth = {
  ...base,
  id: "intl:uid-2",
  endpoint: "https://www.codebuddy.ai",
  usageHost: "https://www.codebuddy.ai",
  realmDomain: "www.codebuddy.ai",
  enterpriseId: null,
}

describe("apiHeaders", () => {
  it("uses the endpoint host as x-domain, not the realm domain", () => {
    const h = apiHeaders(base)
    expect(h["x-domain"]).toBe("copilot.tencent.com")
    expect(h["x-domain"]).not.toBe("www.codebuddy.cn")
  })

  it("includes enterprise id for a cn enterprise account", () => {
    const h = apiHeaders(base)
    expect(h["x-enterprise-id"]).toBe("ent-1")
    expect(h["authorization"]).toBe("Bearer jwt-cn")
    expect(h["x-user-id"]).toBe("uid-1")
    expect(h["x-product"]).toBe("SaaS")
    expect(h["user-agent"]).toBe(`CLI/${CLI_VERSION} CodeBuddy/${CLI_VERSION}`)
  })

  it("omits enterprise id for an intl personal account", () => {
    const h = apiHeaders(intl)
    expect(h["x-domain"]).toBe("www.codebuddy.ai")
    expect(h["x-enterprise-id"]).toBeUndefined()
  })

  it("uses a provided requestId verbatim and generates a 32-hex default", () => {
    expect(apiHeaders(base, { requestId: "fixed" })["x-request-id"]).toBe("fixed")
    expect(apiHeaders(base)["x-request-id"]).toMatch(/^[0-9a-f]{32}$/)
  })

  it("sets accept when provided", () => {
    expect(apiHeaders(base, { accept: "text/event-stream" })["Accept"]).toBe("text/event-stream")
  })
})

describe("refreshHeaders", () => {
  it("carries the refresh token and plugin source, no bearer", () => {
    const h = refreshHeaders(base)
    expect(h["X-Refresh-Token"]).toBe("refresh-cn")
    expect(h["X-Auth-Refresh-Source"]).toBe("plugin")
    expect(h["x-enterprise-id"]).toBe("ent-1")
    expect(h["Content-Type"]).toBe("application/json")
    expect(h["authorization"]).toBeUndefined()
  })

  it("omits enterprise id for intl", () => {
    expect(refreshHeaders(intl)["x-enterprise-id"]).toBeUndefined()
  })
})
