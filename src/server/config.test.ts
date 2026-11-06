import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { DEFAULT_CONFIG, loadConfig } from "./config"

describe("loadConfig", () => {
  it("returns defaults when the file is missing", () => {
    const c = loadConfig({ readFile: () => { throw new Error("ENOENT") } })
    expect(c).toEqual(DEFAULT_CONFIG)
  })

  it("merges user mappings over defaults without dropping the rest", () => {
    const c = loadConfig({
      readFile: () =>
        JSON.stringify({ models: { "glm-9.9": { provider: "zhipuai", model: "glm-9.9" } } }),
    })
    expect(c.models["glm-9.9"]).toEqual({ provider: "zhipuai", model: "glm-9.9" })
    expect(c.models["glm-5.3-flash"]).toEqual({ provider: "zhipuai", model: "glm-5.3-flash" })
  })

  it("lets a user remap a shipped model", () => {
    const c = loadConfig({
      readFile: () =>
        JSON.stringify({ models: { "deepseek-v4-pro": { provider: "opencode", model: "deepseek-v4-pro" } } }),
    })
    expect(c.models["deepseek-v4-pro"]).toEqual({ provider: "opencode", model: "deepseek-v4-pro" })
  })

  it("falls back to defaults on malformed JSON", () => {
    expect(loadConfig({ readFile: () => "{ not json" })).toEqual(DEFAULT_CONFIG)
  })

  it("drops the whole models field when one entry is malformed", () => {
    const c = loadConfig({
      readFile: () => JSON.stringify({ models: { good: { provider: "a", model: "b" }, bad: "just-a-string" } }),
    })
    expect(c.models).toEqual(DEFAULT_CONFIG.models)
  })

  it("rejects an entry missing provider or model", () => {
    const missingModel = loadConfig({
      readFile: () => JSON.stringify({ models: { x: { provider: "a" } } }),
    })
    expect(missingModel.models).toEqual(DEFAULT_CONFIG.models)
    const emptyProvider = loadConfig({
      readFile: () => JSON.stringify({ models: { x: { provider: "", model: "b" } } }),
    })
    expect(emptyProvider.models).toEqual(DEFAULT_CONFIG.models)
  })

  it("falls back to defaults when excluded_models has the wrong type", () => {
    const c = loadConfig({ readFile: () => JSON.stringify({ excluded_models: "hy3" }) })
    expect(c.excluded_models).toEqual(DEFAULT_CONFIG.excluded_models)
  })

  it("replaces excluded_models wholesale rather than concatenating", () => {
    const c = loadConfig({ readFile: () => JSON.stringify({ excluded_models: ["hy3"] }) })
    expect(c.excluded_models).toEqual(["hy3"])
  })

  it("ships a mapping that points every default model at its vendor", () => {
    expect(DEFAULT_CONFIG.models["deepseek-v4-pro"]).toEqual({ provider: "deepseek", model: "deepseek-v4-pro" })
    expect(DEFAULT_CONFIG.models["deepseek-v4.1-flash"]).toEqual({
      provider: "deepseek",
      model: "deepseek-v4-flash",
    })
    expect(DEFAULT_CONFIG.models["minimax-m3.1-flash"]).toEqual({
      provider: "minimax-cn",
      model: "MiniMax-M3.1-Flash",
    })
    expect(DEFAULT_CONFIG.models.hy4std).toEqual({ provider: "tencent-tokenhub", model: "hy4" })
    // Mapped so the mapping stays complete, held back by excluded_models.
    expect(DEFAULT_CONFIG.models.hy3).toBeDefined()
    // Space-Bunny is the same model as minimax-m3.1-flash under another id.
    expect(DEFAULT_CONFIG.models["space-bunny"]).toEqual(DEFAULT_CONFIG.models["minimax-m3.1-flash"])
    expect(DEFAULT_CONFIG.excluded_models).toEqual(["space-bunny", "hy3", "hy3-x"])
  })

  it("keeps config.default.json in sync with the runtime constant", () => {
    const raw = readFileSync(join(import.meta.dir, "..", "..", "config.default.json"), "utf8")
    expect(JSON.parse(raw)).toEqual(DEFAULT_CONFIG)
  })
})
