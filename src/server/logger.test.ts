import { describe, expect, it } from "bun:test"
import { createDedupedLogger } from "./logger"

describe("createDedupedLogger", () => {
  it("writes each distinct message once", () => {
    const out: string[] = []
    const log = createDedupedLogger((l) => out.push(l), "[codebuddy-quota]")
    log("a"); log("a"); log("b")
    expect(out).toEqual(["[codebuddy-quota] a", "[codebuddy-quota] b"])
  })

  it("works without a prefix", () => {
    const out: string[] = []
    const log = createDedupedLogger((l) => out.push(l))
    log("x")
    expect(out).toEqual(["x"])
  })

  it("swallows a throwing writer", () => {
    const log = createDedupedLogger(() => { throw new Error("console exploded") })
    expect(() => log("y")).not.toThrow()
  })
})
