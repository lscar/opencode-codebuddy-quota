import { describe, expect, it } from "bun:test"
import type { SiteAuth } from "./login"
import { createTokenStore } from "./token-store"
import { handleRequest, routeSite, upstreamUrl, type ProxyRequest, type ProxyResponse } from "./proxy"

const auth = (): SiteAuth => ({
  id: "cn:u1",
  accessToken: "jwt-cn",
  refreshToken: "r1",
  expiresAt: Date.now() + 3_600_000,
  refreshExpiresAt: Date.now() + 86_400_000,
  uid: "u1",
  enterpriseId: "ent-1",
  realmDomain: "www.codebuddy.cn",
  endpoint: "https://copilot.tencent.com",
  usageHost: "https://www.codebuddy.cn",
})

describe("routeSite", () => {
  it("maps cn/intl prefixes and rejects others", () => {
    expect(routeSite("/cn/v2/chat/completions")).toBe("cn")
    expect(routeSite("/intl/v2/chat/completions")).toBe("intl")
    expect(routeSite("/other")).toBe(null)
  })
})

describe("upstreamUrl", () => {
  it("appends the path after /v2 to the endpoint", () => {
    expect(upstreamUrl("cn", "chat/completions")).toBe("https://copilot.tencent.com/v2/chat/completions")
    expect(upstreamUrl("intl", "chat/completions")).toBe("https://www.codebuddy.ai/v2/chat/completions")
  })
})

/** Minimal response double that accumulates writes. */
function resDouble(): ProxyResponse & { chunks: string[]; statusCode: number; headers: Record<string, string> } {
  const state = { chunks: [] as string[], statusCode: 200, headers: {} as Record<string, string> }
  return {
    ...state,
    status(code: number) { state.statusCode = code },
    setHeader(k: string, v: string) { state.headers[k.toLowerCase()] = v },
    write(chunk: string | Uint8Array) { state.chunks.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk)) },
    end(chunk?: string | Uint8Array) { if (chunk !== undefined) state.chunks.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk)) },
    get chunks() { return state.chunks },
    get statusCode() { return state.statusCode },
    get headers() { return state.headers },
  }
}

describe("handleRequest", () => {
  const storeWith = () => {
    const store = createTokenStore({
      load: () => ({ accounts: { cn: [auth()], intl: [] }, activeId: { cn: "cn:u1", intl: null }, selected: "cn" }),
      persist: () => {},
    })
    return store
  }

  it("injects headers, forces stream:true, and passes SSE through", async () => {
    let url = ""
    let headers: Record<string, string> = {}
    let body = ""
    const sse = 'data: {"choices":[]}\n\ndata: [DONE]\n\n'
    const fetchImpl = (async (u: string | URL | Request, init?: RequestInit) => {
      url = String(u)
      headers = (init?.headers ?? {}) as Record<string, string>
      body = String(init?.body ?? "")
      return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } })
    }) as unknown as typeof fetch

    const req: ProxyRequest = { url: "/cn/v2/chat/completions", method: "POST" }
    const res = resDouble()
    await handleRequest(req, res, {
      store: storeWith(),
      fetchImpl,
      readBody: async () => JSON.stringify({ model: "m", messages: [] }),
    })
    expect(url).toBe("https://copilot.tencent.com/v2/chat/completions")
    expect(headers["x-domain"]).toBe("copilot.tencent.com")
    expect(headers["authorization"]).toBe("Bearer jwt-cn")
    expect(JSON.parse(body).stream).toBe(true)
    expect(res.headers["content-type"]).toBe("text/event-stream")
    expect(res.chunks.join("")).toContain("data: [DONE]")
  })

  it("passes non-200 status and body through unchanged", async () => {
    const fetchImpl = (async () =>
      new Response('{"code":400}', { status: 400, headers: { "content-type": "application/json" } })
    ) as unknown as typeof fetch
    const req: ProxyRequest = { url: "/cn/v2/chat/completions", method: "POST" }
    const res = resDouble()
    await handleRequest(req, res, {
      store: storeWith(),
      fetchImpl,
      readBody: async () => "{}",
    })
    expect(res.statusCode).toBe(400)
    expect(res.chunks.join("")).toContain('"code":400')
  })
})
