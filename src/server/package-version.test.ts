import { describe, expect, it } from "bun:test"
import { isVersion, packageSpec } from "./package-spec"
import { DIST_TAG, latestTaggedVersion, REGISTRY_URL, withVersion } from "./package-version"

describe("latestTaggedVersion", () => {
  it("reads the ai-v6 tag", async () => {
    let seenUrl = ""
    const fetchImpl = (async (url: string) => {
      seenUrl = url
      return new Response(JSON.stringify({ "dist-tags": { latest: "3.0.85", [DIST_TAG]: "2.0.90" } }), { status: 200 })
    }) as unknown as typeof fetch

    expect(await latestTaggedVersion({ fetchImpl })).toBe("2.0.90")
    expect(seenUrl).toBe(REGISTRY_URL)
  })

  it("returns null when the tag is absent", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ "dist-tags": { latest: "3.0.85" } }), { status: 200 })) as unknown as typeof fetch
    expect(await latestTaggedVersion({ fetchImpl })).toBe(null)
  })

  it("returns null when the tag is not a version", async () => {
    for (const tag of ["ai-v6", "", 42, { version: "2.0.90" }]) {
      const fetchImpl = (async () =>
        new Response(JSON.stringify({ "dist-tags": { [DIST_TAG]: tag } }), { status: 200 })) as unknown as typeof fetch
      expect(await latestTaggedVersion({ fetchImpl })).toBe(null)
    }
  })

  it("returns null on a non-2xx response", async () => {
    const fetchImpl = (async () => new Response("", { status: 500 })) as unknown as typeof fetch
    expect(await latestTaggedVersion({ fetchImpl })).toBe(null)
  })

  it("returns null instead of throwing when the network fails", async () => {
    const fetchImpl = (async () => {
      throw new Error("offline")
    }) as unknown as typeof fetch
    expect(await latestTaggedVersion({ fetchImpl })).toBe(null)
  })
})

describe("withVersion", () => {
  it("replaces an existing version", () => {
    expect(withVersion("aisdk:@ai-sdk/openai-compatible@2.0.90", "2.0.91")).toBe(
      "aisdk:@ai-sdk/openai-compatible@2.0.91",
    )
  })

  it("adds a version to a bare spec", () => {
    expect(withVersion("aisdk:@ai-sdk/openai-compatible", "2.0.90")).toBe(
      "aisdk:@ai-sdk/openai-compatible@2.0.90",
    )
  })

  it("is idempotent", () => {
    const once = withVersion("aisdk:@ai-sdk/openai-compatible@2.0.90", "2.1.0")!
    expect(withVersion(once, "2.1.0")).toBe(once)
  })

  it("leaves an unrelated package alone", () => {
    expect(withVersion("aisdk:@ai-sdk/anthropic@1.0.0", "2.0.90")).toBe(null)
    expect(withVersion("@ai-sdk/openai-compatible@2.0.90", "2.0.90")).toBe(null)
  })
})

describe("packageSpec", () => {
  it("builds the aisdk spec OpenCode expects", () => {
    expect(packageSpec("2.0.90")).toBe("aisdk:@ai-sdk/openai-compatible@2.0.90")
    // Round trip: the spec it builds is still one `withVersion` recognises.
    expect(withVersion(packageSpec("2.0.90"), "2.0.91")).toBe(packageSpec("2.0.91"))
  })

  it("carries prerelease and build suffixes", () => {
    expect(packageSpec("2.1.0-rc.1")).toBe("aisdk:@ai-sdk/openai-compatible@2.1.0-rc.1")
    expect(packageSpec("2.1.0+local")).toBe("aisdk:@ai-sdk/openai-compatible@2.1.0+local")
  })

  it("refuses anything that is not a version", () => {
    for (const bad of ["", "  ", "2.0", "v2.0.90", "@ai-sdk/openai-compatible", '{\n  "a": 1\n}']) {
      expect(() => packageSpec(bad)).toThrow("not a version")
    }
  })
})

describe("isVersion", () => {
  it("accepts semver, including prerelease and build parts", () => {
    for (const good of ["0.0.0", "2.0.90", "2.1.0-rc.1", "2.1.0+build.7", "1.0.0-alpha.beta+exp.sha.5114f85"]) {
      expect(isVersion(good)).toBe(true)
    }
  })

  it("rejects everything else, including a whole config file", () => {
    const file = '{\n  "$schema": "https://opencode.ai/config.json"\n}'
    for (const bad of [file, "", "  ", "2.0", "v2.0.90", "@ai-sdk/openai-compatible@2.0.90", null, 42, undefined]) {
      expect(isVersion(bad)).toBe(false)
    }
  })
})
