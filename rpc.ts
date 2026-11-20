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

const siteEnum = { type: "string", enum: ["cn", "intl"] } as const
const siteInfoSchema = {
  type: "object",
  properties: {
    site: siteEnum,
    available: { type: "boolean" },
    accounts: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, label: { type: "string" } },
        required: ["id", "label"],
        additionalProperties: false,
      },
    },
    activeId: nullableString,
  },
  required: ["site", "available", "accounts", "activeId"],
  additionalProperties: false,
} as const

export const CodebuddyQuota = Rpc.define({
  id: "codebuddy-quota-v2",
  methods: {
    read: {
      input: {
        type: "object",
        properties: { site: siteEnum },
        additionalProperties: false,
      },
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
          // Which site these numbers belong to, and both sites' availability.
          site: siteEnum,
          sites: { type: "array", items: siteInfoSchema },
        },
        required: ["ok", "stale", "cached", "site", "sites"],
        additionalProperties: false,
      },
    },
    login: {
      input: {
        type: "object",
        properties: { site: siteEnum },
        required: ["site"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { ok: { type: "boolean" }, error: nullableString },
        required: ["ok", "error"],
        additionalProperties: false,
      },
    },
  },
  events: {},
})
