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

/**
 * Response double that models Node's writeHead: headers set before `status()`
 * are captured exactly once; later setHeader calls are ignored (as Node throws).
 */
function resDouble(): ProxyResponse & { chunks: string[]; statusCode: number; headers: Record<string, string> } {
  const chunks: string[] = []
  let statusCode = 200
  const pending: Record<string, string> = {}
  let written: Record<string, string> | null = null
  return {
    status(code: number) {
      statusCode = code
      written = { ...pending } // writeHead captures headers at this instant
    },
    setHeader(k: string, v: string) {
      if (!written) pending[k.toLowerCase()] = v // after writeHead Node would throw
    },
    write(chunk: string | Uint8Array) { chunks.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk)) },
    end(chunk?: string | Uint8Array) { if (chunk !== undefined) chunks.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk)) },
    get chunks() { return chunks },
    get statusCode() { return statusCode },
    get headers() { return written ?? pending },
  }
}

describe("handleRequest", () => {
  const storeWith = (site: "cn" | "intl" = "cn") => {
    const cn = auth()
    const intlAuth: SiteAuth = {
      ...cn, id: "intl:u1", enterpriseId: null, realmDomain: "www.codebuddy.ai",
      endpoint: "https://www.codebuddy.ai", usageHost: "https://www.codebuddy.ai",
    }
    const store = createTokenStore({
      load: () => ({
        accounts: { cn: site === "cn" ? [cn] : [], intl: site === "intl" ? [intlAuth] : [] },
        activeId: { cn: site === "cn" ? cn.id : null, intl: site === "intl" ? intlAuth.id : null },
        selected: site,
      }),
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

  it("adds the intl channel-verification headers and leading system prompt", async () => {
    let headers: Record<string, string> = {}
    let body = ""
    const fetchImpl = (async (_u: string | URL | Request, init?: RequestInit) => {
      headers = (init?.headers ?? {}) as Record<string, string>
      body = String(init?.body ?? "")
      return new Response("data: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream" } })
    }) as unknown as typeof fetch
    const intlAuth = (): SiteAuth => ({
      id: "intl:u1", accessToken: "jwt-intl", refreshToken: "r1",
      expiresAt: Date.now() + 3_600_000, refreshExpiresAt: Date.now() + 86_400_000,
      uid: "u1", enterpriseId: null, realmDomain: "www.codebuddy.ai",
      endpoint: "https://www.codebuddy.ai", usageHost: "https://www.codebuddy.ai",
    })
    const store = createTokenStore({
      load: () => ({ accounts: { cn: [], intl: [intlAuth()] }, activeId: { cn: null, intl: "intl:u1" }, selected: "intl" }),
      persist: () => {},
    })
    await handleRequest(
      { url: "/intl/v2/chat/completions", method: "POST" },
      resDouble(),
      {
        store, fetchImpl,
        readBody: async () => JSON.stringify({ model: "m", messages: [{ role: "user", content: "Hi" }] }),
      },
    )
    expect(headers["x-conversation-id"]).toBeTruthy()
    expect(headers["x-conversation-request-id"]).toBeTruthy()
    expect(headers["x-conversation-message-id"]).toBeTruthy()
    expect(headers["x-request-id"]).toBe(headers["x-conversation-message-id"])
    expect(headers["x-app"]).toBe("cli")
    const parsed = JSON.parse(body)
    expect(parsed.messages[0]).toEqual({ role: "system", content: "You are CodeBuddy Code." })
    expect(parsed.messages[1]).toEqual({ role: "user", content: "Hi" })
  })

  it("does not turn a missing messages array into a system-only request", async () => {
    let body = ""
    const fetchImpl = (async (_u: string | URL | Request, init?: RequestInit) => {
      body = String(init?.body ?? "")
      return new Response("data: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream" } })
    }) as unknown as typeof fetch
    await handleRequest(
      { url: "/intl/v2/chat/completions", method: "POST" },
      resDouble(),
      {
        store: storeWith("intl"),
        fetchImpl,
        readBody: async () => JSON.stringify({ model: "m" }),
      },
    )
    const parsed = JSON.parse(body)
    expect(parsed.messages).toBeUndefined()
  })

  it("detects an existing system identity anywhere and does not prepend a duplicate", async () => {
    let body = ""
    const fetchImpl = (async (_u: string | URL | Request, init?: RequestInit) => {
      body = String(init?.body ?? "")
      return new Response("data: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream" } })
    }) as unknown as typeof fetch
    await handleRequest(
      { url: "/intl/v2/chat/completions", method: "POST" },
      resDouble(),
      {
        store: storeWith("intl"),
        fetchImpl,
        // Identity deliberately NOT first: a first-only check would prepend a duplicate.
        readBody: async () => JSON.stringify({
          model: "m",
          messages: [
            { role: "user", content: "Hi" },
            { role: "system", content: "You are CodeBuddy Code." },
          ],
        }),
      },
    )
    const parsed = JSON.parse(body)
    const identityCount = parsed.messages.filter(
      (m: { content?: unknown }) => typeof m.content === "string" && m.content.includes("CodeBuddy Code"),
    ).length
    expect(identityCount).toBe(1)
    expect(parsed.messages.length).toBe(2)
  })

  it("does not mistake an unrelated system message that merely mentions the name for the identity", async () => {
    let body = ""
    const fetchImpl = (async (_u: string | URL | Request, init?: RequestInit) => {
      body = String(init?.body ?? "")
      return new Response("data: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream" } })
    }) as unknown as typeof fetch
    await handleRequest(
      { url: "/intl/v2/chat/completions", method: "POST" },
      resDouble(),
      {
        store: storeWith("intl"),
        fetchImpl,
        readBody: async () => JSON.stringify({
          model: "m",
          messages: [
            { role: "system", content: "Follow the CodeBuddy Code style guide when replying." },
            { role: "user", content: "Hi" },
          ],
        }),
      },
    )
    const parsed = JSON.parse(body)
    // The real identity must be injected because the unrelated system message
    // only mentions the name; a loose `includes` check would wrongly skip it.
    expect(parsed.messages[0]).toEqual({ role: "system", content: "You are CodeBuddy Code." })
    const identities = parsed.messages.filter(
      (m: { role?: string; content?: unknown }) =>
        m.role === "system" && m.content === "You are CodeBuddy Code.",
    )
    expect(identities).toHaveLength(1)
  })

  it("does not duplicate the identity when it has trailing whitespace or is an array", async () => {
    // The identity may arrive wrapped with trailing whitespace/newline, or as a
    // multimodal content array. All are semantically the identity and must not
    // get a second copy injected — but must still not match unrelated text.
    const shapes: unknown[] = [
      "You are CodeBuddy Code.\n",
      "You are CodeBuddy Code. ",
      [{ type: "text", text: "You are CodeBuddy Code." }],
    ]
    for (const content of shapes) {
      let body = ""
      const fetchImpl = (async (_u: string | URL | Request, init?: RequestInit) => {
        body = String(init?.body ?? "")
        return new Response("data: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream" } })
      }) as unknown as typeof fetch
      await handleRequest(
        { url: "/intl/v2/chat/completions", method: "POST" },
        resDouble(),
        {
          store: storeWith("intl"),
          fetchImpl,
          readBody: async () => JSON.stringify({
            model: "m",
            messages: [{ role: "system", content }, { role: "user", content: "Hi" }],
          }),
        },
      )
      const parsed = JSON.parse(body)
      const asText = (c: unknown) =>
        typeof c === "string" ? c
        : Array.isArray(c) ? c.map((b: any) => String(b?.text ?? "")).join("")
        : ""
      const identities = parsed.messages.filter(
        (m: { role?: string; content?: unknown }) =>
          m.role === "system" && asText(m.content).trim() === "You are CodeBuddy Code.",
      )
      expect(identities).toHaveLength(1)
    }
  })

  it("does not forward content-encoding (body is already decompressed)", async () => {
    const fetchImpl = (async () =>
      new Response("data: [DONE]\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream", "content-encoding": "gzip" },
      })) as unknown as typeof fetch
    const res = resDouble()
    await handleRequest({ url: "/cn/v2/chat/completions" }, res, {
      store: storeWith(), fetchImpl, readBody: async () => "{}",
    })
    expect(res.headers["content-encoding"]).toBeUndefined()
  })

  it("passes the client abort signal through to the upstream fetch", async () => {
    const controller = new AbortController()
    let seen: AbortSignal | undefined
    const fetchImpl = (async (_u: string | URL | Request, init?: RequestInit) => {
      seen = init?.signal as AbortSignal | undefined
      return new Response('data: [DONE]\n\n', { status: 200, headers: { "content-type": "text/event-stream" } })
    }) as unknown as typeof fetch
    const req: ProxyRequest = { url: "/cn/v2/chat/completions", method: "POST" }
    await handleRequest(req, resDouble(), {
      store: storeWith(), fetchImpl, readBody: async () => "{}", signal: controller.signal,
    })
    expect(seen).toBe(controller.signal)
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
