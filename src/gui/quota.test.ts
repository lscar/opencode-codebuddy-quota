import { describe, expect, it } from "bun:test"
import { normalizeQuota, remainingPercent, timeLeftPercent } from "./quota"

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

describe("timeLeftPercent", () => {
  it("measures from the same edge as the remaining fill", () => {
    // About 23% of the cycle has elapsed, so about 77% of it is left.
    const v = q()
    expect(v.timePct).toBeGreaterThan(23)
    expect(v.timePct).toBeLessThan(25)
    expect(timeLeftPercent(v)).toBeGreaterThan(75)
    expect(timeLeftPercent(v)).toBeLessThan(77)
  })

  it("starts the cycle at the right edge and ends it at the left", () => {
    const atStart = q({ fetchedAt: new Date(Date.parse("2026-10-28T00:00:00")).toISOString() })
    const atEnd = q({ fetchedAt: new Date(Date.parse("2026-11-27T23:59:00")).toISOString() })
    expect(timeLeftPercent(atStart)).toBeGreaterThan(99)
    expect(timeLeftPercent(atEnd)).toBeLessThan(1)
  })

  it("sits close to the left when the cycle is nearly spent", () => {
    const near = q({ fetchedAt: new Date(Date.parse("2026-11-27T00:00:00")).toISOString() })
    expect(timeLeftPercent(near)).toBeLessThan(5)
  })

  it("is null when the cycle dates are unusable", () => {
    expect(timeLeftPercent(q({ cycleStart: null, cycleEnd: null }))).toBeNull()
  })
})

describe("capsule and marker share one scale", () => {
  it("shows a slower-than-time reading with its fill past the marker", () => {
    const v = q()
    // 88% of the credits left, ~76% of the cycle left: spending is behind schedule,
    // so the fill reaches further right than the marker. Both start at the left edge.
    expect(remainingPercent(v)).toBe(88)
    expect(timeLeftPercent(v) ?? 100).toBeLessThan(remainingPercent(v) ?? 0)
  })

  it("shows an ahead-of-schedule reading with its fill short of the marker", () => {
    // Same instant, but the credits are nearly gone.
    const v = q({ used: 6300, remaining: 700 })
    expect(remainingPercent(v)).toBe(10)
    expect(timeLeftPercent(v) ?? 0).toBeGreaterThan(remainingPercent(v) ?? 100)
  })
})
