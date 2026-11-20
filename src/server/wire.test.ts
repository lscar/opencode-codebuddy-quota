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

  it("reports a fresh upstream answer as ok and not cached", () => {
    const wire = toWireReading({ ...numbers, stale: false, error: null, cached: false, ageSeconds: 0 })
    expect(wire.ok).toBe(true)
    expect(wire.stale).toBe(false)
    expect(wire.cached).toBe(false)
    expect(wire.ageSeconds).toBe(0)
    expect(wire.remaining).toBe(6000)
  })

  it("says so when the answer came from the cache rather than the upstream", () => {
    const wire = toWireReading({ ...numbers, stale: false, error: null, cached: true, ageSeconds: 12 })
    expect(wire.ok).toBe(true)
    expect(wire.cached).toBe(true)
    expect(wire.ageSeconds).toBe(12)
  })

  it("keeps ok but flips stale when the refresh failed over an old reading", () => {
    const wire = toWireReading({
      ...numbers,
      stale: true,
      error: "upstream HTTP 500",
      cached: false,
      ageSeconds: 40,
    })
    expect(wire.ok).toBe(true)
    expect(wire.stale).toBe(true)
    expect(wire.cached).toBe(false)
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
      cached: false,
      ageSeconds: null,
    })
    expect(wire.ok).toBe(false)
    expect(wire.stale).toBe(true)
    expect(wire.cached).toBe(false)
    expect(wire.remaining).toBeNull()
    expect(wire.fetchedAt).toBeNull()
    expect(wire.error).toBe("OPENCODE_CODEBUDDY_API_KEY is not set")
  })
})
