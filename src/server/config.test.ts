import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { DEFAULT_CONFIG, loadConfig } from "./config"

describe("loadConfig", () => {
  it("returns defaults when the file is missing", () => {
    const c = loadConfig({ readFile: () => { throw new Error("ENOENT") } })
    expect(c).toEqual(DEFAULT_CONFIG)
  })

  it("merges user keys over defaults without dropping the rest", () => {
    const c = loadConfig({
      readFile: () => JSON.stringify({ cost_providers: { "glm-5.3-flashx": "zai" } }),
    })
    expect(c.cost_providers["glm-5.3-flashx"]).toBe("zai")
    expect(c.cost_providers["glm-5.3-flash"]).toBe("zhipuai")
    expect(c.default_cost_provider).toBe("opencode")
  })

  it("falls back to defaults on malformed JSON", () => {
    const c = loadConfig({ readFile: () => "{ not json" })
    expect(c).toEqual(DEFAULT_CONFIG)
  })

  it("falls back to defaults when a field has the wrong type", () => {
    const c = loadConfig({ readFile: () => JSON.stringify({ excluded_models: "hy3" }) })
    expect(c.excluded_models).toEqual(DEFAULT_CONFIG.excluded_models)
  })

  it("replaces arrays wholesale rather than concatenating", () => {
    const c = loadConfig({ readFile: () => JSON.stringify({ excluded_models: ["hy3"] }) })
    expect(c.excluded_models).toEqual(["hy3"])
  })

  it("ships the verified default mappings", () => {
    expect(DEFAULT_CONFIG.model_aliases).toEqual({
      hy4std: "hy4",
      hy4free: "hy4",
      "deepseek-v4.1-flash": "deepseek-v4-flash",
    })
    expect(DEFAULT_CONFIG.cost_providers).toEqual({
      "deepseek-v4.1-flash": "deepseek",
      "deepseek-v4-pro": "deepseek",
      "glm-5.3-flash": "zhipuai",
      "glm-5.3-flashx": "zhipuai",
      "minimax-m3.1-flash": "minimax",
      "step-5-preview": "stepfun",
      "mimo-v2.6-pro": "xiaomi",
      hy4std: "tencent-tokenhub",
      hy4free: "tencent-tokenhub",
      hy3: "tencent-tokenhub",
      "hy3-x": "tencent-tokenhub",
    })
    expect(DEFAULT_CONFIG.excluded_models).toEqual(["space-bunny", "hy3", "hy3-x"])
    expect(DEFAULT_CONFIG.auto_prefix).toBe(true)
  })

  it("keeps config.default.json in sync with the runtime constant", () => {
    const raw = readFileSync(join(import.meta.dir, "..", "..", "config.default.json"), "utf8")
    expect(JSON.parse(raw)).toEqual(DEFAULT_CONFIG)
  })
})
