import { describe, expect, it } from "bun:test"
import type { ImportedModel } from "./model-info"
import { stripComments, writeModels } from "./config-writer"

const model = (id: string, over: Partial<ImportedModel> = {}): ImportedModel => ({
  id,
  name: id,
  cost: [{ input: 0.3, output: 1.2, cache: { read: 0.006, write: 0 } }],
  limit: { context: 1_000_000, output: 128_000 },
  imageInput: true,
  efforts: ["low", "high"],
  defaultEffort: "high",
  ...over,
})

// Mirrors the real file's layout: the models block opens on its own line and the
// rewritten members keep the file's own line endings.
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

// Mirrors the real file's layout: the models block opens on its own line and the
// rewritten members keep the file's CRLF endings.
const run = (models: ImportedModel[], config = CONFIG) => {
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

/** The written text keeps its comments, so it is read back the same way it was written. */
const parse = (text: string) => JSON.parse(stripComments(text))

describe("writeModels", () => {
  it("reuses the file's own line ending", () => {
    const crlf = CONFIG.replace(/\n/g, "\r\n")
    const { written } = run([model("g"), model("h")], crlf)
    // Every LF must belong to a CRLF pair: no mixed endings were introduced.
    expect(written.replace(/\r\n/g, "")).not.toContain("\n")
  })

  it("replaces the model block with the imported models", () => {
    const { result, written } = run([model("glm-5.3-flash"), model("hy4std")])
    expect(result.status).toBe("written")
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
    expect(once.result.status).toBe("written")
    const twice = run([model("a"), model("b")], once.written)
    expect(twice.result.status).toBe("unchanged")
    expect(twice.written).toBe("")
  })

  it("rewrites when a price changes but the model ids do not", () => {
    const before = run([model("g")]).written
    const after = run([model("g", { cost: [{ input: 9, output: 9, cache: { read: 9, write: 0 } }] })], before)
    expect(after.result.status).toBe("written")
    expect(JSON.parse(after.written).providers.codebuddy.models.g.cost.input).toBe(9)
  })

  it("rewrites when the reasoning levels change but the model ids do not", () => {
    const before = run([model("g")]).written
    const after = run([model("g", { efforts: ["low", "high", "max"] })], before)
    expect(after.result.status).toBe("written")
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
    expect(result.status).toBe("written")
    expect(result.status === "written" ? result.packageUpdated : false).toBe(true)
    expect(written).toContain('"package": "aisdk:@ai-sdk/openai-compatible@2.0.91"')
  })

  it("reports packageUpdated false when the version already matches or is absent", () => {
    const same = CONFIG.replace("@2.0.90", "@2.0.91")
    let written = ""
    const matching = writeModels({
      jsoncPath: "opencode.jsonc",
      models: [model("g")],
      packageVersion: "2.0.91",
      readFile: () => same,
      writeFile: (_p, c) => {
        written = c
      },
    })
    // The models block changed, so the file is written, but the spec was already right.
    expect(matching).toEqual({ status: "written", packageUpdated: false })

    expect(run([model("g")]).result).toEqual({ status: "written", packageUpdated: false })
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

  // The failure that destroyed a real config: a comment shifted every offset,
  // so the splice landed inside the package string and wrote the whole file
  // into it. Comments must not move anything.
  it("keeps the file valid when a comment sits before the package key", () => {
    const commented = CONFIG.replace('      "package":', '      // 我的心血注释\n      "package":')
    const { result, written } = run([model("g")], commented)
    expect(result.status).toBe("written")
    const parsed = parse(written)
    expect(parsed.providers.codebuddy.package).toBe("aisdk:@ai-sdk/openai-compatible@2.0.90")
    expect(written).toContain("// 我的心血注释")
  })

  it("keeps the file valid when a comment sits between settings and models", () => {
    const commented = CONFIG.replace('      "models":', '      // 注释\n      "models":')
    const { written } = run([model("g")], commented)
    expect(Object.keys(parse(written).providers.codebuddy.models)).toEqual(["g"])
    expect(written).toContain("// 注释")
  })

  it("keeps a comment's commas and braces out of the trailing-comma sweep", () => {
    const tricky = CONFIG.replace(
      '"name": "Codebuddy",',
      '"name": "Codebuddy", /* 注释里的 , } 与 ] */',
    )
    const { written } = run([model("g")], tricky)
    expect(parse(written).providers.codebuddy.name).toBe("Codebuddy")
  })

  it("never writes a non-version into the package spec", () => {
    for (const bad of ["", "  ", "@ai-sdk/openai-compatible", "{ \"a\": 1 }", "2.0"]) {
      let written = ""
      const result = writeModels({
        jsoncPath: "opencode.jsonc",
        models: [model("g"), model("h")],
        packageVersion: bad,
        readFile: () => CONFIG,
        writeFile: (_p, c) => {
          written = c
        },
      })
      // The models still land, but the package is left exactly as it was.
      expect(result).toEqual({ status: "written", packageUpdated: false })
      expect(/"package":\s*"([^"]*)"/.exec(written)?.[1]).toBe("aisdk:@ai-sdk/openai-compatible@2.0.90")
    }
  })

  it("says why a package rewrite it wanted did not happen", () => {
    const wrongPackage = CONFIG.replace(
      "aisdk:@ai-sdk/openai-compatible@2.0.90",
      "aisdk:@ai-sdk/anthropic@1.0.0",
    )
    let written = ""
    const result = writeModels({
      jsoncPath: "opencode.jsonc",
      models: [model("g"), model("h")],
      packageVersion: "2.0.91",
      readFile: () => wrongPackage,
      writeFile: (_p, c) => {
        written = c
      },
    })
    expect(result.status).toBe("written")
    expect(result.status === "written" ? result.packageWarning : "").toContain("not a known @ai-sdk spec")
    expect(written).toContain("aisdk:@ai-sdk/anthropic@1.0.0")
  })

  it("leaves a package key nested under settings alone", () => {
    const nested = CONFIG.replace('"baseURL":', '"package": "not-the-provider-package", "baseURL":')
    let written = ""
    const result = writeModels({
      jsoncPath: "opencode.jsonc",
      models: [model("g"), model("h")],
      packageVersion: "2.0.91",
      readFile: () => nested,
      writeFile: (_p, c) => {
        written = c
      },
    })
    expect(result).toEqual({ status: "written", packageUpdated: true })
    const parsed = parse(written)
    expect(parsed.providers.codebuddy.package).toBe("aisdk:@ai-sdk/openai-compatible@2.0.91")
    expect(parsed.providers.codebuddy.settings.package).toBe("not-the-provider-package")
  })

  // The literal "codebuddy" inside someone else's value used to be found first,
  // and the models were spliced into that provider instead.
  it("does not mistake another provider's value for the provider key", () => {
    const decoy = `{
  "providers": {
    "someoneelse": {
      "settings": { "nickname": "codebuddy" },
      "models": { "theirs": { "name": "theirs" } }
    },
    "codebuddy": {
      "package": "aisdk:@ai-sdk/openai-compatible@2.0.90",
      "models": { "old": { "name": "old" } }
    }
  }
}
`
    let written = ""
    const result = writeModels({
      jsoncPath: "opencode.jsonc",
      models: [model("g"), model("h")],
      packageVersion: "2.0.91",
      readFile: () => decoy,
      writeFile: (_p, c) => {
        written = c
      },
    })
    expect(result).toEqual({ status: "written", packageUpdated: true })
    const parsed = parse(written)
    expect(Object.keys(parsed.providers.codebuddy.models)).toEqual(["g", "h"])
    expect(Object.keys(parsed.providers.someoneelse.models)).toEqual(["theirs"])
    expect(parsed.providers.codebuddy.package).toBe("aisdk:@ai-sdk/openai-compatible@2.0.91")
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
    for (const bad of ["{ not json", "null", "[]"]) {
      const { result, written } = run([model("g")], bad)
      expect(result.status).toBe("skipped")
      expect(written).toBe("")
    }
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
    expect(result.status).toBe("skipped")
    expect(result.status === "skipped" ? result.reason : "").toContain("could not be read")
  })

  it("refuses a duplicate provider key instead of guessing which one wins", () => {
    const duplicate = `{
  "providers": {
    "codebuddy": { "package": "aisdk:@ai-sdk/openai-compatible@1.0.0", "models": { "dead": {} } },
    "codebuddy": { "package": "aisdk:@ai-sdk/openai-compatible@2.0.90", "models": { "live": {} } }
  }
}
`
    const { result, written } = run([model("g")], duplicate)
    expect(result.status).toBe("skipped")
    expect(written).toBe("")
  })

  it("handles a trailing comma before the closing brace", () => {
    const trailing = CONFIG.replace('"output": 32768 }\n        }\n      }', '"output": 32768 }\n        },\n      }')
    const { result, written } = run([model("g")], trailing)
    expect(result.status).toBe("written")
    expect(Object.keys(JSON.parse(written).providers.codebuddy.models)).toEqual(["g"])
  })
})

describe("stripComments", () => {
  // Every splice in writeModels is applied to the original text using offsets
  // taken from this result, so a changed length would cut the wrong span.
  it("never changes the length of the text", () => {
    const samples = [
      '{ "a": 1 }',
      '{\n  // 注释\n  "package": "x",\n}',
      '{\r\n  /* a\r\n  b */\r\n  "a": [1, 2,],\r\n}',
      '{"url": "https://a//b", "c": "/* not a comment */"}',
      CONFIG,
      CONFIG.replace('      "package":', '      // 我的心血注释\n      "package":'),
    ]
    for (const sample of samples) expect(stripComments(sample)).toHaveLength(sample.length)
  })

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
