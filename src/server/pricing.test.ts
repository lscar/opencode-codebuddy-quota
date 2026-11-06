import { describe, expect, it } from "bun:test"
import { DEFAULT_CONFIG } from "./config"
import { findEntry, providerFor, resolveCost } from "./pricing"

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
  opencode: { models: { "deepseek-v4.1-flash": entry(0.3, 1.2, 0.006) } },
  zhipuai: { models: { "glm-5.3-flash": entry(0.11952, 0.41831, 0.03436) } },
  "minimax-cn": { models: { "MiniMax-M3.1-Flash": entry(0.1494, 0.5976) } },
  "tencent-tokenhub": { models: { hy4: entry(0.834, 2.501, 0.042) } },
  "opencode-go": {
    models: {
      "step-5-preview": entry(1, 2.7),
      "step-5-preview-free": entry(0, 0),
    },
  },
})

const m = (id: string, credits: number | null = 0.5) => ({
  id, name: id, credits, context: null, output: null, imageInput: false, efforts: [], defaultEffort: null,
})

const quiet = () => {}

describe("zero credits", () => {
  it("returns a zero cost and skips the catalog entirely", () => {
    expect(resolveCost(m("hy4free", 0), DEFAULT_CONFIG, catalog, quiet)).toEqual([
      { input: 0, output: 0, cache: { read: 0, write: 0 } },
    ])
  })

  it("does not treat an unknown (null) credits value as free", () => {
    const [c] = resolveCost(m("glm-5.3-flash", null), DEFAULT_CONFIG, catalog, quiet)
    expect(c.input).toBeCloseTo(0.11952, 5)
  })
})

describe("explicit cost_providers", () => {
  it("uses the configured provider", () => {
    const [c] = resolveCost(m("glm-5.3-flash"), DEFAULT_CONFIG, catalog, quiet)
    expect(c.input).toBeCloseTo(0.11952, 5)
    expect(c.output).toBeCloseTo(0.41831, 5)
  })

  it("matches model ids case-insensitively", () => {
    const [c] = resolveCost(m("minimax-m3.1-flash"), DEFAULT_CONFIG, catalog, quiet)
    expect(c).toBeDefined()
    expect(c.input).toBeCloseTo(0.1494, 5)
  })

  it("applies model_aliases before lookup", () => {
    const [c] = resolveCost(m("hy4std"), DEFAULT_CONFIG, catalog, quiet)
    expect(c.input).toBeCloseTo(0.834, 5)
  })
})

describe("prefix fallback", () => {
  it("derives the provider from the model id when cost_providers has no entry", () => {
    expect(providerFor("glm-9.9-flash", DEFAULT_CONFIG)).toBe("zhipuai")
    expect(providerFor("kimi-k9", DEFAULT_CONFIG)).toBe("moonshotai-cn")
    expect(providerFor("brand-new-model", DEFAULT_CONFIG)).toBe("opencode")
  })

  it("is skipped when auto_prefix is false", () => {
    const off = { ...DEFAULT_CONFIG, auto_prefix: false }
    expect(providerFor("glm-9.9-flash", off)).toBe("opencode")
  })
})

describe("lookup failures", () => {
  it("returns nothing rather than prefix-matching a -free sibling", () => {
    // 目录里只有零价的 step-5-preview-free，没有 step-5-preview。
    // 若实现做了前缀/包含匹配，就会命中 -free 返回 0 价；正确实现必须返回空。
    const onlyFree = cat({
      "opencode-go": { models: { "step-5-preview-free": entry(0, 0) } },
    })
    const cfg = { ...DEFAULT_CONFIG, cost_providers: {}, auto_prefix: false, default_cost_provider: "opencode-go" }
    expect(resolveCost(m("step-5-preview"), cfg, onlyFree, quiet)).toEqual([])
  })

  it("falls back to default_cost_provider and logs when the primary provider lacks the model", () => {
    const logged: string[] = []
    // 首选 provider 指定为 xiaomi（目录里没有 glm-5.3-flash），回退到 default=zhipuai
    const cfg = {
      ...DEFAULT_CONFIG,
      cost_providers: { "glm-5.3-flash": "xiaomi" },
      auto_prefix: false,
      default_cost_provider: "zhipuai",
    }
    const [c] = resolveCost(m("glm-5.3-flash"), cfg, catalog, (s) => logged.push(s))
    expect(c.input).toBeCloseTo(0.11952, 5)
    expect(logged.length).toBeGreaterThan(0)
  })

  it("returns an empty cost array when nothing matches, and logs", () => {
    const logged: string[] = []
    const cfg = { ...DEFAULT_CONFIG, default_cost_provider: "nope" }
    expect(resolveCost(m("totally-unknown"), cfg, catalog, (s) => logged.push(s))).toEqual([])
  })

  it("returns an empty cost array when the catalog is unavailable", () => {
    const logged: string[] = []
    expect(resolveCost(m("glm-5.3-flash"), DEFAULT_CONFIG, null, (s) => logged.push(s))).toEqual([])
    expect(logged.length).toBeGreaterThan(0)
  })

  it("defaults missing cache.write to zero", () => {
    const [c] = resolveCost(m("deepseek-v4.1-flash"), DEFAULT_CONFIG, catalog, quiet)
    expect(c.cache.write).toBe(0)
    expect(c.cache.read).toBeCloseTo(0.006, 6)
  })
})

describe("findEntry", () => {
  it("prefers an exact id and falls back to case-insensitive", () => {
    expect(findEntry(catalog, "minimax-cn", "MiniMax-M3.1-Flash")).toBeDefined()
    expect(findEntry(catalog, "minimax-cn", "minimax-m3.1-flash")).toBeDefined()
    expect(findEntry(catalog, "minimax-cn", "minimax-m3.1-flash-free")).toBeUndefined()
  })
})
