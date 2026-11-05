import { describe, expect, it } from "bun:test"
import { CodebuddyQuota } from "./rpc"

describe("CodebuddyQuota contract", () => {
  it("registers under the plugin id with a single read method", () => {
    expect(CodebuddyQuota.id).toBe("codebuddy-quota")
    expect(Object.keys(CodebuddyQuota.methods)).toEqual(["read"])
  })
  it("declares the exact output shape the server must produce", () => {
    const out = CodebuddyQuota.methods.read.output as {
      required: string[]
      additionalProperties: boolean
      properties: Record<string, unknown>
    }
    expect(out.required).toEqual(["ok", "stale", "cached"])
    expect(out.additionalProperties).toBe(false)
    expect(Object.keys(out.properties).sort()).toEqual([
      "ageSeconds", "cached", "cycleEnd", "cycleStart", "error", "fetchedAt", "ok", "remaining", "resetAt", "stale", "total", "used",
    ])
  })
})
