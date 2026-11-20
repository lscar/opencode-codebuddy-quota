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

const client = (impl: (input?: { site?: "cn" | "intl" }) => Promise<unknown>, loginImpl?: (input: { site: "cn" | "intl" }) => Promise<unknown>) => ({
  read: impl,
  ...(loginImpl ? { login: loginImpl } : {}),
})

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

  it("passes the requested site into the RPC read", async () => {
    let seen: { site?: "cn" | "intl" } | undefined
    const store = createQuotaStore(() =>
      client(async (input) => {
        seen = input
        return { ...okBody, site: "intl" }
      }),
    )
    await store.refresh({ force: true, site: "intl" })
    expect(seen?.site).toBe("intl")
    expect(store.read().site).toBe("intl")
  })

  it("login calls RPC login and refreshes on success", async () => {
    let logged: "cn" | "intl" | null = null as "cn" | "intl" | null
    let reads = 0
    const store = createQuotaStore(() =>
      client(
        async () => { reads += 1; return okBody },
        async ({ site }) => { logged = site; return { ok: true, error: null } },
      ),
    )
    const ok = await store.login("intl")
    expect(ok).toBe(true)
    expect(logged).toBe("intl")
    expect(reads).toBe(1)
  })

  it("keeps the user's last choice when sites are switched rapidly", async () => {
    let release: () => void = () => {}
    const sites: Array<"cn" | "intl"> = []
    const store = createQuotaStore(() =>
      client(async (input) => {
        const s = input?.site ?? "cn"
        sites.push(s)
        if (s === "intl") await new Promise<void>((r) => { release = r })
        return { ...okBody, site: s }
      }),
    )
    // cn completes instantly; intl goes in-flight; user immediately clicks cn again.
    await store.refresh({ force: true, site: "cn" })
    const inFlight = store.refresh({ force: true, site: "intl" })
    const last = store.refresh({ force: true, site: "cn" })
    release()
    await Promise.all([inFlight, last])
    await new Promise((r) => setTimeout(r, 0))
    expect(store.read().site).toBe("cn") // last choice wins, not silently dropped
  })

  it("queues a different site requested during an in-flight refresh", async () => {
    let release: () => void = () => {}
    const sites: Array<"cn" | "intl"> = []
    const store = createQuotaStore(() =>
      client(async (input) => {
        const s = input?.site ?? "cn"
        sites.push(s)
        if (s === "cn") await new Promise<void>((r) => { release = r })
        return { ...okBody, site: s }
      }),
    )
    const first = store.refresh({ force: true, site: "cn" })
    // Second call with a different site lands while cn is still in flight.
    const second = store.refresh({ force: true, site: "intl" })
    release()
    await Promise.all([first, second])
    await new Promise((r) => setTimeout(r, 0))
    expect(sites).toContain("intl")
  })

  it("login returns false and does not refresh when the RPC fails", async () => {
    let reads = 0
    const store = createQuotaStore(() =>
      client(
        async () => { reads += 1; return okBody },
        async () => { throw new Error("browser cancelled") },
      ),
    )
    expect(await store.login("cn")).toBe(false)
    expect(reads).toBe(0)
  })
})
