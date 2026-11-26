import { describe, expect, it } from "bun:test"
import { normalizeQuota, remainingPercent } from "./quota"

const base = {
  ok: true,
  stale: false,
  remaining: 6179.29,
  used: 820.71,
  total: 7000,
  cycleStart: "2026-10-28 00:00:00",
  cycleEnd: "2026-11-27 23:59:59",
  resetAt: "2026-11-28 00:00:00",
  fetchedAt: "2026-11-04T08:28:41.892Z",
}

const q = (over: Record<string, unknown> = {}) => normalizeQuota({ ...base, ...over }, { now: 0 })

describe("normalizeQuota", () => {
  it("maps a live payload to ok", () => {
    const v = normalizeQuota({ ...base }, { now: Date.parse("2026-11-04T08:29:00Z") })
    expect(v.status).toBe("ok")
    expect(v.remaining).toBe(6179.29)
    expect(v.usedPct).toBe(11.72)
  })

  it("maps stale fallback to stale", () => {
    const v = q({ stale: true, error: "upstream HTTP 500" })
    expect(v.status).toBe("stale")
    expect(v.error).toBe("upstream HTTP 500")
  })

  it("treats ok:false as an error, not a stale reading", () => {
    const v = normalizeQuota({ ok: false, stale: true, error: "no key" }, { now: 0 })
    expect(v.status).toBe("error")
    expect(v.remaining).toBeNull()
  })

  it("still reports error for ok:false even when a previous reading exists", () => {
    const good = q()
    const v = normalizeQuota({ ok: false, stale: true, error: "no key" }, { now: 0, fallback: good })
    expect(v.status).toBe("error")
  })

  it("treats a total of zero as an error rather than dividing by it", () => {
    const v = q({ total: 0 })
    expect(v.status).toBe("error")
    expect(v.usedPct).toBeNull()
    expect(remainingPercent(v)).toBeNull()
  })

  it("treats a non-object payload as an error", () => {
    expect(normalizeQuota("<html>401</html>", { now: 0 }).status).toBe("error")
  })

  it("keeps the previous reading when the payload is unusable", () => {
    const previous = q()
    const v = normalizeQuota(null, { now: 0, fallback: previous })
    expect(v.status).toBe("stale")
    expect(v.remaining).toBe(6179.29)
  })

  it("reports no time progress when the fetch time is missing, instead of drifting with the clock", () => {
    const v = normalizeQuota({ ...base, fetchedAt: null }, { now: Date.parse("2026-11-20T00:00:00Z") })
    expect(v.status).toBe("ok")
    expect(v.timePct).toBeNull()
    expect(v.diff).toBeNull()
  })
})

describe("remainingPercent", () => {
  it("rounds the remaining share to a whole number", () => {
    expect(remainingPercent(q())).toBe(88)
  })

  it("clamps to 0..100", () => {
    expect(remainingPercent(q({ used: 9000 }))).toBe(0)
    expect(remainingPercent(q({ used: -10 }))).toBe(100)
  })
})

describe("time progress is measured from the cycle start", () => {
  it("measures how much of the cycle has elapsed", () => {
    const v = q()
    expect(v.timePct).toBeGreaterThan(23)
    expect(v.timePct).toBeLessThan(25)
  })

  it("reads 0 at the start and ~100 at the end", () => {
    const atStart = q({ fetchedAt: new Date(Date.parse("2026-10-28T00:00:00")).toISOString() })
    const atEnd = q({ fetchedAt: new Date(Date.parse("2026-11-27T23:59:00")).toISOString() })
    expect(atStart.timePct).toBeLessThan(1)
    expect(atEnd.timePct).toBeGreaterThan(99)
  })

  it("is null when the cycle dates are unusable", () => {
    expect(q({ cycleStart: null, cycleEnd: null }).timePct).toBeNull()
  })

  it("clamps timePct to 0..100 when the clock is outside the cycle", () => {
    const before = q({ fetchedAt: new Date(Date.parse("2026-10-01T00:00:00Z")).toISOString() })
    const after = q({ fetchedAt: new Date(Date.parse("2026-12-01T00:00:00Z")).toISOString() })
    expect(before.timePct).toBe(0)
    expect(after.timePct).toBe(100)
    // diff shares the same scale and must not report a runaway pace.
    expect(before.diff).not.toBeNull()
    expect(before.diff!).toBeLessThanOrEqual(100)
    expect(after.diff!).toBeGreaterThanOrEqual(-100)
  })
})

describe("capsule and marker share one scale", () => {
  // The dialog draws the time marker at (100 - timePct)%, from the same left edge
  // as the remaining fill. These assertions keep the two on one scale.
  it("shows a slower-than-time reading with its fill past the marker", () => {
    const v = q()
    const marker = 100 - (v.timePct ?? 0)
    expect(remainingPercent(v)).toBe(88)
    expect(marker).toBeLessThan(remainingPercent(v) ?? 0)
  })

  it("shows an ahead-of-schedule reading with its fill short of the marker", () => {
    const v = q({ used: 6300, remaining: 700 })
    const marker = 100 - (v.timePct ?? 0)
    expect(remainingPercent(v)).toBe(10)
    expect(marker).toBeGreaterThan(remainingPercent(v) ?? 100)
  })
})
