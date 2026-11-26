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

/** The WorkBuddy-flavoured /v3/config shape: modelTiers + modelPromotions. */
const wbBody = () => ({
  code: 0,
  data: {
    agents: [{ name: "cli", models: ["hy4flash", "hy4flash-free", "hy4std", "gpt-6-astra", "auto"] }],
    models: [
      { id: "hy4flash", name: "Hy4 flash", credits: "x0.03", maxInputTokens: 960000, maxOutputTokens: 64000 },
      { id: "hy4flash-free", name: "Hy4 flash", credits: "x0.00", maxInputTokens: 960000, maxOutputTokens: 64000 },
      { id: "hy4std", name: "Hy4", credits: "x0.29", maxInputTokens: 960000, maxOutputTokens: 64000 },
      { id: "gpt-6-astra", name: "GPT-6-Astra", credits: "x6.67", maxInputTokens: 960000, maxOutputTokens: 64000 },
      { id: "auto", name: "Auto", credits: "x0.15", maxInputTokens: 960000, maxOutputTokens: 64000 },
    ],
    modelTiers: [
      { accessMode: "paywall", requiredUserType: "standard", modelIds: ["gpt-6-astra"] },
    ],
    modelPromotions: [
      { id: "hy4-free", kind: "discount", discount: { factor: 0 }, modelIds: ["hy4flash-free"] },
    ],
  },
})

/** The CN /v3/config shape: modelPromotions but no modelTiers. */
const cnBody = () => ({
  code: 0,
  data: {
    agents: [{ name: "cli", models: ["hy4std", "hy4flash", "hy4flash-free", "glm-5.3-flash"] }],
    models: [
      { id: "hy4std", name: "Hy4", credits: "x0.29 credits", maxInputTokens: 960000, maxOutputTokens: 64000 },
      { id: "hy4flash", name: "Hy4 flash", credits: "x0.03 credits", maxInputTokens: 960000, maxOutputTokens: 64000 },
      { id: "hy4flash-free", name: "Hy4 flash", credits: "x0.00 credits", maxInputTokens: 960000, maxOutputTokens: 64000 },
      { id: "glm-5.3-flash", name: "GLM-5.3-Flash", credits: "x0.08 credits", maxInputTokens: 960000, maxOutputTokens: 64000 },
    ],
    modelPromotions: [
      { id: "hy4-free", discount: { factor: 0 }, modelIds: ["hy4flash-free"] },
    ],
  },
})

describe("parseModelConfig — CN shape (no modelTiers)", () => {
  it("appends credit multipliers to every model name", () => {
    const names = parseModelConfig(cnBody()).map((m) => m.name)
    expect(names).toContain("Hy4(x0.29)")
    expect(names).toContain("GLM-5.3-Flash(x0.08)")
  })

  it("keeps only the free twin when models share a name", () => {
    const models = parseModelConfig(cnBody())
    const flashes = models.filter((m) => m.name.startsWith("Hy4 flash"))
    expect(flashes.length).toBe(1)
    expect(flashes[0].id).toBe("hy4flash-free")
  })
})

describe("parseModelConfig — WorkBuddy shape", () => {
  it("drops paywall (Pro-only) models", () => {
    const ids = parseModelConfig(wbBody()).map((m) => m.id)
    expect(ids).not.toContain("gpt-6-astra")
  })

  it("de-duplicates same-name models, keeping the promoted (free) one", () => {
    const models = parseModelConfig(wbBody())
    const flashes = models.filter((m) => m.name.startsWith("Hy4 flash"))
    expect(flashes.length).toBe(1)
    expect(flashes[0].id).toBe("hy4flash-free")
  })

  it("appends the credit factor to the display name", () => {
    const models = parseModelConfig(wbBody())
    const byId = Object.fromEntries(models.map((m) => [m.id, m.name]))
    expect(byId.hy4std).toBe("Hy4(x0.29)")
    expect(byId["hy4flash-free"]).toBe("Hy4 flash(x0.00)")
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

  it("sends the WorkBuddy identity headers for the intl site", async () => {
    let seen: Record<string, string> = {}
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      seen = init.headers as Record<string, string>
      return new Response(JSON.stringify(body()), { status: 200 })
    }) as unknown as typeof fetch
    await fetchCatalog({ site: "intl", auth: { ...auth, endpoint: "https://www.codebuddy.ai" }, fetchImpl })
    expect(seen["x-ide-type"]).toBe("WorkBuddy")
    expect(seen["x-product"]).toBe("WorkBuddy")
    expect(seen["user-agent"]).toContain("WorkBuddy/")
  })

  it("does not send WorkBuddy identity headers for the cn site", async () => {
    let seen: Record<string, string> = {}
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      seen = init.headers as Record<string, string>
      return new Response(JSON.stringify(body()), { status: 200 })
    }) as unknown as typeof fetch
    await fetchCatalog({ site: "cn", auth, fetchImpl })
    expect(seen["x-ide-type"]).toBeUndefined()
    expect(seen["x-product"]).not.toBe("WorkBuddy")
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
