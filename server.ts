import { copyFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { Plugin } from "@opencode/plugin"
import { CodebuddyQuota } from "./rpc"
import { fetchCatalog } from "./src/server/catalog"
import { configPath, loadConfig } from "./src/server/config"
import { writeModels } from "./src/server/config-writer"
import { createDedupedLogger } from "./src/server/logger"
import { buildModels } from "./src/server/model-info"
import { readModelsDevCatalog } from "./src/server/models-dev"
import { createQuotaSource } from "./src/server/quota-source"
import { fetchUpstream, readApiKey } from "./src/server/upstream"
import { toWireReading } from "./src/server/wire"

const UPSTREAM_TIMEOUT_MS = 15_000

/** `~/.config/opencode/opencode.jsonc`, beside `codebuddy-quota.json`. */
function opencodeConfigPath(): string {
  return join(configPath().replace(/[/\\]codebuddy-quota\.json$/, ""), "opencode.jsonc")
}

/** AbortSignal.any is not guaranteed in every runtime OpenCode embeds. */
function anySignal(signals: AbortSignal[]): AbortSignal {
  for (const signal of signals) {
    // Aborting first is not an optimization: a listener added to an already
    // aborted signal never fires, so the merged signal would ignore it.
    if (signal.aborted) return AbortSignal.abort(signal.reason)
  }
  const controller = new AbortController()
  for (const signal of signals) {
    signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true })
  }
  return controller.signal
}

/**
 * The only part of this plugin that talks to the upstream. The GUI windows call
 * `read` over the plugin RPC, so the credential never enters a window process
 * and nothing has to listen on a port.
 */
export default Plugin.define({
  id: "codebuddy-quota",
  async setup(ctx) {
    const log = createDedupedLogger((line) => console.warn(line), "[codebuddy-quota]")

    const source = createQuotaSource({
      fetchUpstream: (signal) => {
        const timeout = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
        // Read the key per call, so a fixed environment takes effect on restart
        // rather than being frozen at plugin load.
        return fetchUpstream({
          key: readApiKey(),
          signal: signal ? anySignal([signal, timeout]) : timeout,
        })
      },
    })

    /**
     * Model import happens once, at plugin load, and writes into the user's
     * `opencode.jsonc` rather than mutating providers at runtime.
     *
     * `ctx.provider.transform` looks like the right hook, but in OpenCode 2.2.5
     * the provider records it hands out are already frozen: `add()`,
     * `models.set()` and `update()` all throw "Attempted to assign to readonly
     * property", and a transform that throws is silently discarded. The config
     * file is read *before* providers resolve, so it is the one place a plugin
     * can add models that actually reach the picker.
     *
     * Nothing here is allowed to take the quota panel down with it.
     */
    if (readApiKey().trim()) {
      try {
        const models = buildModels({
          catalog: await fetchCatalog({ key: readApiKey() }),
          config: loadConfig(),
          modelsDev: readModelsDevCatalog(),
          log,
        })

        const target = opencodeConfigPath()
        if (models.length > 0 && existsSync(target)) {
          // A plugin editing the user's config must leave a way back.
          copyFileSync(target, `${target}.codebuddy-quota.bak`)
          const result = writeModels({ jsoncPath: target, models })
          if (result.written) log(`imported ${models.length} models into ${target}; restart to pick them up`)
          else log(`left ${target} untouched: ${result.reason}`)
        }
      } catch (error) {
        log(`model import failed: ${String((error as Error)?.message ?? error)}`)
      }
    }

    const registration = await ctx.rpc.register(CodebuddyQuota, {
      // `context.signal` fires when the caller goes away (a window closed), which
      // is why it is threaded through rather than dropped.
      read: async (_input, context) => toWireReading(await source.read(context.signal)),
    })

    return () => registration.dispose()
  },
})
