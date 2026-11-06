import { describe, expect, it } from "bun:test"
import { CLIENT_NAME, fetchCatalog, parseModelConfig, shortCredits } from "./catalog"

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
    ],
  },
  ...over,
})

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

  it("reads credits, limits and efforts", () => {
    const [hy4] = parseModelConfig(body())
    expect(hy4.credits).toBe(0.29)
    expect(hy4.context).toBe(960000)
    expect(hy4.output).toBe(64000)
    expect(hy4.imageInput).toBe(true)
    expect(hy4.efforts).toEqual(["high"])
    expect(hy4.defaultEffort).toBe("high")
  })

  it("returns an empty list when data.models is absent", () => {
    expect(parseModelConfig({ code: 0, data: {} })).toEqual([])
  })
})

describe("fetchCatalog", () => {
  it("sends the CLI user agent that the endpoint requires", async () => {
    let seen: Record<string, string> = {}
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      seen = init.headers as Record<string, string>
      return new Response(JSON.stringify(body()), { status: 200 })
    }) as unknown as typeof fetch
    await fetchCatalog({ key: "k", fetchImpl })
    expect(seen["user-agent"]).toContain("CLI/")
    expect(seen["x-api-key"]).toBe("k")
    expect(seen["x-product"]).toBe("SaaS")
    expect(seen["x-ide-name"]).toBe(CLIENT_NAME)
  })

  it("throws with a diagnosable message when models are silently omitted", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ code: 0, msg: "OK", data: {} }), { status: 200 })) as unknown as typeof fetch
    await expect(fetchCatalog({ key: "k", fetchImpl })).rejects.toThrow("CLI/")
  })

  it("throws on a non-zero upstream code", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ code: 401, msg: "unauthorized" }), { status: 200 })) as unknown as typeof fetch
    await expect(fetchCatalog({ key: "k", fetchImpl })).rejects.toThrow("401")
  })

  it("throws on a non-2xx status", async () => {
    const fetchImpl = (async () => new Response("", { status: 500 })) as unknown as typeof fetch
    await expect(fetchCatalog({ key: "k", fetchImpl })).rejects.toThrow("500")
  })

  it("throws when the key is empty", async () => {
    await expect(fetchCatalog({ key: "  " })).rejects.toThrow("OPENCODE_CODEBUDDY_API_KEY")
  })
})
