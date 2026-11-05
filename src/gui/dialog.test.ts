import { describe, expect, it } from "bun:test"
import { normalizeQuota } from "./quota"
import { formatCredits, formatPct, paceColor } from "./pace"

const payload = {
  ok: true,
  remaining: 6245.56,
  used: 754.44,
  total: 7000,
  cycleStart: "2026-10-28 00:00:00",
  cycleEnd: "2026-11-27 23:59:59",
  resetAt: "2026-11-28 00:00:00",
  fetchedAt: "2026-11-04T08:28:41.892Z",
}

const q = (over: Record<string, unknown> = {}) => normalizeQuota({ ...payload, ...over }, { now: 0 })

describe("dialog display values", () => {
  it("shows the remaining share as a percent for the ring", () => {
    const v = q()
    expect(formatPct(v.usedPct === null ? null : 100 - v.usedPct)).toBe("89.22%")
  })

  it("formats the remaining credits to two decimals", () => {
    expect(formatCredits(q().remaining)).toBe("6245.56")
  })

  it("keeps the pace color stable between the capsule and the dialog", () => {
    expect(paceColor(q())).toBe("#4ade80")
  })

  it("reports null progress rather than NaN when the cycle is unknown", () => {
    const v = q({ cycleStart: null, cycleEnd: null })
    expect(v.timePct).toBeNull()
    expect(v.diff).toBeNull()
    expect(paceColor(v)).toBe("#8b90a0")
  })
})

describe("dialog status copy", () => {
  it("marks an upstream failure as stale rather than live", () => {
    const v = q({ stale: true, error: "upstream HTTP 500" })
    expect(v.status).toBe("stale")
    expect(v.error).toBe("upstream HTTP 500")
  })
})
