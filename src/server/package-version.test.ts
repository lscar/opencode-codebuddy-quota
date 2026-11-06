import { describe, expect, it } from "bun:test"
import { packageSpec } from "./provider-default"
import { DIST_TAG, latestTaggedVersion, REGISTRY_URL, versionInSpec, withVersion } from "./package-version"

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

describe("versionInSpec", () => {
  it("reads a trailing version", () => {
    expect(versionInSpec("aisdk:@ai-sdk/openai-compatible@2.0.90")).toBe("2.0.90")
  })

  it("returns null for a bare package name", () => {
    expect(versionInSpec("aisdk:@ai-sdk/openai-compatible")).toBe(null)
    expect(versionInSpec("@ai-sdk/openai-compatible")).toBe(null)
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
    expect(versionInSpec(packageSpec("2.0.90"))).toBe("2.0.90")
  })
})
