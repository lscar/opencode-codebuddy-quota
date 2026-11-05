import { describe, expect, it } from "bun:test"
import { paceLabel } from "./pace"
import { normalizeQuota, timeLeftPercent } from "./quota"

const base = {
  ok: true,
  remaining: 6245.56,
  used: 754.44,
  total: 7000,
  cycleStart: "2026-10-28 00:00:00",
  cycleEnd: "2026-11-27 23:59:59",
  resetAt: "2026-11-28 00:00:00",
  fetchedAt: "2026-11-04T08:28:41.892Z",
}

const q = (over: Record<string, unknown> = {}) =>
  normalizeQuota({ ...base, ...over }, { now: 0 })

/** Upstream timestamps are local wall-clock, so build the probe the same way. */
const localIso = (y: number, m: number, d: number, h = 0, mi = 0, s = 0) =>
  new Date(y, m - 1, d, h, mi, s).toISOString()

describe("time progress uses the reset instant as its end", () => {
  it("does not report an overrun on the cycle's final second", () => {
    // 11-27 23:59:59 is the last second of the billing period. Rounded progress
    // reads 100%, but the reading must not look like an overrun: the allowance has
    // not been spent just because the clock is nearly up.
    const lastSecond = q({
      fetchedAt: localIso(2026, 11, 27, 23, 59, 59),
      used: 1000,
      remaining: 6000,
    })
    expect(lastSecond.diff).toBeLessThan(0)
    expect(paceLabel(lastSecond)).toBe("normal")
  })

  it("reaches 100% exactly at the reset instant", () => {
    const atReset = q({ fetchedAt: localIso(2026, 11, 28) })
    expect(atReset.timePct).toBe(100)
  })

  it("starts at zero", () => {
    const atStart = q({ fetchedAt: localIso(2026, 10, 28) })
    expect(atStart.timePct).toBe(0)
  })

  it("leaves the marker at the far left once the period is spent", () => {
    const nearEnd = q({ fetchedAt: localIso(2026, 11, 27, 23, 0, 0) })
    expect(timeLeftPercent(nearEnd)).toBeLessThan(0.5)
  })

  it("falls back to cycleEnd when the upstream omits resetAt", () => {
    const v = q({ resetAt: undefined })
    expect(v.timePct).not.toBeNull()
    expect(Number.isFinite(v.timePct)).toBe(true)
  })
})
