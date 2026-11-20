/**
 * The `@ai-sdk/openai-compatible` spec inside the user's `codebuddy` provider,
 * and validation for the versions that feed it.
 *
 * The provider block itself is the user's: it carries their endpoint, their key
 * reference and anything else they wrote. The plugin only owns the `package`
 * spec, whose version it keeps current.
 */

export const PROVIDER_ID = "codebuddy"

export const PACKAGE_PREFIX = "aisdk:"
export const PACKAGE_NAME = "@ai-sdk/openai-compatible"

/**
 * The version this build was tested against, used when npm cannot be reached.
 * `config.ts` seeds `package_version` with it, and `config.test.ts` keeps that,
 * `config.default.json` and this constant equal.
 */
export const DEFAULT_PACKAGE_VERSION = "2.0.90"

/** A published version and nothing else: `2.0.90`, `2.1.0-rc.1`, `2.1.0+build`. */
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

export function isVersion(value: unknown): value is string {
  return typeof value === "string" && VERSION_PATTERN.test(value)
}

/**
 * `aisdk:@ai-sdk/openai-compatible@2.0.90`. OpenCode strips the `aisdk:` prefix
 * and resolves the rest as an npm specifier, caching it under `<name>@<version>`
 * — which is why the version has to be spelled out and kept current.
 *
 * Throws on a non-version: this is the last point before the value becomes a
 * spec, and a stray file or empty string must never get this far.
 */
export function packageSpec(version: string): string {
  if (!isVersion(version)) throw new Error(`not a version: ${JSON.stringify(version)}`)
  return `${PACKAGE_PREFIX}${PACKAGE_NAME}@${version}`
}
