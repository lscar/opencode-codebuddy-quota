import { describe, expect, it } from "bun:test"
import { fetchUpstream, readApiKey } from "./upstream"

const ok = (data: Record<string, unknown>) => (async () =>
  new Response(JSON.stringify({ code: 0, data }), { status: 200 })) as unknown as typeof fetch

const upstream = (over: Record<string, unknown> = {}) => ({
  credit: 754.44,
  limitNum: 7000,
  cycleStartTime: "2026-10-28 00:00:00",
  cycleEndTime: "2026-11-27 23:59:59",
  cycleResetTime: "2026-11-28 00:00:00",
  ...over,
})

describe("fetchUpstream", () => {
  it("computes remaining from used and total", async () => {
    const r = await fetchUpstream({ key: "k", fetchImpl: ok(upstream()) })
    expect(r.used).toBe(754.44)
    expect(r.total).toBe(7000)
    expect(r.remaining).toBeCloseTo(6245.56, 2)
    expect(r.resetAt).toBe("2026-11-28 00:00:00")
  })

  it("never returns a negative remaining when used exceeds total", async () => {
    const r = await fetchUpstream({ key: "k", fetchImpl: ok(upstream({ credit: 9000 })) })
    expect(r.remaining).toBe(0)
  })

  it("throws on a non-zero upstream code", async () => {
    const bad = (async () =>
      new Response(JSON.stringify({ code: 401, msg: "unauthorized" }), { status: 200 })) as unknown as typeof fetch
    await expect(fetchUpstream({ key: "k", fetchImpl: bad })).rejects.toThrow("upstream code 401")
  })

  it("throws on a non-2xx status", async () => {
    const bad = (async () => new Response("", { status: 500 })) as unknown as typeof fetch
    await expect(fetchUpstream({ key: "k", fetchImpl: bad })).rejects.toThrow("upstream HTTP 500")
  })

  it("throws when credit or limitNum is missing", async () => {
    await expect(fetchUpstream({ key: "k", fetchImpl: ok({ limitNum: 7000 }) })).rejects.toThrow("credit/limitNum")
  })

  it("throws when the key is empty", async () => {
    await expect(fetchUpstream({ key: "  ", fetchImpl: ok(upstream()) })).rejects.toThrow("OPENCODE_CODEBUDDY_API_KEY")
  })

  it("rejects a 200 response whose body is not JSON", async () => {
    const html = (async () => new Response("<html>401</html>", { status: 200 })) as unknown as typeof fetch
    await expect(fetchUpstream({ key: "k", fetchImpl: html })).rejects.toThrow()
  })
})

describe("readApiKey", () => {
  it("trims and returns the environment value", () => {
    process.env.OPENCODE_CODEBUDDY_API_KEY = "  abc  "
    expect(readApiKey()).toBe("abc")
  })

  it("returns an empty string when the variable is absent", () => {
    delete process.env.OPENCODE_CODEBUDDY_API_KEY
    expect(readApiKey()).toBe("")
  })
})
