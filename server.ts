import { Plugin } from "@opencode/plugin"
import { CodebuddyQuota } from "./rpc"
import { createQuotaSource } from "./src/server/quota-source"
import { fetchUpstream, readApiKey } from "./src/server/upstream"
import { toWireReading } from "./src/server/wire"

const UPSTREAM_TIMEOUT_MS = 15_000

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

    const registration = await ctx.rpc.register(CodebuddyQuota, {
      // `context.signal` fires when the caller goes away (a window closed), which
      // is why it is threaded through rather than dropped.
      read: async (_input, context) => toWireReading(await source.read(context.signal)),
    })

    return () => registration.dispose()
  },
})
