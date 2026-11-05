import { describe, expect, it } from "bun:test"
import { normalizeQuota } from "./quota"
import { paceColor, paceLabel } from "./pace"

const base = {
  ok: true,
  stale: false,
  remaining: 6245.56,
  used: 754.44,
  total: 7000,
  cycleStart: "2026-10-28 00:00:00",
  cycleEnd: "2026-11-27 23:59:59",
  resetAt: "2026-11-28 00:00:00",
  fetchedAt: "2026-11-04T08:28:41.892Z",
}

const q = (over: Record<string, unknown> = {}) => normalizeQuota({ ...base, ...over }, { now: 0 })

describe("paceLabel agrees with paceColor", () => {
  it("stays green and says normal during the cycle warm-up", () => {
    const early = new Date(Date.parse("2026-10-28T01:00:00")).toISOString()
    const v = q({ used: 700, fetchedAt: early })
    expect(paceColor(v)).toBe("#4ade80")
    expect(paceLabel(v)).toBe("normal")
  })

  it("treats exactly diff 5 as fast, matching the amber midpoint", () => {
    const start = Date.parse("2026-10-28T00:00:00")
    const end = Date.parse("2026-11-27T23:59:59")
    const mid = new Date(start + (end - start) * 0.5).toISOString()
    const v = q({ used: 3850, fetchedAt: mid })
    expect(v.diff).toBe(5)
    expect(paceLabel(v)).toBe("fast")
  })
})

describe("overrun never produces a negative share", () => {
  it("stays stale when upstream failed but the numbers are present", () => {
    const v = q({ stale: true, error: "upstream HTTP 500" })
    expect(v.status).toBe("stale")
    expect(v.error).toBe("upstream HTTP 500")
  })

  it("reports 0 remaining when used exceeds total", () => {
    const v = q({ used: 9000 })
    expect(v.remaining).toBe(6245.56)
    expect(v.usedPct).toBe(128.57)
  })
})
