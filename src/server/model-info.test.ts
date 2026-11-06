import { describe, expect, it } from "bun:test"
import type { CatalogModel } from "./catalog"
import { DEFAULT_CONFIG } from "./config"
import { buildModels } from "./model-info"

const model = (id: string, name: string, credits: number | null): CatalogModel => ({
  id, name, credits, imageInput: true, efforts: ["high"], defaultEffort: "high",
})

const catalog = [
  model("hy4free", "Hy4", 0),
  model("hy4std", "Hy4", 0.29),
  model("glm-5.3-flash", "GLM-5.3-Flash", 0.08),
  model("space-bunny", "Space-Bunny", 0.08),
  model("hy3", "Hy3", 0),
]

const run = () => buildModels({ catalog, config: DEFAULT_CONFIG, modelsDev: null, log: () => {} })

describe("buildModels", () => {
  it("drops excluded models entirely", () => {
    const ids = run().map((m) => m.id)
    expect(ids).not.toContain("space-bunny")
    expect(ids).not.toContain("hy3")
  })

  it("drops a model that has no mapping, and says why", () => {
    const logged: string[] = []
    const built = buildModels({
      catalog: [model("brand-new-model", "Brand New", 0.5), model("glm-5.3-flash", "GLM-5.3-Flash", 0.08)],
      config: DEFAULT_CONFIG, modelsDev: null, log: (s) => logged.push(s),
    })
    expect(built.map((m) => m.id)).toEqual(["glm-5.3-flash"])
    expect(logged.join(" ")).toContain("brand-new-model")
  })

  it("keeps the credits label even without a models.dev entry", () => {
    const built = buildModels({
      catalog: [model("hy4free", "Hy4", 0), model("hy4std", "Hy4", 0.29)],
      config: DEFAULT_CONFIG,
      modelsDev: null,
      log: () => {},
    })
    const names = Object.fromEntries(built.map((m) => [m.id, m.name]))
    expect(names.hy4free).toBe("Hy4(x0.00)")
    expect(names.hy4std).toBe("Hy4(x0.29)")
  })

  it("appends the credits factor only where names collide", () => {
    const names = Object.fromEntries(run().map((m) => [m.id, m.name]))
    expect(names.hy4free).toBe("Hy4(x0.00)")
    expect(names.hy4std).toBe("Hy4(x0.29)")
    expect(names["glm-5.3-flash"]).toBe("GLM-5.3-Flash")
  })

  it("carries the resolved cost through to the assembled model", () => {
    const dev = {
      deepseek: {
        models: {
          "deepseek-v4-flash": {
            cost: { text: { input: { price: 0.15, cache: { read: 0.003 } }, output: { price: 0.6 } } },
          },
        },
      },
    } as any
    const c = catalog.concat([model("deepseek-v4.1-flash", "DeepSeek-V4.1-Flash", 0.11)])
    const built = buildModels({ catalog: c, config: DEFAULT_CONFIG, modelsDev: dev, log: () => {} })
    const m = built.find((x) => x.id === "deepseek-v4.1-flash")!
    expect(m.cost).toEqual([{ input: 0.15, output: 0.6, cache: { read: 0.003, write: 0 } }])
  })

  it("gives a zero cost to a credits-0 model", () => {
    const built = buildModels({ catalog, config: DEFAULT_CONFIG, modelsDev: null, log: () => {} })
    expect(built.find((x) => x.id === "hy4free")!.cost).toEqual([
      { input: 0, output: 0, cache: { read: 0, write: 0 } },
    ])
  })

  it("does not mutate the input names", () => {
    run()
    expect(catalog.find((m) => m.id === "hy4std")!.name).toBe("Hy4")
  })

  it("gives every model the same fixed limit, whatever the catalog declared", () => {
    const m = run().find((x) => x.id === "glm-5.3-flash")!
    expect(m.limit).toEqual({ context: 500_000, output: 64_000 })
    expect(m.imageInput).toBe(true)
    // modelsDev is null here, so the server's levels stand.
    expect(m.efforts).toEqual(["high"])
    expect(m.defaultEffort).toBe("high")
  })

  it("prefers the vendor's reasoning levels over the gateway's", () => {
    const dev = {
      deepseek: {
        models: {
          "deepseek-v4-pro": { capabilities: { reasoning: { supported: true, toggle: true, effort: ["low", "high", "max"] } } },
        },
      },
    } as any
    const server = { ...model("deepseek-v4-pro", "DeepSeek-V4-Pro", 0.51), efforts: ["high"], defaultEffort: "high" }
    const built = buildModels({
      catalog: [server],
      config: DEFAULT_CONFIG,
      modelsDev: dev,
      log: () => {},
    })
    expect(built[0].efforts).toEqual(["low", "high", "max"])
  })

  it("falls back to the heaviest vendor level when the gateway default is not among them", () => {
    // Deliberately not sorted: `high` is the heaviest level but not the last one,
    // so this distinguishes "heaviest" from "last in the table".
    const dev = {
      stepfun: {
        models: {
          "step-5-preview": { capabilities: { reasoning: { effort: ["high", "low", "medium"] } } },
        },
      },
    } as any
    const server = { ...model("step-5-preview", "Step-5-Preview", 0.33), efforts: ["low", "medium", "high"], defaultEffort: "max" }
    const built = buildModels({ catalog: [server], config: DEFAULT_CONFIG, modelsDev: dev, log: () => {} })
    // Last in the vendor table, but not the heaviest: only a real rank lookup finds it.
    expect(built[0].defaultEffort).toBe("medium")
  })

  it("keeps the server's levels for a model models.dev has no reasoning data for", () => {
    const dev = { xiaomi: { models: { "mimo-v2.6-pro": {} } } } as any
    const server = model("mimo-v2.6-pro", "Xiaomi MiMo", 0.13)
    const built = buildModels({ catalog: [server], config: DEFAULT_CONFIG, modelsDev: dev, log: () => {} })
    expect(built[0].efforts).toEqual(["high"])
  })

  it("sorts the result by model id", () => {
    const ids = run().map((m) => m.id)
    expect(ids).toEqual([...ids].sort())
  })
})
