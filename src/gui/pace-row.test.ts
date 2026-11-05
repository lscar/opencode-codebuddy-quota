import { describe, expect, it } from "bun:test"
import { PACE_CHIPS, paceChips } from "./pace-row"
import { normalizeQuota } from "./quota"

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

describe("paceChips", () => {
  it("always lists the three chips in the same order", () => {
    expect(paceChips(q()).map((c) => c.label)).toEqual(["使用进度", "时间进度", "偏差"])
  })

  it("formats each value with its own unit", () => {
    const [used, time, gap] = paceChips(q())
    // timePct depends on the wall clock, so assert the shape rather than a value.
    expect(used.value).toMatch(/^\d+\.\d{2}%$/)
    expect(time.value).toMatch(/^\d+\.\d{2}%$/)
    expect(gap.value).toMatch(/^[+-]?\d+\.\d{2} pp$/)
  })

  it("colours the progress values by the fixed bands", () => {
    const [used, time] = paceChips(q())
    // 13.59% and 27.30% are both at or below 50.
    expect(used.color).toBe("#4ade80")
    expect(time.color).toBe("#4ade80")

    const high = paceChips(q({ used: 5000 }))
    expect(high[0].color).toBe("#f5c246") // 71.43%
    expect(high[1].color).toBe("#4ade80") // 27.30%

    const over = paceChips(q({ used: 6300, fetchedAt: "2026-11-27T12:00:00.000Z" }))
    expect(over[0].color).toBe("#f87171") // 90%
  })

  it("colours the gap by its sign", () => {
    expect(paceChips(q())[2].color).toBe("#4ade80")
    expect(paceChips(q({ used: 6000 }))[2].color).toBe("#f87171")
  })

  it("reserves room for the widest value so three digits cannot shift the row", () => {
    // "100.00%" is the widest value any chip can show.
    expect(PACE_CHIPS.valueMinCh).toBeGreaterThanOrEqual(7)
  })
})
