import { describe, expect, it } from "bun:test"
import { daysLeftInCycle, parseCycleDay } from "./days"

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h, 0, 0)

describe("parseCycleDay", () => {
  it("reads the date part of an upstream timestamp as local midnight", () => {
    const t = parseCycleDay("2026-11-27 23:59:59")
    expect(t).not.toBeNull()
    const d = new Date(t as number)
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(10)
    expect(d.getDate()).toBe(27)
    expect(d.getHours()).toBe(0)
  })

  it("rejects junk", () => {
    expect(parseCycleDay(null)).toBeNull()
    expect(parseCycleDay("not a date")).toBeNull()
  })
})

describe("daysLeftInCycle", () => {
  const cycleEnd = "2026-11-27 23:59:59"

  it("counts whole calendar days from today through the cycle end, inclusive", () => {
    // 11-04 through 11-27 inclusive is 24 days.
    expect(daysLeftInCycle(cycleEnd, at(2026, 11, 4))).toBe(24)
  })

  it("still says one day on the final day of the cycle", () => {
    expect(daysLeftInCycle(cycleEnd, at(2026, 11, 27, 0))).toBe(1)
    expect(daysLeftInCycle(cycleEnd, at(2026, 11, 27, 23))).toBe(1)
  })

  it("does not drop to zero at midnight before the reset", () => {
    // The regression: an hour-based count read 0 on reset day.
    expect(daysLeftInCycle("2026-11-28 00:00:00", at(2026, 11, 27, 23))).toBe(2)
  })

  it("is null once the cycle has ended", () => {
    expect(daysLeftInCycle(cycleEnd, at(2026, 11, 28))).toBeNull()
  })

  it("is null when the cycle end is unusable", () => {
    expect(daysLeftInCycle(null, at(2026, 11, 4))).toBeNull()
  })

  it("survives a month boundary", () => {
    // 10-28 through 10-31 inclusive is 4 days.
    expect(daysLeftInCycle("2026-10-31 23:59:59", at(2026, 10, 28))).toBe(4)
  })
})
