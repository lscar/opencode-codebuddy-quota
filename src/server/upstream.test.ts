import { describe, expect, it } from "bun:test"
import type { SiteAuth } from "./login"
import { fetchUpstream } from "./upstream"

const auth: SiteAuth = {
  id: "cn:u1", accessToken: "jwt-cn", refreshToken: "r1",
  expiresAt: 0, refreshExpiresAt: 0, uid: "u1", enterpriseId: "ent-1",
  realmDomain: "www.codebuddy.cn", endpoint: "https://copilot.tencent.com",
  usageHost: "https://www.codebuddy.cn",
}

const ok = (data: Record<string, unknown>) => (async () =>
  new Response(JSON.stringify({ code: 0, data }), { status: 200 })) as unknown as typeof fetch

const usage = (over: Record<string, unknown> = {}) => ({
  credit: 754.44,
  limitNum: 7000,
  cycleStartTime: "2026-10-28 00:00:00",
  cycleEndTime: "2026-11-27 23:59:59",
  cycleResetTime: "2026-11-28 00:00:00",
  ...over,
})

describe("fetchUpstream", () => {
  it("POSTs to the site's usage host with JWT headers and endpoint-host x-domain", async () => {
    let url = ""
    let headers: Record<string, string> = {}
    const fetchImpl = (async (u: string | URL | Request, init?: RequestInit) => {
      url = String(u)
      headers = (init?.headers ?? {}) as Record<string, string>
      return new Response(JSON.stringify({ code: 0, data: usage() }), { status: 200 })
    }) as unknown as typeof fetch
    const r = await fetchUpstream({ auth, fetchImpl })
    expect(url).toBe("https://www.codebuddy.cn/v2/billing/meter/get-enterprise-user-usage")
    expect(headers["x-domain"]).toBe("copilot.tencent.com")
    expect(headers["authorization"]).toBe("Bearer jwt-cn")
    expect(r.resetAt).toBe("2026-11-28 00:00:00")
  })

  it("computes remaining from used and total", async () => {
    const r = await fetchUpstream({ auth, fetchImpl: ok(usage()) })
    expect(r.used).toBe(754.44)
    expect(r.total).toBe(7000)
    expect(r.remaining).toBeCloseTo(6245.56, 2)
  })

  it("never returns a negative remaining when used exceeds total", async () => {
    const r = await fetchUpstream({ auth, fetchImpl: ok(usage({ credit: 9000 })) })
    expect(r.remaining).toBe(0)
  })

  it("uses the intl usage host for an intl account", async () => {
    let url = ""
    const fetchImpl = (async (u: string | URL | Request) => {
      url = String(u)
      return new Response(JSON.stringify({ code: 0, data: usage() }), { status: 200 })
    }) as unknown as typeof fetch
    await fetchUpstream({ auth: { ...auth, endpoint: "https://www.codebuddy.ai", usageHost: "https://www.codebuddy.ai" }, fetchImpl })
    expect(url).toBe("https://www.codebuddy.ai/v2/billing/meter/get-enterprise-user-usage")
  })

  it("throws on a non-zero upstream code", async () => {
    const bad = (async () =>
      new Response(JSON.stringify({ code: 401, msg: "unauthorized" }), { status: 200 })) as unknown as typeof fetch
    await expect(fetchUpstream({ auth, fetchImpl: bad })).rejects.toThrow("upstream code 401")
  })

  it("throws on a non-2xx status", async () => {
    const bad = (async () => new Response("", { status: 500 })) as unknown as typeof fetch
    await expect(fetchUpstream({ auth, fetchImpl: bad })).rejects.toThrow("upstream HTTP 500")
  })

  it("throws when credit or limitNum is missing", async () => {
    await expect(fetchUpstream({ auth, fetchImpl: ok({ limitNum: 7000 }) })).rejects.toThrow("credit/limitNum")
  })

  it("rejects a 200 response whose body is not JSON", async () => {
    const html = (async () => new Response("<html>401</html>", { status: 200 })) as unknown as typeof fetch
    await expect(fetchUpstream({ auth, fetchImpl: html })).rejects.toThrow()
  })
})

describe("personal account quota (get-user-resource)", () => {
  const personal: SiteAuth = {
    ...auth, enterpriseId: null,
    endpoint: "https://www.codebuddy.ai", usageHost: "https://www.codebuddy.ai",
  }

  const resourceBody = {
    code: 0,
    data: {
      Response: {
        Data: {
          TotalDosage: 380,
          Accounts: [
            { PackageName: "Bonus Pack", CapacityType: 1, CycleStartTime: "2026-11-05 14:56:37", CycleCapacityRemainPrecise: "250", CycleCapacitySizePrecise: "250", CycleEndTime: "2026-11-20 14:56:36" },
            { PackageName: "Free Plan Subscription", CapacityType: 4, CycleStartTime: "2026-11-01 00:00:00", CycleCapacityRemainPrecise: "97.21", CycleCapacitySizePrecise: "100", CycleEndTime: "2026-11-30 23:59:59" },
            { PackageName: "Bonus Pack", CapacityType: 1, CycleStartTime: "2026-11-20 06:36:00", CycleCapacityRemainPrecise: "30", CycleCapacitySizePrecise: "30", CycleEndTime: "2026-12-20 06:35:59" },
          ],
        },
      },
    },
  }

  it("routes a personal account to get-user-resource and sums all packages", async () => {
    let url = ""
    let headers: Record<string, string> = {}
    const fetchImpl = (async (u: string | URL | Request, init?: RequestInit) => {
      url = String(u)
      headers = (init?.headers ?? {}) as Record<string, string>
      return new Response(JSON.stringify(resourceBody), { status: 200 })
    }) as unknown as typeof fetch
    const r = await fetchUpstream({ auth: personal, fetchImpl })
    expect(url).toBe("https://www.codebuddy.ai/v2/billing/meter/get-user-resource")
    expect(headers["authorization"]).toBe("Bearer jwt-cn")
    expect(headers["x-domain"]).toBe("www.codebuddy.ai")
    expect(headers["user-agent"]).toContain("CLI/")
    expect(r.remaining).toBeCloseTo(377.21, 2)
    expect(r.total).toBe(380)
    expect(r.used).toBeCloseTo(2.79, 2)
    // Cycle boundaries come from the main plan (Free Plan Subscription), not
    // the earliest-expiring bonus package.
    expect(r.cycleStart).toBe("2026-11-01 00:00:00")
    expect(r.cycleEnd).toBe("2026-11-30 23:59:59")
    expect(r.resetAt).toBe("2026-11-30 23:59:59")
  })

  it("keeps cycle boundaries from one source when the main plan has no end time", async () => {
    // Main plan declares a start but no end; the reset falls back to the earliest
    // bonus package. cycleStart must fall back too, or start/end come from
    // different packages and the time ratio can exceed 100%.
    const fetchImpl = ok({
      Response: {
        Data: {
          Accounts: [
            { PackageName: "Bonus Pack", CapacityType: 1, CycleCapacityRemainPrecise: "30", CycleCapacitySizePrecise: "30", CycleEndTime: "2026-11-20 14:56:36" },
            { PackageName: "Free Plan Subscription", CapacityType: 4, CycleCapacityRemainPrecise: "97.21", CycleCapacitySizePrecise: "100", CycleStartTime: "2026-11-01 00:00:00" },
          ],
        },
      },
    })
    const r = await fetchUpstream({ auth: personal, fetchImpl })
    expect(r.cycleStart).toBeNull()
    expect(r.cycleEnd).toBe("2026-11-20 14:56:36")
  })

  it("falls back to the earliest package end when no main plan is present", async () => {
    const fetchImpl = ok({
      Response: {
        Data: {
          Accounts: [
            { PackageName: "Bonus Pack", CapacityType: 1, CycleCapacityRemainPrecise: "30", CycleCapacitySizePrecise: "30", CycleEndTime: "2026-11-20 14:56:36" },
            { PackageName: "Bonus Pack", CapacityType: 1, CycleCapacityRemainPrecise: "50", CycleCapacitySizePrecise: "50", CycleEndTime: "2026-12-20 06:35:59" },
          ],
        },
      },
    })
    const r = await fetchUpstream({ auth: personal, fetchImpl })
    expect(r.cycleStart).toBeNull()
    expect(r.cycleEnd).toBe("2026-11-20 14:56:36")
    expect(r.resetAt).toBe("2026-11-20 14:56:36")
  })

  it("still uses the enterprise endpoint for an enterprise account", async () => {
    let url = ""
    const fetchImpl = (async (u: string | URL | Request) => {
      url = String(u)
      return new Response(JSON.stringify({ code: 0, data: {
        credit: 10, limitNum: 100, cycleEndTime: "2026-11-30 23:59:59",
      } }), { status: 200 })
    }) as unknown as typeof fetch
    await fetchUpstream({ auth, fetchImpl })
    expect(url).toContain("get-enterprise-user-usage")
  })
})
