import type { Site } from "../shared"
import { createLoginGate, type LoginGate } from "./login-gate"
import { getAuthState, openBrowser, pollToken, type SiteAuth } from "./login"
import { resolveSite } from "./site-select"
import { siteInfo } from "./site-state"
import type { TokenStore } from "./token-store"
import type { QuotaSource, Reading } from "./quota-source"
import { toWireReading, type WireReading } from "./wire"

/** The `read`/`login` handlers the plugin registers over RPC. */
export interface RpcHandlers {
  read(input: unknown, context: { signal: AbortSignal }): Promise<WireReading>
  login(input: unknown): Promise<{ ok: boolean; error: string | null }>
}

export interface HandlerDeps {
  store: TokenStore
  source: QuotaSource
  log: (message: string) => void
  /** Injectable login step returning the new credential; defaults to browser flow. */
  performLogin?: (site: Site) => Promise<SiteAuth>
  /** Injectable gate; defaults to per-site single-flight. */
  loginGate?: LoginGate
}

/**
 * Build the RPC handlers. Kept free of Plugin/Context so the wiring —
 * site selection persistence, post-refresh cache snapshot, login single-flight —
 * can be asserted without starting a real proxy or touching the disk.
 */
export function makeRpcHandlers(deps: HandlerDeps): RpcHandlers {
  const gate = deps.loginGate ?? createLoginGate()
  // Returns the new credential; the handler archives it on success so the
  // write is part of the tested assembly, not hidden in the login step.
  const performLogin =
    deps.performLogin ??
    (async (site) => {
      const { state, authUrl } = await getAuthState(site)
      openBrowser(authUrl)
      return pollToken(site, state)
    })

  return {
    async read(input, context) {
      const requested = (input as { site?: Site } | undefined)?.site
      const site = resolveSite(deps.store, requested, (m) => deps.log(m))
      const reading: Reading = await deps.source.read(site, context.signal)
      // Read the cache AFTER the refresh so a rotated token cannot leave a
      // stale "needs login" tag next to freshly returned numbers.
      const state = deps.store.all()
      return toWireReading(reading, { site, sites: siteInfo(state, (s) => deps.store.refreshFailed(s)).sites })
    },
    async login(input) {
      const site = (input as { site: Site }).site
      return gate.run(site, async () => {
        try {
          const auth = await performLogin(site)
          deps.store.archive(auth)
          deps.log(`${site} login complete`)
          return { ok: true, error: null }
        } catch (error) {
          const message = String((error as Error)?.message ?? error)
          deps.log(`${site} login failed: ${message}`)
          return { ok: false, error: message }
        }
      })
    },
  }
}
