import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { buildModels } from "./model-info"
import type { ModelsDevCatalog } from "./pricing"
import { configDir, configPath, DEFAULT_CONFIG, loadConfig, opencodeConfigPath } from "./config"
import { DEFAULT_PACKAGE_VERSION } from "./package-spec"

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

  it("reads package_version, falling back to the shipped pin", () => {
    expect(loadConfig({ readFile: () => { throw new Error("ENOENT") } }).package_version).toBe(
      DEFAULT_CONFIG.package_version,
    )
    const c = loadConfig({ readFile: () => JSON.stringify({ package_version: "2.1.7" }) })
    expect(c.package_version).toBe("2.1.7")
  })

  it("ignores anything that is not a plain version", () => {
    const file = '{\n  "providers": {}\n}'
    for (const bad of ["", "   ", 42, null, "2.0", "v2.1.7", "@ai-sdk/openai-compatible", file]) {
      const c = loadConfig({ readFile: () => JSON.stringify({ package_version: bad }) })
      expect(c.package_version).toBe(DEFAULT_CONFIG.package_version)
    }
  })

  it("replaces excluded_models wholesale rather than concatenating", () => {
    const c = loadConfig({ readFile: () => JSON.stringify({ excluded_models: ["hy3"] }) })
    expect(c.excluded_models).toEqual(["hy3"])
  })

  it("maps every resolvable intl cli id (4 routing aliases intentionally absent)", () => {
    // 26 cli ids − 4 virtual aliases = 22 resolvable; hy3 is globally excluded,
    // leaving 21 offered. Assert the exact mapping id set so a future omission
    // (e.g. dropping gpt-5.4) fails here instead of silently shrinking the picker.
    const intlIds = [
      "hy4-preview", "hy3", "deepseek-v4.1-flash", "deepseek-v4.1-flash-sg",
      "gpt-6-astra", "gpt-6.1-sol", "gpt-6-sol", "gpt-6-luna", "gpt-5.6-sol",
      "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-5.4", "grok-4.7",
      "gemini-3.8-flash", "glm-5.3-flash", "glm-5.3", "glm-5.2",
      "minimax-m3.1-flash", "kimi-k3.1-pro", "kimi-k3.1-pro-highspeed", "kimi-k3",
    ]
    for (const id of intlIds) expect(DEFAULT_CONFIG.models[id]).toBeDefined()
    expect(intlIds).toHaveLength(22)
    expect(intlIds.filter((id) => !DEFAULT_CONFIG.excluded_models.includes(id))).toHaveLength(21)
    // Virtual routing aliases must stay unmapped.
    for (const alias of ["default-model", "fast-model", "balanced-model", "primary-model"]) {
      expect(DEFAULT_CONFIG.models[alias]).toBeUndefined()
    }
  })

  it("builds 21 priced models from the 26-id intl cli whitelist (end-to-end)", () => {
    const cliIds = [
      "default-model", "fast-model", "balanced-model", "primary-model", // 4 routing aliases
      "hy4-preview", "hy3", "deepseek-v4.1-flash", "deepseek-v4.1-flash-sg",
      "gpt-6-astra", "gpt-6.1-sol", "gpt-6-sol", "gpt-6-luna", "gpt-5.6-sol",
      "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-5.4", "grok-4.7",
      "gemini-3.8-flash", "glm-5.3-flash", "glm-5.3", "glm-5.2",
      "minimax-m3.1-flash", "kimi-k3.1-pro", "kimi-k3.1-pro-highspeed", "kimi-k3",
    ]
    expect(cliIds).toHaveLength(26)
    const catalog = cliIds
      .map((id) => DEFAULT_CONFIG.models[id])
      .filter((m): m is { provider: string; model: string } => !!m)
      .reduce<ModelsDevCatalog>((acc, m) => {
        acc[m.provider] ??= { models: {} }
        ;(acc[m.provider]!.models ??= {})[m.model] = {
          cost: { text: { input: { price: 1 }, output: { price: 2 } } },
        } as never
        return acc
      }, {} as ModelsDevCatalog)

    const built = buildModels({
      catalog: cliIds.map((id) => ({
        id, name: id, credits: 0.1, imageInput: false,
        efforts: [], defaultEffort: null,
        maxInputTokens: 1000,
      })) as never,
      config: DEFAULT_CONFIG,
      modelsDev: catalog,
      log: () => {},
    })
    expect(built).toHaveLength(21)
    expect(built.every((m) => m.cost.length > 0)).toBe(true)
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
    // Two Hy4 flash ids: a free one the server bills at x0.00 and a paid one.
    expect(DEFAULT_CONFIG.models["hy4flash-free"]).toEqual({ provider: "tencent-tokenhub", model: "hy4" })
    expect(DEFAULT_CONFIG.models.hy4flash).toEqual({ provider: "tencent-tokenhub", model: "hy4" })
    // Mapped so the mapping stays complete, held back by excluded_models.
    expect(DEFAULT_CONFIG.models.hy3).toBeDefined()
    // Space-Bunny is the same model as minimax-m3.1-flash under another id.
    expect(DEFAULT_CONFIG.models["space-bunny"]).toEqual(DEFAULT_CONFIG.models["minimax-m3.1-flash"])
    expect(DEFAULT_CONFIG.excluded_models).toEqual(["space-bunny", "hy3", "hy3-x"])
  })

  it("ships international-site model mappings", () => {
    // Representative intl cli-whitelist models must have a vendor mapping.
    for (const id of ["gpt-6-astra", "gpt-6.1-sol", "grok-4.7", "gemini-3.8-flash"]) {
      expect(DEFAULT_CONFIG.models[id]).toBeDefined()
      expect(DEFAULT_CONFIG.models[id].provider).toBeTruthy()
      expect(DEFAULT_CONFIG.models[id].model).toBeTruthy()
    }
  })

  it("maps GPT ids that zerogpu does not carry to openai with exact ids", () => {
    // zerogpu only has gpt-5.6-luna; these four must use openai or they get no price.
    for (const id of ["gpt-6-sol", "gpt-6-luna", "gpt-5.6-sol", "gpt-5.6-terra"]) {
      expect(DEFAULT_CONFIG.models[id].provider).toBe("openai")
      expect(DEFAULT_CONFIG.models[id].model).toBe(id)
    }
    expect(DEFAULT_CONFIG.models["gpt-5.6-luna"].provider).toBe("zerogpu")
  })

  it("uses exact capitalised wafer.ai ids and moonshotai for kimi highspeed", () => {
    expect(DEFAULT_CONFIG.models["kimi-k3.1-pro"]).toEqual({ provider: "wafer.ai", model: "Kimi-K3.1-Pro" })
    expect(DEFAULT_CONFIG.models["kimi-k3"]).toEqual({ provider: "wafer.ai", model: "Kimi-K3" })
    expect(DEFAULT_CONFIG.models["kimi-k3.1-pro-highspeed"]).toEqual({
      provider: "moonshotai", model: "kimi-k3.1-pro-highspeed",
    })
  })

  it("keeps config.default.json in sync with the runtime constant", () => {
    const raw = readFileSync(join(import.meta.dir, "..", "..", "config.default.json"), "utf8")
    expect(JSON.parse(raw)).toEqual(DEFAULT_CONFIG)
  })

  it("keeps the fallback version equal to the provider's shipped pin", () => {
    expect(DEFAULT_CONFIG.package_version).toBe(DEFAULT_PACKAGE_VERSION)
  })
})

describe("configDir", () => {
  it("defaults to ~/.config/opencode", () => {
    expect(configDir({}, "/home/u")).toBe(join("/home/u", ".config", "opencode"))
  })

  it("honours XDG_CONFIG_HOME", () => {
    expect(configDir({ XDG_CONFIG_HOME: "/xdg" }, "/home/u")).toBe(join("/xdg", "opencode"))
  })

  it("puts the plugin config beside it", () => {
    expect(configPath("/home/u")).toBe(join(configDir(undefined, "/home/u"), "codebuddy-quota-v2.json"))
  })
})

describe("opencodeConfigPath", () => {
  const existsIn = (...present: string[]) => (path: string) =>
    present.some((name) => path.endsWith(name))

  // OpenCode reads opencode.jsonc or opencode.json, whichever exists. Aiming at
  // a fixed .jsonc would leave the .json user with a silently empty import.
  it("finds opencode.json when that is the file the user has", () => {
    expect(opencodeConfigPath("/cfg", existsIn("opencode.json"))).toBe(join("/cfg", "opencode.json"))
  })

  it("prefers opencode.jsonc when both exist", () => {
    const path = opencodeConfigPath("/cfg", existsIn("opencode.jsonc", "opencode.json"))
    expect(path).toBe(join("/cfg", "opencode.jsonc"))
  })

  it("falls back to opencode.jsonc when neither exists", () => {
    expect(opencodeConfigPath("/cfg", () => false)).toBe(join("/cfg", "opencode.jsonc"))
  })
})
