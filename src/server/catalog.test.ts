import { describe, expect, it } from "bun:test"
import { fetchCatalog, parseModelConfig, shortCredits } from "./catalog"
import type { SiteAuth } from "./login"

const body = (over: Record<string, unknown> = {}) => ({
  code: 0,
  data: {
    agents: [{ name: "cli", models: ["hy4std", "glm-5.3-flash", "unknown-id"] }],
    models: [
      { id: "hy4std", name: "Hy4", credits: "x0.29 credits", maxInputTokens: 960000,
        maxOutputTokens: 64000, supportsImages: true, supportsReasoning: true,
        reasoning: { canDisableThinking: false, defaultEffort: "high", supportedEfforts: ["high"] } },
      { id: "glm-5.3-flash", name: "GLM-5.3-Flash", credits: "x0.08 credits",
        maxInputTokens: 1000000, maxOutputTokens: 131072, supportsImages: true,
        supportsReasoning: true, reasoning: { supportedEfforts: ["low", "high", "max"], defaultEffort: "high" } },
      // A model present in the full table but absent from the cli allowlist.
      { id: "kling-video-v3", name: "Kling", maxInputTokens: 1 },
    ],
  },
  ...over,
})

const auth: SiteAuth = {
  id: "cn:u1", accessToken: "jwt-cn", refreshToken: "r1",
  expiresAt: 0, refreshExpiresAt: 0, uid: "u1", enterpriseId: "ent-1",
  realmDomain: "www.codebuddy.cn", endpoint: "https://copilot.tencent.com",
  usageHost: "https://www.codebuddy.cn",
}

describe("shortCredits", () => {
  it("extracts the numeric factor", () => {
    expect(shortCredits("x0.29 credits")).toBe(0.29)
    expect(shortCredits("x0.00 credits")).toBe(0)
    expect(shortCredits(undefined)).toBe(null)
  })
})

describe("parseModelConfig", () => {
  it("keeps only ids in the cli allowlist", () => {
    const models = parseModelConfig(body())
    expect(models.map((m) => m.id)).toEqual(["hy4std", "glm-5.3-flash"])
  })

  it("drops models absent from the allowlist even when in the full table", () => {
    expect(parseModelConfig(body()).map((m) => m.id)).not.toContain("kling-video-v3")
  })

  it("reads credits, image support and efforts", () => {
    const [hy4] = parseModelConfig(body())
    expect(hy4.credits).toBe(0.29)
    expect(hy4.imageInput).toBe(true)
    expect(hy4.efforts).toEqual(["high"])
  })

  it("returns an empty list when data.models is absent", () => {
    expect(parseModelConfig({ code: 0, data: {} })).toEqual([])
  })
})

describe("fetchCatalog", () => {
  it("GETs the site endpoint with JWT headers and x-domain", async () => {
    let url = ""
    let seen: Record<string, string> = {}
    const fetchImpl = (async (u: string, init: RequestInit) => {
      url = String(u)
      seen = init.headers as Record<string, string>
      return new Response(JSON.stringify(body()), { status: 200 })
    }) as unknown as typeof fetch
    const models = await fetchCatalog({ site: "cn", auth, fetchImpl })
    expect(url).toBe("https://copilot.tencent.com/v3/config")
    expect(seen["x-domain"]).toBe("copilot.tencent.com")
    expect(seen["authorization"]).toBe("Bearer jwt-cn")
    expect(seen["user-agent"]).toContain("CLI/")
    expect(seen["x-api-key"]).toBeUndefined()
    expect(models.map((m) => m.id)).toEqual(["hy4std", "glm-5.3-flash"])
  })

  it("uses the intl endpoint for the intl site", async () => {
    let url = ""
    const fetchImpl = (async (u: string) => {
      url = String(u)
      return new Response(JSON.stringify(body()), { status: 200 })
    }) as unknown as typeof fetch
    await fetchCatalog({ site: "intl", auth: { ...auth, endpoint: "https://www.codebuddy.ai" }, fetchImpl })
    expect(url).toBe("https://www.codebuddy.ai/v3/config")
  })

  it("throws with a diagnosable message when models are silently omitted", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ code: 0, msg: "OK", data: {} }), { status: 200 })) as unknown as typeof fetch
    await expect(fetchCatalog({ site: "cn", auth, fetchImpl })).rejects.toThrow("CLI/")
  })

  it("throws on a non-zero upstream code", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ code: 401, msg: "unauthorized" }), { status: 200 })) as unknown as typeof fetch
    await expect(fetchCatalog({ site: "cn", auth, fetchImpl })).rejects.toThrow("401")
  })

  it("throws on a non-2xx status", async () => {
    const fetchImpl = (async () => new Response("", { status: 500 })) as unknown as typeof fetch
    await expect(fetchCatalog({ site: "cn", auth, fetchImpl })).rejects.toThrow("500")
  })
})
