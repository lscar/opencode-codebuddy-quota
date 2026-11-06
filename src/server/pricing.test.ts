import { describe, expect, it } from "bun:test"
import type { ModelMapping } from "./config"
import { findEntry, resolveCost, vendorEfforts } from "./pricing"

const cat = (models: Record<string, unknown>) => models as any

const entry = (input: number, output: number, cacheRead?: number) => ({
  cost: {
    text: {
      input: { price: input, ...(cacheRead === undefined ? {} : { cache: { read: cacheRead } }) },
      output: { price: output },
    },
  },
})

// 注意：每个 provider 下必须带一层 models，对应真实结构 { [provider]: { models: { [id]: entry } } }
const catalog = cat({
  deepseek: {
    models: {
      "deepseek-v4-flash": entry(0.15, 0.6, 0.003),
      "deepseek-v4-pro": entry(0.66, 1.98, 0.022),
    },
  },
  zhipuai: { models: { "glm-5.3-flash": entry(0.11952, 0.41831, 0.03436) } },
  minimax: { models: { "MiniMax-M3.1-Flash": entry(0.15, 0.6) } },
  "tencent-tokenhub": { models: { hy4: entry(0.834, 2.501, 0.042) } },
  "opencode-go": {
    models: {
      "step-5-preview": entry(1, 2.7),
      "step-5-preview-free": entry(0, 0),
    },
  },
})

const m = (id: string, credits: number | null = 0.5) => ({ id, credits })

const mapping = (provider: string, model: string): ModelMapping => ({ provider, model })

const quiet = () => {}

describe("zero credits", () => {
  it("returns a zero cost and skips the catalog entirely", () => {
    expect(resolveCost(m("hy4free", 0), mapping("tencent-tokenhub", "hy4"), catalog, quiet)).toEqual([
      { input: 0, output: 0, cache: { read: 0, write: 0 } },
    ])
  })

  it("does not treat an unknown (null) credits value as free", () => {
    const [c] = resolveCost(m("glm-5.3-flash", null), mapping("zhipuai", "glm-5.3-flash"), catalog, quiet)
    expect(c.input).toBeCloseTo(0.11952, 5)
  })
})

describe("explicit mappings", () => {
  it("prices from the mapped provider", () => {
    const [c] = resolveCost(m("glm-5.3-flash"), mapping("zhipuai", "glm-5.3-flash"), catalog, quiet)
    expect(c.input).toBeCloseTo(0.11952, 5)
    expect(c.output).toBeCloseTo(0.41831, 5)
  })

  it("follows a renamed model id", () => {
    const [c] = resolveCost(m("deepseek-v4.1-flash"), mapping("deepseek", "deepseek-v4-flash"), catalog, quiet)
    expect(c.input).toBeCloseTo(0.15, 5)
    expect(c.output).toBeCloseTo(0.6, 5)
  })

  it("matches model ids case-insensitively", () => {
    const [c] = resolveCost(
      m("minimax-m3.1-flash"),
      mapping("minimax", "minimax-m3.1-flash"),
      catalog,
      quiet,
    )
    expect(c).toBeDefined()
    expect(c.input).toBeCloseTo(0.15, 5)
  })

  it("defaults missing cache.write to zero", () => {
    const [c] = resolveCost(m("deepseek-v4.1-flash"), mapping("deepseek", "deepseek-v4-flash"), catalog, quiet)
    expect(c.cache.write).toBe(0)
    expect(c.cache.read).toBeCloseTo(0.003, 6)
  })
})

describe("lookup failures", () => {
  it("returns an empty cost array when there is no mapping", () => {
    const logged: string[] = []
    expect(resolveCost(m("unmapped"), undefined, catalog, (s) => logged.push(s))).toEqual([])
    expect(logged.join(" ")).toContain("no models.dev mapping")
  })

  it("returns nothing rather than prefix-matching a -free sibling", () => {
    // 目录里只有零价的 step-5-preview-free，没有 step-5-preview。
    const onlyFree = cat({ "opencode-go": { models: { "step-5-preview-free": entry(0, 0) } } })
    expect(
      resolveCost(m("step-5-preview"), mapping("opencode-go", "step-5-preview"), onlyFree, quiet),
    ).toEqual([])
  })

  it("returns an empty cost array when the mapped provider lacks the model, and logs", () => {
    const logged: string[] = []
    expect(
      resolveCost(m("glm-5.3-flash"), mapping("xiaomi", "glm-5.3-flash"), catalog, (s) => logged.push(s)),
    ).toEqual([])
    expect(logged.join(" ")).toContain("xiaomi")
  })

  it("returns an empty cost array when the catalog is unavailable", () => {
    const logged: string[] = []
    expect(
      resolveCost(m("glm-5.3-flash"), mapping("zhipuai", "glm-5.3-flash"), null, (s) => logged.push(s)),
    ).toEqual([])
    expect(logged.length).toBeGreaterThan(0)
  })
})

describe("vendorEfforts", () => {
  const withReasoning = cat({
    deepseek: {
      models: {
        "deepseek-v4-pro": {
          capabilities: {
            reasoning: { supported: true, toggle: true, effort: ["low", "high", "max"], default: { type: "effort", value: "max" } },
          },
        },
      },
    },
    xiaomi: { models: { "mimo-v2.6-pro": {} } },
  })

  it("returns the vendor's levels and its own default", () => {
    expect(vendorEfforts(mapping("deepseek", "deepseek-v4-pro"), withReasoning)).toEqual({
      efforts: ["low", "high", "max"],
      toggle: true,
      defaultEffort: "max",
    })
  })

  it("returns null when the vendor declares no effort table", () => {
    expect(vendorEfforts(mapping("xiaomi", "mimo-v2.6-pro"), withReasoning)).toBe(null)
  })

  it("returns null for an unmapped model or a missing catalog", () => {
    expect(vendorEfforts(undefined, withReasoning)).toBe(null)
    expect(vendorEfforts(mapping("deepseek", "deepseek-v4-pro"), null)).toBe(null)
  })

  it("ignores a default that is not one of the levels", () => {
    const odd = cat({
      p: {
        models: {
          x: { capabilities: { reasoning: { effort: ["low", "high"], default: { value: "xhigh" } } } },
        },
      },
    })
    expect(vendorEfforts(mapping("p", "x"), odd)?.defaultEffort).toBe(null)
  })
})
