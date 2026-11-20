import { describe, expect, it } from "bun:test"
import { AMBER, GREEN, NEUTRAL, RED, paceColor, paceLabel, progressColor, signedPp, signedPpColor } from "./pace"
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

describe("diff is time progress minus spend progress", () => {
  it("is positive when spending lags behind the clock", () => {
    // 11% of the credits used, ~24% of the cycle elapsed.
    const v = q()
    expect(v.usedPct).toBeLessThan(v.timePct ?? 0)
    expect(v.diff).toBeGreaterThan(0)
  })

  it("is negative when spending runs ahead of the clock", () => {
    const v = q({ used: 3500 })
    expect(v.diff).toBeLessThan(0)
  })
})

describe("progressColor", () => {
  it("is green at 50 and below", () => {
    expect(progressColor(0)).toBe(GREEN)
    expect(progressColor(50)).toBe(GREEN)
  })

  it("is amber above 50 up to and including 80", () => {
    expect(progressColor(50.01)).toBe(AMBER)
    expect(progressColor(80)).toBe(AMBER)
  })

  it("is red above 80", () => {
    expect(progressColor(80.01)).toBe(RED)
    expect(progressColor(100)).toBe(RED)
  })

  it("is neutral when the value is unknown", () => {
    expect(progressColor(null)).toBe(NEUTRAL)
  })
})

describe("signedPp", () => {
  it("shows a positive gap with a plus sign", () => {
    expect(signedPp(13.84)).toBe("+13.84 pp")
  })

  it("shows a negative gap with a minus sign", () => {
    expect(signedPp(-5)).toBe("-5.00 pp")
  })

  it("shows zero without a sign", () => {
    expect(signedPp(0)).toBe("0.00 pp")
  })

  it("is neutral when the gap is unknown", () => {
    expect(signedPp(null)).toBe("—")
  })
})

describe("signedPpColor", () => {
  it("is green when spending lags behind the clock", () => {
    expect(signedPpColor(13.84)).toBe(GREEN)
  })

  it("is red when spending runs ahead of the clock", () => {
    expect(signedPpColor(-13.84)).toBe(RED)
  })

  it("is neutral when the gap is unknown", () => {
    expect(signedPpColor(null)).toBe(NEUTRAL)
  })
})

describe("paceLabel follows the gap", () => {
  it("says normal when spending lags by 5 points or more", () => {
    const v = q() // diff ≈ +13
    expect(v.diff).toBeGreaterThan(5)
    expect(paceLabel(v)).toBe("normal")
    expect(paceColor(v)).toBe(GREEN)
  })

  it("says slow-to-spend when the gap is between 0 and 5", () => {
    // Pick the instant where roughly `usedPct + 2` of the cycle has elapsed.
    const start = Date.parse("2026-10-28T00:00:00")
    const end = Date.parse("2026-11-27T23:59:59")
    const usedPct = 20
    const at = new Date(start + (end - start) * ((usedPct + 2) / 100)).toISOString()
    const v = q({ used: 1400, fetchedAt: at })
    expect(v.diff).toBeGreaterThan(0)
    expect(v.diff).toBeLessThan(5)
    expect(paceLabel(v)).toBe("ahead")
    // Between green and amber: a ramp, not a band edge.
    expect(paceColor(v)).toMatch(/^rgb\(/)
  })

  it("says fast when spending runs ahead by less than 5", () => {
    const start = Date.parse("2026-10-28T00:00:00")
    const end = Date.parse("2026-11-27T23:59:59")
    const usedPct = 20
    const at = new Date(start + (end - start) * ((usedPct - 2) / 100)).toISOString()
    const v = q({ used: 1400, fetchedAt: at })
    expect(v.diff).toBeLessThan(0)
    expect(v.diff).toBeGreaterThan(-5)
    expect(paceLabel(v)).toBe("fast")
    // Between amber and red: a ramp, not a band edge.
    expect(paceColor(v)).toMatch(/^rgb\(/)
  })

  it("says over when spending runs ahead by 5 points or more", () => {
    const start = Date.parse("2026-10-28T00:00:00")
    const end = Date.parse("2026-11-27T23:59:59")
    const usedPct = 20
    const at = new Date(start + (end - start) * ((usedPct - 10) / 100)).toISOString()
    const v = q({ used: 1400, fetchedAt: at })
    expect(v.diff).toBeLessThan(-5)
    expect(paceLabel(v)).toBe("over")
    expect(paceColor(v)).toBe(RED)
  })

  it("stays normal during the cycle warm-up even if a credit was just spent", () => {
    const early = new Date(Date.parse("2026-10-28T01:00:00")).toISOString()
    const v = q({ used: 700, fetchedAt: early })
    expect(v.timePct).toBeLessThan(3)
    expect(paceLabel(v)).toBe("normal")
    expect(paceColor(v)).toBe(GREEN)
  })
})
