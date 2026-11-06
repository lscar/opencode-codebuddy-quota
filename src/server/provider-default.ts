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
 * The `@ai-sdk/openai-compatible` version this build was tested against. The
 * fallback when npm cannot be reached; `config.default.json` carries the same
 * value as `package_version`, and a test keeps the two equal.
 */
export const DEFAULT_PACKAGE_VERSION = "2.0.90"

/** `aisdk:`-prefixed spec for the given version. OpenCode strips the prefix. */
export function packageSpec(version: string): string {
  return `aisdk:@ai-sdk/openai-compatible@${version}`
}

/**
 * The provider block written when the user has no `codebuddy` provider yet.
 *
 * The `aisdk:` prefix is stripped by OpenCode, which then resolves the rest as
 * an npm specifier and caches it under `<name>@<version>`. Pinning the version
 * is what makes an upgrade take effect: a cached version is never re-checked.
 *
 * `apiKey` stays a `{env:...}` literal on purpose: OpenCode resolves it, so the
 * plugin never reads or holds the secret itself.
 */
export const PROVIDER_DEFAULT = {
  id: PROVIDER_ID,
  name: "CodeBuddy",
  package: packageSpec(DEFAULT_PACKAGE_VERSION),
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
