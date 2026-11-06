import { describe, expect, it } from "bun:test"
import { PROVIDER_DEFAULT, PROVIDER_ID } from "./provider-default"
import type { ImportedModel } from "./model-info"
import { createModelTransform, toModelInfo } from "./transform"

const editor = (present: boolean) => {
  const calls = { set: [] as [string, any[]][], add: [] as any[] }
  return {
    calls,
    get: (id: string) =>
      present && id === PROVIDER_ID ? ({ provider: { id }, models: new Map() } as any) : undefined,
    add: (input: any) => calls.add.push(input),
    models: { set: (id: string, models: any[]) => calls.set.push([id, models]) },
  }
}

/** The editor surface is structurally typed by OpenCode; the mock stands in for it. */
const asEditor = (e: ReturnType<typeof editor>) => e as unknown as Parameters<ReturnType<typeof createModelTransform>>[0]

const models = [
  {
    id: "glm-5.3-flash",
    name: "GLM-5.3-Flash",
    cost: [{ input: 0.11952, output: 0.41831, cache: { read: 0.03436, write: 0 } }],
    limit: { context: 1000000, output: 131072 },
    imageInput: true,
    efforts: ["low", "high", "max"],
    defaultEffort: "high",
  },
] as any

describe("provider-default", () => {
  it("pins the agreed endpoint, package and env-based key", () => {
    expect(PROVIDER_DEFAULT.package).toBe("aisdk:@ai-sdk/openai-compatible@2.0.90")
    expect(PROVIDER_DEFAULT.settings.baseURL).toBe("https://copilot.tencent.com/v2")
    expect(PROVIDER_DEFAULT.settings.apiKey).toBe("{env:OPENCODE_CODEBUDDY_API_KEY}")
    expect(PROVIDER_DEFAULT.compatibility.reasoningField).toBe("reasoning_content")
  })
})

describe("existing provider (B)", () => {
  it("only replaces the model list and never touches provider fields", async () => {
    const e = editor(true)
    const t = createModelTransform({ loadModels: async () => models, env: {}, log: () => {} })
    await t(asEditor(e))
    expect(e.calls.set).toHaveLength(1)
    expect(e.calls.set[0][0]).toBe(PROVIDER_ID)
    // The list is converted to Model.Info, so it is equal-shaped but not the same object.
    expect(e.calls.set[0][1]).toHaveLength(1)
    expect(e.calls.set[0][1][0].id).toBe("glm-5.3-flash")
    expect(e.calls.add).toHaveLength(0)
  })
})

describe("missing provider (A)", () => {
  it("creates the provider when the api key is present", async () => {
    const e = editor(false)
    const t = createModelTransform({
      loadModels: async () => models,
      env: { OPENCODE_CODEBUDDY_API_KEY: "k" },
      log: () => {},
    })
    await t(asEditor(e))
    expect(e.calls.add).toHaveLength(1)
    expect(e.calls.add[0].info).toMatchObject({ name: PROVIDER_DEFAULT.name, package: PROVIDER_DEFAULT.package })
    expect(e.calls.add[0].models).toHaveLength(1)
    expect(e.calls.add[0].models[0].providerID).toBe(PROVIDER_ID)
    expect(e.calls.set).toHaveLength(0)
  })

  it("stays out of the way and warns when the api key is missing", async () => {
    const e = editor(false)
    const logged: string[] = []
    const t = createModelTransform({ loadModels: async () => models, env: {}, log: (m) => logged.push(m) })
    await t(asEditor(e))
    expect(e.calls.add).toHaveLength(0)
    expect(e.calls.set).toHaveLength(0)
    expect(logged.join(" ")).toContain("OPENCODE_CODEBUDDY_API_KEY")
  })
})

describe("resilience", () => {
  it("swallows load failures instead of throwing", async () => {
    const e = editor(true)
    const t = createModelTransform({
      loadModels: async () => { throw new Error("boom") },
      env: {}, log: () => {},
    })
    await expect(t(asEditor(e))).resolves.toBeUndefined()
    expect(e.calls.set).toHaveLength(0)
  })

  it("does not clear existing models when the load returns nothing", async () => {
    const e = editor(true)
    const t = createModelTransform({ loadModels: async () => [], env: {}, log: () => {} })
    await t(asEditor(e))
    expect(e.calls.set).toHaveLength(0)
  })

  it("survives a throwing editor.add()", async () => {
    const e = editor(false)
    e.add = () => { throw new Error("editor exploded") }
    const t = createModelTransform({
      loadModels: async () => models,
      env: { OPENCODE_CODEBUDDY_API_KEY: "k" },
      log: () => {},
    })
    await expect(t(asEditor(e))).resolves.toBeUndefined()
  })

  it("survives a throwing editor.models.set()", async () => {
    const e = editor(true)
    e.models.set = () => { throw new Error("set exploded") }
    const t = createModelTransform({ loadModels: async () => models, env: {}, log: () => {} })
    await expect(t(asEditor(e))).resolves.toBeUndefined()
  })
})

describe("toModelInfo", () => {
  const [source] = models as any[]
  const info = toModelInfo(source as ImportedModel)

  it("fills every field OpenCode requires, not just the ones the catalog has", () => {
    // Branded ids are plain strings at runtime; `String()` keeps the assertion
    // about the value rather than about the brand.
    expect(String(info.modelID)).toBe("glm-5.3-flash")
    expect(String(info.providerID)).toBe(PROVIDER_ID)
    expect(info.status).toBe("active")
    expect(info.enabled).toBe(true)
    expect(info.time.released).toBe(0)
  })

  it("maps image support onto the input capabilities", () => {
    expect(info.capabilities.input).toEqual(["text", "image"])
    expect(info.capabilities.tools).toBe(true)
    const textOnly = toModelInfo({ ...source, imageInput: false })
    expect(textOnly.capabilities.input).toEqual(["text"])
  })

  it("turns each reasoning level into a variant carrying reasoningEffort", () => {
    expect(info.variants.map((v) => String(v.id))).toEqual(["low", "high", "max"])
    expect(info.variants[1].settings).toEqual({ reasoningEffort: "high" })
  })

  it("sends no reasoningEffort for the off level", () => {
    const withOff = toModelInfo({ ...source, efforts: ["off", "high"] })
    expect(withOff.variants[0].settings).toEqual({})
  })

  it("carries cost and limits through unchanged", () => {
    expect(info.cost.map((c) => [Number(c.input), Number(c.output), Number(c.cache.read), Number(c.cache.write)])).toEqual([
      [0.11952, 0.41831, 0.03436, 0],
    ])
    expect(info.limit).toEqual({ context: 1000000, output: 131072 })
  })
})
