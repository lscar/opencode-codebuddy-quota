import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { Site } from "../shared"
import { apiHeaders } from "./headers"
import { SITE_ENDPOINTS } from "./login"
import type { TokenStore } from "./token-store"

export function routeSite(url: string): Site | null {
  if (url.startsWith("/cn/v2/")) return "cn"
  if (url.startsWith("/intl/v2/")) return "intl"
  return null
}

export function upstreamUrl(site: Site, pathAfterV2: string): string {
  return `${SITE_ENDPOINTS[site].endpoint}/v2/${pathAfterV2}`
}

/** The bits of an HTTP request the handler needs. */
export interface ProxyRequest {
  url: string
  method?: string
  headers?: Record<string, string | string[] | undefined>
}

/** The bits of an HTTP response the handler writes to. */
export interface ProxyResponse {
  status(code: number): void
  setHeader(name: string, value: string): void
  write(chunk: string | Uint8Array): void
  end(chunk?: string | Uint8Array): void
}

export interface HandleRequestDeps {
  store: TokenStore
  fetchImpl?: typeof fetch
  /** Reads the inbound body; injectable so the handler is testable without a socket. */
  readBody?: (req: ProxyRequest) => Promise<string>
  /** Aborts when the client disconnects, so we stop the upstream SSE stream. */
  signal?: AbortSignal
  /** Optional logger; errors are logged here, never echoed to the client body. */
  log?: (message: string) => void
}

/** Force `stream:true` on the chat body so the upstream always answers with SSE. */
function withStream(body: string): string {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>
    parsed.stream = true
    return JSON.stringify(parsed)
  } catch {
    return body
  }
}

const copyHeaders = (from: Headers, to: ProxyResponse): void => {
  for (const [key, value] of from.entries()) {
    // Hop-by-hop / framing / content-encoding headers are unsafe to forward:
    // undici already decompressed the body, so a forwarded gzip header would
    // make strict clients try to gunzip plain text.
    if (
      key === "content-length" ||
      key === "transfer-encoding" ||
      key === "connection" ||
      key === "content-encoding" ||
      key === "keep-alive" ||
      key === "upgrade" ||
      key === "trailer"
    ) continue
    to.setHeader(key, value)
  }
}

export async function handleRequest(
  req: ProxyRequest,
  res: ProxyResponse,
  deps: HandleRequestDeps,
): Promise<void> {
  const site = routeSite(req.url ?? "")
  if (!site) {
    res.status(404)
    res.end("not found")
    return
  }
  const auth = await deps.store.ensureFresh(site)
  const pathAfterV2 = req.url!.split("/v2/")[1] ?? ""
  const url = upstreamUrl(site, pathAfterV2)
  const readBody = deps.readBody ?? (() => Promise.resolve(""))
  const raw = await readBody(req)
  const body = withStream(raw)
  const doFetch = deps.fetchImpl ?? fetch

  let upstream: Response
  try {
    upstream = await doFetch(url, {
      method: "POST",
      headers: {
        ...apiHeaders(auth, { accept: "text/event-stream" }),
        "Content-Type": "application/json",
      },
      body,
      signal: deps.signal,
    })
  } catch (err) {
    deps.log?.(`proxy upstream error: ${String((err as Error)?.message ?? err)}`)
    res.status(502)
    res.end() // never echo internal error detail (host/path) to the caller
    return
  }

  copyHeaders(upstream.headers, res)
  res.status(upstream.status)

  const reader = upstream.body?.getReader()
  if (!reader) {
    const text = await upstream.text()
    res.end(text)
    return
  }
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    res.write(value)
  }
  res.end()
}

export interface ProxyServer {
  start(port: number): Promise<void>
  close(): Promise<void>
}

export function createProxy(deps: {
  store: TokenStore
  fetchImpl?: typeof fetch
  log?: (message: string) => void
}): ProxyServer {
  const server = createServer((incoming: IncomingMessage, outgoing: ServerResponse) => {
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(incoming.headers)) {
      if (typeof v === "string") headers[k] = v
      else if (Array.isArray(v)) headers[k] = v.join(", ")
    }
    const controller = new AbortController()
    // A client that disconnects (Esc / tab close) must stop the upstream stream,
    // otherwise the full SSE answer is generated and billed to the user's quota.
    outgoing.on("close", () => controller.abort())
    incoming.on("aborted", () => controller.abort())
    const chunks: Buffer[] = []
    let size = 0
    const MAX_BODY = 8 * 1024 * 1024
    let tooLarge = false
    incoming.on("data", (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) {
        tooLarge = true
        controller.abort()
        return
      }
      chunks.push(c)
    })
    incoming.on("end", () => {
      if (tooLarge || controller.signal.aborted) {
        if (!outgoing.headersSent) outgoing.writeHead(413)
        outgoing.end()
        return
      }
      const text = Buffer.concat(chunks).toString("utf8")
      const response: ProxyResponse = {
        status: (code) => outgoing.writeHead(code),
        setHeader: (name, value) => outgoing.setHeader(name, value),
        write: (chunk) => { outgoing.write(chunk) },
        end: (chunk) => { outgoing.end(chunk) },
      }
      void handleRequest(
        { url: incoming.url ?? "", method: incoming.method, headers },
        response,
        {
          store: deps.store,
          fetchImpl: deps.fetchImpl,
          readBody: async () => text,
          signal: controller.signal,
          log: deps.log,
        },
      ).catch(() => {
        if (controller.signal.aborted) return
        if (!outgoing.headersSent) outgoing.writeHead(500)
        outgoing.end()
      })
    })
  })
  return {
    start: (port) =>
      new Promise<void>((resolve, reject) => {
        server.once("error", reject)
        server.listen(port, "127.0.0.1", () => resolve())
      }),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      }),
  }
}
