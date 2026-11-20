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
