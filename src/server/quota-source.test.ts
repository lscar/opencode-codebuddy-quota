import { describe, expect, it } from "bun:test"
import { createQuotaSource } from "./quota-source"

const reading = (n: number) => ({
  remaining: n,
  used: 7000 - n,
  total: 7000,
  cycleStart: "2026-10-28 00:00:00",
  cycleEnd: "2026-11-27 23:59:59",
  resetAt: "2026-11-28 00:00:00",
  fetchedAt: "2026-11-05T00:00:00.000Z",
})

/** A clock we can move by hand: cache expiry must be testable without waiting. */
function clock(start = 1_000_000) {
  let t = start
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms
    },
  }
}

describe("createQuotaSource", () => {
  it("hits upstream once and serves the cache for the next 30s", async () => {
    const c = clock()
    let calls = 0
    const src = createQuotaSource({
      now: c.now,
      fetchUpstream: async () => {
        calls += 1
        return reading(6000)
      },
    })
    await src.read()
    await src.read()
    await src.read()
    expect(calls).toBe(1)
    c.advance(30_001)
    await src.read()
    expect(calls).toBe(2)
  })

  it("collapses concurrent reads into one upstream call", async () => {
    let calls = 0
    const src = createQuotaSource({
      fetchUpstream: async () => {
        calls += 1
        return reading(6000)
      },
    })
    await Promise.all([src.read(), src.read(), src.read()])
    expect(calls).toBe(1)
  })

  it("returns the last good reading marked stale when upstream fails", async () => {
    const c = clock()
    let fail = false
    const src = createQuotaSource({
      now: c.now,
      fetchUpstream: async () => {
        if (fail) throw new Error("upstream HTTP 500")
        return reading(6000)
      },
    })
    await src.read()
    c.advance(30_001)
    fail = true
    const r = await src.read()
    expect(r.stale).toBe(true)
    expect(r.remaining).toBe(6000)
    expect(r.error).toContain("upstream HTTP 500")
    expect(r.fetchedAt).toBe("2026-11-05T00:00:00.000Z")
  })

  it("reports the error with no numbers when there is no history", async () => {
    const src = createQuotaSource({
      fetchUpstream: async () => {
        throw new Error("boom")
      },
    })
    const r = await src.read()
    expect(r.stale).toBe(true)
    expect(r.remaining).toBeNull()
    expect(r.fetchedAt).toBeNull()
    expect(r.error).toBe("boom")
  })

  it("serves one upstream call to readers that arrive together after a failure", async () => {
    let calls = 0
    const src = createQuotaSource({
      fetchUpstream: async () => {
        calls += 1
        throw new Error("boom")
      },
    })
    const [a, b] = await Promise.all([src.read(), src.read()])
    expect(calls).toBe(1)
    expect(a.stale).toBe(true)
    expect(b.stale).toBe(true)
  })

  it("does not cache a success forever: a later read retries after the window", async () => {
    const c = clock()
    let calls = 0
    const src = createQuotaSource({
      now: c.now,
      fetchUpstream: async () => {
        calls += 1
        return reading(6000 - calls)
      },
    })
    await src.read()
    c.advance(30_001)
    await src.read()
    expect(calls).toBe(2)
  })

  it("throttles retries after a failure so a broken upstream is not hammered", async () => {
    const c = clock()
    let calls = 0
    const src = createQuotaSource({
      now: c.now,
      fetchUpstream: async () => {
        calls += 1
        throw new Error("upstream HTTP 500")
      },
    })
    const first = await src.read()
    const second = await src.read()
    expect(calls).toBe(1)
    expect(second.stale).toBe(true)
    expect(second.error).toBe(first.error)
    c.advance(30_001)
    await src.read()
    expect(calls).toBe(2)
  })

  it("hands a slow refresh's cache to a reader that arrives mid-flight", async () => {
    const c = clock()
    let release: () => void = () => {}
    let calls = 0
    const src = createQuotaSource({
      now: c.now,
      fetchUpstream: async () => {
        calls += 1
        if (calls === 2) await new Promise<void>((resolve) => (release = resolve))
        if (calls === 2) throw new Error("slow failure")
        return reading(6000)
      },
    })
    await src.read()
    c.advance(10_000) // still inside the 30s window
    const slow = src.read() // cache is fresh, so this does not call upstream
    expect(calls).toBe(1)
    const r = await slow
    expect(r.stale).toBe(false)
    release()
  })

  it("marks a cached answer as cached and reports its age", async () => {
    const c = clock()
    let calls = 0
    const src = createQuotaSource({
      now: c.now,
      fetchUpstream: async () => {
        calls += 1
        return reading(6000)
      },
    })
    const first = await src.read()
    expect(first.cached).toBe(false)
    expect(first.ageSeconds).toBe(0)

    c.advance(12_000)
    const second = await src.read()
    expect(calls).toBe(1)
    expect(second.cached).toBe(true)
    expect(second.ageSeconds).toBe(12)
    // A cache hit is still live data, not a failure.
    expect(second.stale).toBe(false)
  })

  it("does not call a failed refresh cached, even though it serves old numbers", async () => {
    const c = clock()
    let fail = false
    const src = createQuotaSource({
      now: c.now,
      fetchUpstream: async () => {
        if (fail) throw new Error("upstream HTTP 500")
        return reading(6000)
      },
    })
    await src.read()
    c.advance(40_000)
    fail = true
    const r = await src.read()
    expect(r.stale).toBe(true)
    expect(r.cached).toBe(false)
    expect(r.ageSeconds).toBe(40)
  })

  it("passes the caller's signal through to the upstream call", async () => {
    const controller = new AbortController()
    let seen: AbortSignal | undefined
    const src = createQuotaSource({
      fetchUpstream: async (signal) => {
        seen = signal
        return reading(6000)
      },
    })
    await src.read(controller.signal)
    expect(seen).toBe(controller.signal)
  })
})
