import { describe, expect, it } from "bun:test"
import { createQuotaStore, HOVER_MIN_AGE_MS } from "./store"

const okBody = {
  ok: true,
  stale: false,
  remaining: 6245.56,
  used: 754.44,
  total: 7000,
  cycleStart: "2026-10-28 00:00:00",
  cycleEnd: "2026-11-27 23:59:59",
  resetAt: "2026-11-28 00:00:00",
  fetchedAt: "2026-11-05T00:00:00.000Z",
  error: null,
}

/**
 * These count how often the client is asked, not which `Quota` object comes
 * back: object identity is an implementation detail, and the old suite's
 * `toBe` assertions passed only because every failed fetch happened to build a
 * new object.
 */
function counting(body: unknown = okBody) {
  const state = { calls: 0 }
  const store = createQuotaStore(() => ({
    read: async () => {
      state.calls += 1
      return body
    },
  }))
  return { state, store }
}

describe("refresh gating", () => {
  it("skips a hover refresh inside its age window", async () => {
    const { state, store } = counting()
    await store.refresh({ force: true })
    await store.refresh({ maxAgeMs: HOVER_MIN_AGE_MS })
    expect(state.calls).toBe(1)
  })

  it("runs a hover refresh once the reading is old enough", async () => {
    const { state, store } = counting()
    await store.refresh({ force: true })
    await store.refresh({ maxAgeMs: 0 })
    expect(state.calls).toBe(2)
  })

  it("always runs a forced refresh", async () => {
    const { state, store } = counting()
    await store.refresh({ force: true })
    await store.refresh({ force: true })
    expect(state.calls).toBe(2)
  })

  it("collapses concurrent refreshes into one in-flight request", async () => {
    const { state, store } = counting()
    await Promise.all([store.refresh({ force: true }), store.refresh({ force: true })])
    expect(state.calls).toBe(1)
  })

  it("keeps the hover window at one minute", () => {
    expect(HOVER_MIN_AGE_MS).toBe(60_000)
  })
})
