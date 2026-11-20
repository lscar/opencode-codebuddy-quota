import { existsSync, writeFileSync } from "node:fs"
import { Plugin } from "@opencode/plugin"
import { CodebuddyQuota } from "./rpc"
import type { Site } from "./src/shared"
import { fetchCatalog } from "./src/server/catalog"
import { loadConfig, opencodeConfigPath } from "./src/server/config"
import { writeProvider } from "./src/server/config-writer"
import { createDedupedLogger } from "./src/server/logger"
import { getAuthState, openBrowser, pollToken } from "./src/server/login"
import { buildModels } from "./src/server/model-info"
import { readModelsDevCatalog } from "./src/server/models-dev"
import { latestTaggedVersion } from "./src/server/package-version"
import { createProxy } from "./src/server/proxy"
import { createQuotaSource } from "./src/server/quota-source"
import { currentSite, siteInfo } from "./src/server/site-state"
import { createTokenStore } from "./src/server/token-store"
import { fetchUpstream } from "./src/server/upstream"
import { toWireReading } from "./src/server/wire"

const PROXY_PORT = 7688
const UPSTREAM_TIMEOUT_MS = 15_000

/** AbortSignal.any is not guaranteed in every runtime OpenCode embeds. */
function anySignal(signals: AbortSignal[]): AbortSignal {
  for (const signal of signals) {
    if (signal.aborted) return AbortSignal.abort(signal.reason)
  }
  const controller = new AbortController()
  for (const signal of signals) {
    signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true })
  }
  return controller.signal
}

export default Plugin.define({
  id: "codebuddy-quota-v2",
  async setup(ctx) {
    const log = createDedupedLogger((line) => console.warn(line), "[codebuddy-quota-v2]")

    // Restore both sites' credentials from the plugin-owned cache; no CLI auth
    // file is read, and no token ever reaches the GUI.
    const store = createTokenStore()

    const source = createQuotaSource({
      readForSite: (site, signal) => {
        const timeout = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
        return store
          .ensureFresh(site)
          .then((auth) =>
            fetchUpstream({ auth, signal: signal ? anySignal([signal, timeout]) : timeout }),
          )
      },
    })

    // Local reverse proxy: providers point here; the proxy injects the current
    // site's JWT on each request. Port conflicts are logged and non-fatal to the
    // rest of the panel.
    const proxy = createProxy({ store })
    try {
      await proxy.start(PROXY_PORT)
      log(`local proxy listening on 127.0.0.1:${PROXY_PORT}`)
    } catch (error) {
      log(`local proxy could not bind ${PROXY_PORT}: ${String((error as Error)?.message ?? error)}`)
    }

    /**
     * Model import: for every site that has an account, fetch its cli-whitelist
     * catalog with that site's JWT and write a dedicated provider block. The
     * legacy `codebuddy` provider is never touched.
     */
    const importModels = async () => {
      const config = loadConfig()
      const modelsDev = readModelsDevCatalog()
      const latest = await latestTaggedVersion()
      const packageVersion = latest ?? config.package_version
      const target = opencodeConfigPath()
      for (const site of ["cn", "intl"] as Site[]) {
        const auth = store.get(site)
        if (!auth) {
          log(`no ${site} account; skipping its model import`)
          continue
        }
        try {
          const catalog = await fetchCatalog({ site, auth })
          const models = buildModels({ catalog, config, modelsDev, log })
          if (models.length === 0) {
            log(`${site} catalog produced no models; skipping write`)
            continue
          }
          const result = writeProvider({
            jsoncPath: target,
            providerId: site === "cn" ? "codebuddy-cn" : "codebuddy-intl",
            models,
            packageVersion,
            proxyPort: PROXY_PORT,
            backup: (path, content) => {
              const backupPath = `${path}.codebuddy-quota-v2.bak`
              try {
                // Only the first backup is kept, so the pre-plugin original survives.
                if (!existsSync(backupPath)) writeFileSync(backupPath, content, "utf8")
              } catch {
                // Backup is best-effort; never block the provider write.
              }
            },
          })
          if (result.status === "skipped") log(`${site} provider write skipped: ${result.reason}`)
        } catch (error) {
          log(`${site} model import failed: ${String((error as Error)?.message ?? error)}`)
        }
      }
    }
    void importModels()

    const registration = await ctx.rpc.register(CodebuddyQuota, {
      read: async (input, context) => {
        const state = store.all()
        const requested = (input as { site?: Site } | undefined)?.site
        const site = requested ?? currentSite(state)
        const reading = await source.read(site, context.signal)
        return toWireReading(reading, { site, sites: siteInfo(state).sites })
      },
      login: async (input) => {
        const site = (input as { site: Site }).site
        try {
          const { state, authUrl } = await getAuthState(site)
          openBrowser(authUrl)
          const auth = await pollToken(site, state)
          store.archive(auth)
          log(`${site} login complete`)
          return { ok: true, error: null }
        } catch (error) {
          const message = String((error as Error)?.message ?? error)
          log(`${site} login failed: ${message}`)
          return { ok: false, error: message }
        }
      },
    })

    return () => {
      registration.dispose()
      void proxy.close()
    }
  },
})
