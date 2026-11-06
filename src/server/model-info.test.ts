import { describe, expect, it } from "bun:test"
import { DEFAULT_CONFIG } from "./config"
import { buildModels } from "./model-info"

const model = (id: string, name: string, credits: number | null) => ({
  id, name, credits, context: 1000000, output: 131072, imageInput: true, efforts: ["high"], defaultEffort: "high",
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

  it("appends the credits factor only where names collide", () => {
    const names = Object.fromEntries(run().map((m) => [m.id, m.name]))
    expect(names.hy4free).toBe("Hy4(x0.00)")
    expect(names.hy4std).toBe("Hy4(x0.29)")
    expect(names["glm-5.3-flash"]).toBe("GLM-5.3-Flash")
  })

  it("carries the resolved cost through to the assembled model", () => {
    const dev = {
      opencode: {
        models: {
          "deepseek-v4.1-flash": {
            cost: { text: { input: { price: 0.3, cache: { read: 0.006 } }, output: { price: 1.2 } } },
          },
        },
      },
    } as any
    const c = catalog.concat([model("deepseek-v4.1-flash", "DeepSeek-V4.1-Flash", 0.11)])
    const built = buildModels({ catalog: c, config: DEFAULT_CONFIG, modelsDev: dev, log: () => {} })
    const m = built.find((x) => x.id === "deepseek-v4.1-flash")!
    expect(m.cost).toEqual([{ input: 0.3, output: 1.2, cache: { read: 0.006, write: 0 } }])
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

  it("carries limits, image support and efforts through", () => {
    const m = run().find((x) => x.id === "glm-5.3-flash")!
    expect(m.limit).toEqual({ context: 1000000, output: 131072 })
    expect(m.imageInput).toBe(true)
    expect(m.efforts).toEqual(["high"])
    expect(m.defaultEffort).toBe("high")
  })

  it("leaves a group unsuffixed once it is down to one member", () => {
    const only = buildModels({
      catalog: [model("hy4std", "Hy4", 0.29)],
      config: DEFAULT_CONFIG, modelsDev: null, log: () => {},
    })
    expect(only[0].name).toBe("Hy4")
  })
})
