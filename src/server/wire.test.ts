import { describe, expect, it } from "bun:test"
import { toWireReading } from "./wire"

describe("toWireReading", () => {
  const numbers = {
    remaining: 6000,
    used: 1000,
    total: 7000,
    cycleStart: "2026-10-28 00:00:00",
    cycleEnd: "2026-11-27 23:59:59",
    resetAt: "2026-11-28 00:00:00",
    fetchedAt: "2026-11-05T00:00:00.000Z",
  }

  it("reports ok when a reading was ever obtained", () => {
    const wire = toWireReading({ ...numbers, stale: false, error: null })
    expect(wire.ok).toBe(true)
    expect(wire.stale).toBe(false)
    expect(wire.remaining).toBe(6000)
  })

  it("keeps ok but flips stale when the refresh failed over an old reading", () => {
    const wire = toWireReading({ ...numbers, stale: true, error: "upstream HTTP 500" })
    expect(wire.ok).toBe(true)
    expect(wire.stale).toBe(true)
    expect(wire.remaining).toBe(6000)
    expect(wire.error).toBe("upstream HTTP 500")
  })

  it("reports ok:false with all numbers null when nothing was ever read", () => {
    const wire = toWireReading({
      remaining: null,
      used: null,
      total: null,
      cycleStart: null,
      cycleEnd: null,
      resetAt: null,
      fetchedAt: null,
      stale: true,
      error: "OPENCODE_CODEBUDDY_API_KEY is not set",
    })
    expect(wire.ok).toBe(false)
    expect(wire.stale).toBe(true)
    expect(wire.remaining).toBeNull()
    expect(wire.fetchedAt).toBeNull()
    expect(wire.error).toBe("OPENCODE_CODEBUDDY_API_KEY is not set")
  })
})
