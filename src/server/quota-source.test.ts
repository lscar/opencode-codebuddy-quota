import { describe, expect, it } from "bun:test"
import { createQuotaSource } from "./quota-source"
import type { Site } from "../shared"

const reading = (n: number) => ({
  remaining: n,
  used: 7000 - n,
  total: 7000,
  cycleStart: "2026-10-28 00:00:00",
  cycleEnd: "2026-11-27 23:59:59",
  resetAt: "2026-11-28 00:00:00",
  fetchedAt: "2026-11-05T00:00:00.000Z",
})

function clock(start = 1_000_000) {
  let t = start
  return {
    now: () => t,
    advance: (ms: number) => { t += ms },
  }
}

describe("createQuotaSource", () => {
  it("hits upstream once per site and caches for 30s", async () => {
    const c = clock()
    let calls: Site[] = []
    const src = createQuotaSource({
      now: c.now,
      readForSite: async (site) => { calls.push(site); return reading(6000) },
    })
    await src.read("cn")
    await src.read("cn")
    await src.read("cn")
    expect(calls).toEqual(["cn"])
    c.advance(30_001)
    await src.read("cn")
    expect(calls).toEqual(["cn", "cn"])
  })

  it("keeps cn and intl caches independent", async () => {
    let calls: Site[] = []
    const src = createQuotaSource({
      readForSite: async (site) => { calls.push(site); return reading(site === "cn" ? 6000 : 1000) },
    })
    const cn = await src.read("cn")
    const intl = await src.read("intl")
    expect(cn.remaining).toBe(6000)
    expect(intl.remaining).toBe(1000)
    expect(calls).toEqual(["cn", "intl"])
    // Second reads are cached for each site separately.
    await src.read("cn")
    await src.read("intl")
    expect(calls).toEqual(["cn", "intl"])
  })

  it("a failing site returns stale without affecting the other site", async () => {
    const c = clock()
    const src = createQuotaSource({
      now: c.now,
      readForSite: async (site) => {
        if (site === "intl") throw new Error("intl down")
        return reading(6000)
      },
    })
    const cn = await src.read("cn")
    const intl = await src.read("intl")
    expect(cn.stale).toBe(false)
    expect(intl.stale).toBe(true)
    expect(intl.error).toContain("intl down")
  })

  it("collapses concurrent reads for the same site into one upstream call", async () => {
    let calls = 0
    const src = createQuotaSource({
      readForSite: async () => { calls += 1; return reading(6000) },
    })
    await Promise.all([src.read("cn"), src.read("cn"), src.read("cn")])
    expect(calls).toBe(1)
  })

  it("returns the last good reading marked stale when upstream fails", async () => {
    const c = clock()
    let fail = false
    const src = createQuotaSource({
      now: c.now,
      readForSite: async () => {
        if (fail) throw new Error("upstream HTTP 500")
        return reading(6000)
      },
    })
    await src.read("cn")
    c.advance(30_001)
    fail = true
    const r = await src.read("cn")
    expect(r.stale).toBe(true)
    expect(r.remaining).toBe(6000)
    expect(r.error).toContain("upstream HTTP 500")
    expect(r.fetchedAt).toBe("2026-11-05T00:00:00.000Z")
  })

  it("reports the error with no numbers when there is no history", async () => {
    const src = createQuotaSource({
      readForSite: async () => { throw new Error("boom") },
    })
    const r = await src.read("cn")
    expect(r.stale).toBe(true)
    expect(r.remaining).toBeNull()
    expect(r.fetchedAt).toBeNull()
    expect(r.error).toBe("boom")
  })

  it("throttles retries after a failure so a broken upstream is not hammered", async () => {
    const c = clock()
    let calls = 0
    const src = createQuotaSource({
      now: c.now,
      readForSite: async () => { calls += 1; throw new Error("upstream HTTP 500") },
    })
    const first = await src.read("cn")
    const second = await src.read("cn")
    expect(calls).toBe(1)
    expect(second.stale).toBe(true)
    expect(second.error).toBe(first.error)
    c.advance(30_001)
    await src.read("cn")
    expect(calls).toBe(2)
  })

  it("marks a cached answer as cached and reports its age", async () => {
    const c = clock()
    let calls = 0
    const src = createQuotaSource({
      now: c.now,
      readForSite: async () => { calls += 1; return reading(6000) },
    })
    const first = await src.read("cn")
    expect(first.cached).toBe(false)
    expect(first.ageSeconds).toBe(0)
    c.advance(12_000)
    const second = await src.read("cn")
    expect(calls).toBe(1)
    expect(second.cached).toBe(true)
    expect(second.ageSeconds).toBe(12)
    expect(second.stale).toBe(false)
  })

  it("passes the caller's signal through to the upstream call", async () => {
    const controller = new AbortController()
    let seen: AbortSignal | undefined
    const src = createQuotaSource({
      readForSite: async (_site, signal) => { seen = signal; return reading(6000) },
    })
    await src.read("cn", controller.signal)
    expect(seen).toBe(controller.signal)
  })
})
