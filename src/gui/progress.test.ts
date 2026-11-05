import { describe, expect, it } from "bun:test"
import { AMBER, GREEN, NEUTRAL, RED, paceLabel, progressColor, signedPp, signedPpColor } from "./pace"
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

describe("progressColor", () => {
  it("is green at 50 and above", () => {
    expect(progressColor(50)).toBe(GREEN)
    expect(progressColor(100)).toBe(GREEN)
  })

  it("is amber from 20 up to but not including 50", () => {
    expect(progressColor(20)).toBe(AMBER)
    expect(progressColor(49.99)).toBe(AMBER)
  })

  it("is red below 20", () => {
    expect(progressColor(19.99)).toBe(RED)
    expect(progressColor(0)).toBe(RED)
  })

  it("is neutral when the value is unknown", () => {
    expect(progressColor(null)).toBe(NEUTRAL)
  })
})

describe("signedPp", () => {
  it("shows a negative diff with a minus sign", () => {
    expect(signedPp(-13.94)).toBe("-13.94 pp")
  })

  it("pads a positive diff with a plus sign", () => {
    expect(signedPp(5)).toBe("+5.00 pp")
  })

  it("shows zero without a sign", () => {
    expect(signedPp(0)).toBe("0.00 pp")
  })

  it("is neutral when the diff is unknown", () => {
    expect(signedPp(null)).toBe("—")
  })
})

describe("signedPpColor", () => {
  it("warns on a positive gap, where spending runs ahead of the clock", () => {
    expect(signedPpColor(13.94)).toBe(RED)
  })

  it("does not warn on a negative gap", () => {
    expect(signedPpColor(-13.94)).toBe(GREEN)
  })

  it("is neutral when the gap is unknown", () => {
    expect(signedPpColor(null)).toBe(NEUTRAL)
  })
})

describe("paceLabel reads the same diff sign as signedPp", () => {
  // Letting spend run faster than the clock is the good direction: the diff is
  // negative, signedPp prints a minus, so the label must not say 慢.
  it("says normal for a negative diff", () => {
    expect(q().diff).toBeLessThan(0)
    expect(paceLabel(q())).toBe("normal")
    expect(signedPp(q().diff).startsWith("-")).toBe(true)
  })
})
