/**
 * Everything needed to create the `codebuddy` provider from scratch.
 *
 * OpenCode ships no CodeBuddy provider of its own, so a fresh install has none
 * until the user writes one into `opencode.jsonc`. These constants let the
 * plugin stand in for that configuration when the user has an API key but no
 * provider.
 */

export const PROVIDER_ID = "codebuddy"

/** Must match the `x-ide-name`/User-Agent client the catalog endpoint expects. */
export const CLIENT_NAME = "deepseekharness"

/**
 * The `aisdk:` prefix is stripped by OpenCode, which then resolves the rest as
 * an npm specifier and caches it. Pin the version so a resolution change cannot
 * silently alter how requests are built.
 *
 * `apiKey` stays a `{env:...}` literal on purpose: OpenCode resolves it, so the
 * plugin never reads or holds the secret itself.
 */
export const PROVIDER_DEFAULT = {
  id: PROVIDER_ID,
  name: "CodeBuddy",
  package: "aisdk:@ai-sdk/openai-compatible@2.0.90",
  activation: "enabled",
  settings: {
    baseURL: "https://copilot.tencent.com/v2",
    apiKey: "{env:OPENCODE_CODEBUDDY_API_KEY}",
  },
  compatibility: {
    // This endpoint streams reasoning under `reasoning_content`, not `reasoning`.
    reasoningField: "reasoning_content",
  },
} as const

export const API_KEY_ENV = "OPENCODE_CODEBUDDY_API_KEY"
