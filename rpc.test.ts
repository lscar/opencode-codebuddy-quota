import { describe, expect, it } from "bun:test"
import { CodebuddyQuota } from "./rpc"

describe("CodebuddyQuota contract", () => {
  it("registers under the v2 plugin id with read + login methods", () => {
    expect(CodebuddyQuota.id).toBe("codebuddy-quota-v2")
    expect(Object.keys(CodebuddyQuota.methods)).toEqual(["read", "login"])
  })

  it("read input accepts an optional site and rejects other keys", () => {
    const input = CodebuddyQuota.methods.read.input as {
      properties: Record<string, unknown>
      additionalProperties: boolean
    }
    expect(Object.keys(input.properties)).toEqual(["site"])
    expect(input.additionalProperties).toBe(false)
  })

  it("read output declares site + sites (with accounts/activeId) required", () => {
    const out = CodebuddyQuota.methods.read.output as unknown as {
      required: string[]
      additionalProperties: boolean
      properties: Record<string, unknown>
    }
    expect(out.additionalProperties).toBe(false)
    expect(out.required).toContain("site")
    expect(out.required).toContain("sites")
    expect(Object.keys(out.properties).sort()).toEqual([
      "ageSeconds", "cached", "cycleEnd", "cycleStart", "error", "fetchedAt", "ok", "remaining", "resetAt", "site", "sites", "stale", "total", "used",
    ])
    const sites = out.properties.sites as unknown as { items: { required: string[]; properties: Record<string, unknown> } }
    expect(sites.items.required).toEqual(["site", "available", "accounts", "activeId"])
    expect(Object.keys(sites.items.properties).sort()).toEqual(["accounts", "activeId", "available", "site"])
  })

  it("login input requires site, output has ok/error", () => {
    const login = CodebuddyQuota.methods.login as unknown as {
      input: { required: string[] }
      output: { properties: Record<string, unknown>; required: string[] }
    }
    expect(login.input.required).toEqual(["site"])
    expect(Object.keys(login.output.properties).sort()).toEqual(["error", "ok"])
  })
})
