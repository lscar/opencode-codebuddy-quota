import { describe, expect, it } from "bun:test"
import { createQuotaStore, readQuota } from "./store"

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

const client = (impl: () => Promise<unknown>) => ({ read: impl })

describe("readQuota", () => {
  it("maps a healthy answer to ok", async () => {
    const q = await readQuota({ client: client(async () => okBody) })
    expect(q.status).toBe("ok")
    expect(q.remaining).toBe(6245.56)
  })

  it("maps stale:true to stale and keeps the numbers", async () => {
    const q = await readQuota({ client: client(async () => ({ ...okBody, stale: true, error: "upstream HTTP 500" })) })
    expect(q.status).toBe("stale")
    expect(q.error).toBe("upstream HTTP 500")
  })

  it("maps ok:false to error", async () => {
    const q = await readQuota({ client: client(async () => ({ ok: false, stale: true, error: "no key" })) })
    expect(q.status).toBe("error")
    expect(q.error).toBe("no key")
    expect(q.remaining).toBeNull()
  })

  it("maps a rejected RPC call to error instead of throwing", async () => {
    const q = await readQuota({
      client: client(async () => {
        throw new Error("RPC is unavailable: codebuddy-quota")
      }),
    })
    expect(q.status).toBe("error")
    expect(q.error).toContain("RPC is unavailable")
  })

  it("keeps the previous numbers when the RPC rejects and a fallback exists", async () => {
    const good = await readQuota({ client: client(async () => okBody) })
    const q = await readQuota({
      client: client(async () => {
        throw new Error("boom")
      }),
      fallback: good,
    })
    expect(q.status).toBe("stale")
    expect(q.remaining).toBe(6245.56)
  })
})

describe("createQuotaStore", () => {
  it("does not start twice", () => {
    const store = createQuotaStore(() => client(async () => okBody))
    const a = store.start()
    const b = store.start()
    b()
    expect(typeof a).toBe("function")
    a()
  })

  it("emits the reading to a subscriber", async () => {
    const store = createQuotaStore(() => client(async () => okBody))
    const seen: number[] = []
    const stop = store.subscribe((q) => {
      if (q.remaining !== null) seen.push(q.remaining)
    })
    await store.refresh({ force: true })
    stop()
    expect(seen).toEqual([6245.56])
  })

  it("resolves the client on every request, not once at construction", async () => {
    let generation = 0
    const store = createQuotaStore(() => {
      generation += 1
      const g = generation
      return client(async () => ({ ...okBody, remaining: g, used: 7000 - g }))
    })
    await store.refresh({ force: true })
    await store.refresh({ force: true })
    expect(generation).toBe(2)
  })

  it("passes the previous reading as a fallback, so a rejection keeps the numbers", async () => {
    let fail = false
    const store = createQuotaStore(() =>
      client(async () => {
        if (fail) throw new Error("boom")
        return okBody
      }),
    )
    await store.refresh({ force: true })
    fail = true
    await store.refresh({ force: true })
    expect(store.read().status).toBe("stale")
    expect(store.read().remaining).toBe(6245.56)
  })

  it("survives a client that cannot even be obtained", async () => {
    const store = createQuotaStore(() => {
      throw new Error("no server client")
    })
    await store.refresh({ force: true })
    expect(store.read().status).toBe("error")
    expect(store.read().error).toContain("no server client")
    expect(store.read().remaining).toBeNull()
  })
})
