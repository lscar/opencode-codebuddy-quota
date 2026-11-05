import { describe, expect, it } from "bun:test"
import { normalizeQuota } from "./quota"
import { formatCredits, formatPct, paceColor, paceLabel } from "./pace"

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

const q = (over: Record<string, unknown> = {}) =>
  normalizeQuota({ ...payload, ...over }, { now: 0 })

const GREEN = "#4ade80"
const AMBER = "#f5c246"
const RED = "#f87171"

describe("paceColor", () => {
  it("is pure green when spending slower than the clock", () => {
    // used 10.78%, time 23.33% → diff -12.55
    expect(paceColor(q())).toBe(GREEN)
  })

  it("is pure red at diff >= 10", () => {
    // 2400/7000 = 34.29% used vs 23.33% elapsed → diff ≈ 10.95
    expect(paceColor(q({ used: 2400 }))).toBe(RED)
  })

  it("walks from green through amber to red as the pace worsens", () => {
    const start = Date.parse("2026-10-28T00:00:00")
    const end = Date.parse("2026-11-27T23:59:59")
    const mid = new Date(start + (end - start) * 0.5).toISOString()
    const at = (used: number) => paceColor(q({ used, fetchedAt: mid }))

    // On pace: green. Five points ahead: past half of the green→amber ramp.
    expect(at(3500)).toBe(GREEN)
    expect(at(3900)).toMatch(/^rgb\(/)
    // Ten points ahead: pure red, and it stays red beyond that.
    expect(at(4200)).toBe(RED)
    expect(at(5000)).toBe(RED)
  })

  it("ignores the pace in the first 3% of a cycle", () => {
    const early = new Date(Date.parse("2026-10-28T01:00:00")).toISOString()
    expect(paceColor(q({ used: 700, fetchedAt: early }))).toBe(GREEN)
  })

  it("is neutral gray when the quota is unusable", () => {
    expect(paceColor(normalizeQuota(null, { now: 0 }))).toBe("#8b90a0")
  })
})

describe("paceLabel", () => {
  it("calls a slower pace normal", () => {
    expect(paceLabel(q())).toBe("normal")
  })

  it("calls an unusable quota unknown", () => {
    expect(paceLabel(normalizeQuota(null, { now: 0 }))).toBe("unknown")
  })
})

describe("formatting", () => {
  it("formats credits to two decimals", () => {
    expect(formatCredits(6245.5)).toBe("6245.50")
  })

  it("formats null credits as a dash", () => {
    expect(formatCredits(null)).toBe("—")
  })

  it("keeps the percent sign outside the capsule", () => {
    expect(formatPct(10.78)).toBe("10.78%")
  })

  it("formats null percent as a dash", () => {
    expect(formatPct(null)).toBe("—")
  })
})
