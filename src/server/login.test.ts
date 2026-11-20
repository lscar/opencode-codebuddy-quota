import { describe, expect, it } from "bun:test"
import {
  authFromToken,
  decodeJwtPayload,
  getAuthState,
  openBrowser,
  pollToken,
  SITE_ENDPOINTS,
  type TokenPair,
} from "./login"

/** Build an unsigned JWT-shaped string with the given payload (header.payload.sig). */
const jwtWith = (payload: Record<string, unknown>): string => {
  const enc = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url")
  return `${enc({ alg: "none", typ: "JWT" })}.${enc(payload)}.sig`
}

const cnPayload = {
  sub: "d5d448c3-f02a-4d9f-94d5-8a305e959974",
  iss: "https://www.codebuddy.cn/auth/realms/copilot",
  enterprise_id: "feh7waqxv11c",
}

const intlPayload = {
  sub: "f78182da-d3f6-4847-8715-2546ea5e39c4",
  iss: "https://www.codebuddy.ai/auth/realms/copilot",
}

const pair: TokenPair = {
  accessToken: jwtWith(cnPayload),
  refreshToken: "refresh-abc",
  expiresIn: 2419200,
  refreshExpiresIn: 2592000,
}

describe("decodeJwtPayload", () => {
  it("decodes sub and iss without verifying the signature", () => {
    const p = decodeJwtPayload(pair.accessToken)
    expect(p.sub).toBe(cnPayload.sub)
    expect(p.iss).toBe(cnPayload.iss)
    expect(p.enterprise_id).toBe("feh7waqxv11c")
  })
})

describe("SITE_ENDPOINTS", () => {
  it("maps cn to the Tencent endpoint and codebuddy.cn usage host", () => {
    expect(SITE_ENDPOINTS.cn.endpoint).toBe("https://copilot.tencent.com")
    expect(SITE_ENDPOINTS.cn.usageHost).toBe("https://www.codebuddy.cn")
  })
  it("maps intl to codebuddy.ai for both endpoint and usage", () => {
    expect(SITE_ENDPOINTS.intl.endpoint).toBe("https://www.codebuddy.ai")
    expect(SITE_ENDPOINTS.intl.usageHost).toBe("https://www.codebuddy.ai")
  })
})

describe("authFromToken", () => {
  it("builds a cn SiteAuth with id, uid, enterpriseId, realmDomain and endpoints", () => {
    const now = 1_000_000
    const auth = authFromToken("cn", pair, () => now)
    expect(auth.id).toBe("cn:d5d448c3-f02a-4d9f-94d5-8a305e959974")
    expect(auth.uid).toBe(cnPayload.sub)
    expect(auth.enterpriseId).toBe("feh7waqxv11c")
    expect(auth.realmDomain).toBe("www.codebuddy.cn")
    expect(auth.endpoint).toBe("https://copilot.tencent.com")
    expect(auth.usageHost).toBe("https://www.codebuddy.cn")
    expect(auth.expiresAt).toBe(now + 2419200 * 1000)
    expect(auth.refreshExpiresAt).toBe(now + 2592000 * 1000)
    expect(auth.accessToken).toBe(pair.accessToken)
    expect(auth.refreshToken).toBe("refresh-abc")
  })

  it("omits enterpriseId for an international personal account", () => {
    const intlPair: TokenPair = { ...pair, accessToken: jwtWith(intlPayload) }
    const auth = authFromToken("intl", intlPair, () => 0)
    expect(auth.enterpriseId).toBe(null)
    expect(auth.realmDomain).toBe("www.codebuddy.ai")
    expect(auth.id).toBe("intl:f78182da-d3f6-4847-8715-2546ea5e39c4")
    expect(auth.endpoint).toBe("https://www.codebuddy.ai")
  })
})

describe("getAuthState", () => {
  it("POSTs auth/state with no-credentials headers and returns state/authUrl", async () => {
    let url = ""
    let headers: Record<string, string> = {}
    const fetchImpl = (async (u: string | URL | Request, init?: RequestInit) => {
      url = String(u)
      headers = (init?.headers ?? {}) as Record<string, string>
      return new Response(
        JSON.stringify({ code: 0, data: { state: "st-1", authUrl: "https://www.codebuddy.ai/login?state=st-1" } }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    }) as unknown as typeof fetch

    const r = await getAuthState("intl", { fetchImpl })
    expect(url).toContain("/v2/plugin/auth/state?platform=CLI")
    expect(headers["X-No-Authorization"]).toBe("true")
    expect(headers["X-No-User-Id"]).toBe("true")
    expect(r.state).toBe("st-1")
    expect(r.authUrl).toContain("state=st-1")
  })
})

describe("getAuthState retries", () => {
  it("does not retry a 4xx", async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      return new Response("unauthorized", { status: 401 })
    }) as unknown as typeof fetch
    await expect(getAuthState("cn", { fetchImpl, retries: 2 })).rejects.toThrow("401")
    expect(calls).toBe(1)
  })

  it("retries a 5xx up to the limit", async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      return new Response("server error", { status: 500 })
    }) as unknown as typeof fetch
    await expect(getAuthState("cn", { fetchImpl, retries: 2 })).rejects.toThrow()
    expect(calls).toBe(3)
  })
})

describe("pollToken", () => {
  it("keeps polling through 11217 pending then returns a SiteAuth", async () => {
    let n = 0
    const fetchImpl = (async (u: string | URL | Request) => {
      const url = String(u)
      expect(url).toContain("auth/token?state=st-1")
      n += 1
      if (n === 1) {
        return new Response(JSON.stringify({ code: 11217, msg: "login ing..." }), {
          status: 200, headers: { "content-type": "application/json" },
        })
      }
      return new Response(
        JSON.stringify({ code: 0, data: pair }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    }) as unknown as typeof fetch

    const auth = await pollToken("cn", "st-1", {
      fetchImpl, sleep: async () => {}, timeoutMs: 1000,
    })
    expect(n).toBe(2)
    expect(auth.uid).toBe(cnPayload.sub)
  })

  it("throws on timeout while still pending", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ code: 11217, msg: "login ing..." }), {
        status: 200, headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch
    await expect(
      pollToken("cn", "st-2", { fetchImpl, sleep: async () => {}, timeoutMs: -1, now: (() => {
        let t = 0
        return () => (t += 1000)
      })() }),
    ).rejects.toThrow()
  })
})

describe("openBrowser", () => {
  it("passes the authUrl to the injected opener", () => {
    let opened = ""
    openBrowser("https://www.codebuddy.ai/login?state=x", { opener: (u) => { opened = u } })
    expect(opened).toBe("https://www.codebuddy.ai/login?state=x")
  })
})
