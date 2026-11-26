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

  it("clears the failure cooldown so a post-login read hits upstream immediately", async () => {
    const c = clock()
    let loggedIn = false
    let calls = 0
    const src = createQuotaSource({
      now: c.now,
      readForSite: async () => {
        calls += 1
        if (!loggedIn) throw new Error("no account")
        return reading(6000)
      },
    })
    // A read before login fails and arms the 30s retry cooldown.
    const before = await src.read("cn")
    expect(before.stale).toBe(true)
    expect(calls).toBe(1)
    // Login succeeds; clearing the cooldown lets the very next read retry now.
    loggedIn = true
    src.clearFailure("cn")
    const after = await src.read("cn")
    expect(after.fetchedAt).not.toBeNull()
    expect(after.stale).toBe(false)
    expect(calls).toBe(2)
  })

  it("clearFailure also drops the fresh cache so a post-login read uses the new token", async () => {
    const c = clock()
    let loggedIn = false
    let calls = 0
    const src = createQuotaSource({
      now: c.now,
      readForSite: async () => {
        calls += 1
        // Before login the old token returns a stale account's quota.
        if (!loggedIn) return reading(100)
        return reading(6000)
      },
    })
    // First read caches the old account's numbers.
    const before = await src.read("cn")
    expect(before.remaining).toBe(100)
    expect(calls).toBe(1)
    // Yet another read within 30s is served from the fresh cache without upstream.
    const cached = await src.read("cn")
    expect(cached.cached).toBe(true)
    expect(cached.remaining).toBe(100)
    expect(calls).toBe(1)
    // Login with a new token; clearFailure must invalidate the stale cache too.
    loggedIn = true
    src.clearFailure("cn")
    const after = await src.read("cn")
    expect(after.remaining).toBe(6000)
    expect(after.cached).toBe(false)
    expect(calls).toBe(2)
  })

  it("discards an in-flight read's result when clearFailure happens before it resolves", async () => {
    const c = clock()
    let loggedIn = false
    let calls = 0
    let resolveOld!: (r: ReturnType<typeof reading>) => void
    const src = createQuotaSource({
      now: c.now,
      readForSite: async () => {
        calls += 1
        if (!loggedIn) {
          // The old-token request hangs until the test releases it, simulating
          // a slow upstream response that lands AFTER login.
          return new Promise((resolve) => { resolveOld = resolve })
        }
        return reading(6000)
      },
    })
    // Read starts with the old token but does not resolve yet.
    const pending = src.read("cn")
    expect(calls).toBe(1)
    // Login succeeds while that read is still in flight.
    loggedIn = true
    src.clearFailure("cn")
    // The stale response lands late; it must NOT be cached.
    resolveOld(reading(100))
    await pending
    const after = await src.read("cn")
    expect(after.remaining).toBe(6000)
    expect(after.cached).toBe(false)
    expect(calls).toBe(2)
  })

  it("a late old request does not overwrite the new in-flight single-flight slot", async () => {
    const c = clock()
    let loggedIn = false
    let calls = 0
    let resolveOld!: (r: ReturnType<typeof reading>) => void
    let resolveNew!: (r: ReturnType<typeof reading>) => void
    const src = createQuotaSource({
      now: c.now,
      readForSite: async () => {
        calls += 1
        if (!loggedIn) return new Promise((resolve) => { resolveOld = resolve })
        return new Promise((resolve) => { resolveNew = resolve })
      },
    })
    const p1 = src.read("cn")            // old request, hangs
    loggedIn = true
    src.clearFailure("cn")
    const p2 = src.read("cn")            // new request, takes the slot
    expect(calls).toBe(2)
    // Old one finishes; its .finally must NOT clear p2's slot.
    resolveOld(reading(100))
    await p1
    const p3 = src.read("cn")            // must reuse p2's slot, not start call 3
    expect(calls).toBe(2)
    resolveNew(reading(6000))
    expect((await p2).remaining).toBe(6000)
    expect((await p3).remaining).toBe(6000)
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
