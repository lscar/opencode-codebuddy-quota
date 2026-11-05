import { describe, expect, it } from "bun:test"
import { normalizeQuota, remainingPercent, remainingShare } from "./quota"
import { formatPct } from "./pace"

const base = {
  ok: true,
  remaining: 6179.29,
  used: 820.71,
  total: 7000,
  cycleStart: "2026-10-28 00:00:00",
  cycleEnd: "2026-11-27 23:59:59",
  resetAt: "2026-11-28 00:00:00",
  fetchedAt: "2026-11-04T08:28:41.892Z",
}

const q = (over: Record<string, unknown> = {}) => normalizeQuota({ ...base, ...over }, { now: 0 })

describe("remainingShare", () => {
  it("keeps two decimals, matching the dialog's headline", () => {
    expect(remainingShare(q())).toBe(88.28)
    expect(formatPct(remainingShare(q()))).toBe("88.28%")
  })

  it("rounds the capsule to a whole number from the same value", () => {
    const v = q()
    expect(remainingPercent(v)).toBe(88)
    expect(Math.round(remainingShare(v) ?? 0)).toBe(remainingPercent(v))
  })

  it("does not go negative on an overrun", () => {
    expect(remainingShare(q({ used: 9000 }))).toBe(0)
  })

  it("is null when the payload carries no figures", () => {
    expect(remainingShare(normalizeQuota(null, { now: 0 }))).toBeNull()
  })
})
