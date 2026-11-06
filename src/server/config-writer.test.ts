import { describe, expect, it } from "bun:test"
import { stripComments, writeModels } from "./config-writer"

const model = (id: string, over: Record<string, unknown> = {}) =>
  ({
    id,
    name: id,
    cost: [{ input: 0.3, output: 1.2, cache: { read: 0.006, write: 0 } }],
    limit: { context: 1000000, output: 128000 },
    imageInput: true,
    efforts: ["low", "high"],
    defaultEffort: "high",
    ...over,
  }) as any

// Mirrors the real file: a leading comment, trailing commas nowhere, and other
// top-level keys that must survive byte for byte.
const CONFIG = `{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "superpowers@git+https://github.com/obra/superpowers.git#v7.0.2"
  ],
  "providers": {
    "codebuddy": {
      "name": "Codebuddy",
      "package": "aisdk:@ai-sdk/openai-compatible@2.0.90",
      "settings": {
        "baseURL": "https://www.codebuddy.cn/v2",
        "apiKey": "{env:OPENCODE_CODEBUDDY_API_KEY}"
      },
      "models": {
        "deepseek-v4.1-flash": {
          "name": "DeepSeek V4.1 Flash",
          "limit": { "context": 524288, "output": 32768 }
        }
      }
    }
  },
  "mcp": {
    "servers": {}
  }
}
`

const run = (models: any[], config = CONFIG) => {
  let written = ""
  const result = writeModels({
    jsoncPath: "opencode.jsonc",
    models,
    readFile: () => config,
    writeFile: (_p, c) => {
      written = c
    },
  })
  return { result, written }
}

describe("writeModels", () => {
  it("replaces the model block with the imported models", () => {
    const { result, written } = run([model("glm-5.3-flash"), model("hy4std")])
    expect(result.written).toBe(true)
    const parsed = JSON.parse(written)
    expect(Object.keys(parsed.providers.codebuddy.models)).toEqual(["glm-5.3-flash", "hy4std"])
    expect(parsed.providers.codebuddy.models["glm-5.3-flash"].cost).toEqual({
      input: 0.3,
      output: 1.2,
      cache: { read: 0.006, write: 0 },
    })
  })

  it("writes each model on a compact, hand-written-looking block", () => {
    const { written } = run([model("glm-5.3-flash")])
    const line = written.split("\n").find((l) => l.includes('"glm-5.3-flash":'))
    expect(line).toBe(
      '        "glm-5.3-flash": { "name": "glm-5.3-flash", "capabilities": { "tools": true, "input": ["text", "image"], "output": ["text"] }, ' +
        '"limit": { "context": 1000000, "output": 128000 }, ' +
        '"cost": { "input": 0.3, "output": 1.2, "cache": { "read": 0.006, "write": 0 } }, ' +
        '"variants": [{ "id": "low", "settings": { "reasoningEffort": "low" } }, { "id": "high", "settings": { "reasoningEffort": "high" } }], ' +
        '"settings": { "reasoningEffort": "high" } }',
    )
  })

  it("leaves every other part of the file untouched", () => {
    const { written } = run([model("glm-5.3-flash")])
    expect(written.startsWith('{\n  "$schema": "https://opencode.ai/config.json",')).toBe(true)
    expect(written).toContain('"superpowers@git+https://github.com/obra/superpowers.git#v7.0.2"')
    expect(written).toContain('"baseURL": "https://www.codebuddy.cn/v2"')
    expect(written).toContain('"apiKey": "{env:OPENCODE_CODEBUDDY_API_KEY}"')
    expect(written.trimEnd().endsWith('"servers": {}\n  }\n}')).toBe(true)
  })

  it("writes variants and the default reasoning effort", () => {
    const { written } = run([model("g", { efforts: ["low", "high", "max"], defaultEffort: "max" })])
    const m = JSON.parse(written).providers.codebuddy.models.g
    expect(m.variants).toEqual([
      { id: "low", settings: { reasoningEffort: "low" } },
      { id: "high", settings: { reasoningEffort: "high" } },
      { id: "max", settings: { reasoningEffort: "max" } },
    ])
    expect(m.settings).toEqual({ reasoningEffort: "max" })
  })

  it("sends no reasoningEffort for the off level", () => {
    const { written } = run([model("g", { efforts: ["off"], defaultEffort: "off" })])
    expect(JSON.parse(written).providers.codebuddy.models.g.variants[0].settings).toEqual({})
  })

  it("omits cost when none was resolved", () => {
    const { written } = run([model("g", { cost: [] })])
    expect(JSON.parse(written).providers.codebuddy.models.g.cost).toBeUndefined()
  })

  it("omits variants for a model with no reasoning levels", () => {
    const { written } = run([model("g", { efforts: [], defaultEffort: null })])
    const m = JSON.parse(written).providers.codebuddy.models.g
    expect(m.variants).toBeUndefined()
    expect(m.settings).toBeUndefined()
  })

  it("is a no-op when the rendered block already matches", () => {
    const once = run([model("a"), model("b")])
    expect(once.result.changed).toBe(true)
    const twice = run([model("a"), model("b")], once.written)
    expect(twice.result.written).toBe(true)
    expect(twice.result.changed).toBe(false)
    expect(twice.written).toBe("")
  })

  it("rewrites when a price changes but the model ids do not", () => {
    const before = run([model("g")]).written
    const after = run([model("g", { cost: [{ input: 9, output: 9, cache: { read: 9, write: 0 } }] })], before)
    expect(after.result.changed).toBe(true)
    expect(JSON.parse(after.written).providers.codebuddy.models.g.cost.input).toBe(9)
  })

  it("rewrites when the reasoning levels change but the model ids do not", () => {
    const before = run([model("g")]).written
    const after = run([model("g", { efforts: ["low", "high", "max"] })], before)
    expect(after.result.changed).toBe(true)
    expect(JSON.parse(after.written).providers.codebuddy.models.g.variants).toHaveLength(3)
  })

  it("moves the provider package to a newer version", () => {
    let written = ""
    const result = writeModels({
      jsoncPath: "opencode.jsonc",
      models: [model("g")],
      packageVersion: "2.0.91",
      readFile: () => CONFIG,
      writeFile: (_p, c) => {
        written = c
      },
    })
    expect(result.changed).toBe(true)
    expect(written).toContain('"package": "aisdk:@ai-sdk/openai-compatible@2.0.91"')
  })

  it("does not touch the package when the version already matches", () => {
    const same = CONFIG.replace(
      "@ai-sdk/openai-compatible@2.0.90",
      "@ai-sdk/openai-compatible@2.0.91",
    )
    const once = run([model("g")], same)
    expect(once.written).toContain("@2.0.91")
    expect(once.written).not.toContain("@2.0.90")
  })

  it("calls backup with the original text only when the content changes", () => {
    const backups: string[] = []
    const original = run([model("g")]).written
    writeModels({
      jsoncPath: "opencode.jsonc",
      models: [model("g")],
      readFile: () => original,
      writeFile: () => {},
      backup: (_p, content) => backups.push(content),
    })
    expect(backups).toHaveLength(0)

    writeModels({
      jsoncPath: "opencode.jsonc",
      models: [model("g"), model("h")],
      readFile: () => original,
      writeFile: () => {},
      backup: (_p, content) => backups.push(content),
    })
    expect(backups).toEqual([original])
  })

  it("keeps comments that sit outside the model block", () => {
    const withComment = CONFIG.replace(
      '"plugins": [',
      '// 我的心血注释\n  "plugins": [',
    )
    const { written } = run([model("g")], withComment)
    expect(written).toContain("// 我的心血注释")
  })

  it("refuses to touch a file it cannot parse", () => {
    const { result, written } = run([model("g")], "{ not json")
    expect(result.written).toBe(false)
    expect(result.reason).toContain("not valid")
    expect(written).toBe("")
  })

  it("refuses to touch a missing file", () => {
    const result = writeModels({
      jsoncPath: "nope.jsonc",
      models: [model("g")],
      readFile: () => {
        throw new Error("ENOENT")
      },
      writeFile: () => {},
    })
    expect(result.written).toBe(false)
    expect(result.reason).toContain("could not be read")
  })

  it("does not edit a models block that belongs to a different provider", () => {
    const other = CONFIG.replace('"codebuddy": {', '"someoneelse": {')
    const { result, written } = run([model("g")], other)
    expect(result.written).toBe(false)
    expect(written).toBe("")
  })

  it("handles a trailing comma before the closing brace", () => {
    const trailing = CONFIG.replace('"output": 32768 }\n        }\n      }', '"output": 32768 }\n        },\n      }')
    const { result, written } = run([model("g")], trailing)
    expect(result.written).toBe(true)
    expect(Object.keys(JSON.parse(written).providers.codebuddy.models)).toEqual(["g"])
  })
})

describe("stripComments", () => {
  it("keeps a // inside a string", () => {
    const parsed = JSON.parse(stripComments('{ "url": "https://a//b", "x": 1 }'))
    expect(parsed.url).toBe("https://a//b")
  })

  it("drops line and block comments", () => {
    const parsed = JSON.parse(stripComments('{ // hi\n "a": 1 /* there */ }'))
    expect(parsed.a).toBe(1)
  })

  it("drops trailing commas", () => {
    expect(JSON.parse(stripComments('{ "a": [1, 2,], }')).a).toEqual([1, 2])
  })
})
