import { Rpc } from "@opencode/plugin/rpc"

/**
 * The RPC contract between this plugin's server part and its GUI part.
 *
 * Schemas are written as plain JSON Schema on purpose. The GUI bundle may only
 * import `@opencode/plugin/rpc`, which does not re-export `effect`, so an
 * Effect `Schema` here would not even bundle. JSON Schema also keeps both
 * sides' inferred types at `unknown`, which stops the GUI call from growing a
 * phantom required argument.
 *
 * This file must not import anything but `Rpc`: the server part runs it as
 * TypeScript directly, and the GUI part bundles it into a window.
 */
const nullableString = { type: ["string", "null"] } as const
const nullableNumber = { type: ["number", "null"] } as const

export const CodebuddyQuota = Rpc.define({
  id: "codebuddy-quota",
  methods: {
    read: {
      input: { type: "object", properties: {}, additionalProperties: false },
      output: {
        type: "object",
        properties: {
          // `ok` is true whenever any reading was ever obtained; `stale` then
          // says whether the latest attempt to refresh it failed.
          ok: { type: "boolean" },
          stale: { type: "boolean" },
          // The answer came from the server's 30-second cache, so the numbers are
          // real but this call did not reach the upstream.
          cached: { type: "boolean" },
          ageSeconds: nullableNumber,
          remaining: nullableNumber,
          used: nullableNumber,
          total: nullableNumber,
          cycleStart: nullableString,
          cycleEnd: nullableString,
          resetAt: nullableString,
          // When the upstream call that produced these numbers succeeded.
          fetchedAt: nullableString,
          error: nullableString,
        },
        required: ["ok", "stale", "cached"],
        additionalProperties: false,
      },
    },
  },
  events: {},
})
