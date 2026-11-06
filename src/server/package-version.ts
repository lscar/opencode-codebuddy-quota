/**
 * Looks up the newest `@ai-sdk/openai-compatible` build published under the
 * `ai-v6` dist-tag.
 *
 * OpenCode pins nothing itself but caches whatever it resolved first, so a
 * version left implicit there never moves. Writing an explicit version into the
 * config is the only way an upgrade actually takes effect, which is why this
 * exists rather than letting OpenCode follow the tag.
 */

export const PACKAGE_NAME = "@ai-sdk/openai-compatible"
/** The dist-tag OpenCode's own `aisdk:` resolution points at. */
export const DIST_TAG = "ai-v6"
export const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}`

const DEFAULT_TIMEOUT_MS = 10_000

export interface LatestVersionDeps {
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

/** The version the tag points at, or null when the registry cannot be read. Never throws. */
export async function latestTaggedVersion(deps: LatestVersionDeps = {}): Promise<string | null> {
  const fetchImpl = deps.fetchImpl ?? fetch
  try {
    const response = await fetchImpl(REGISTRY_URL, {
      // The abbreviated doc is enough: it carries dist-tags and is far smaller.
      headers: { accept: "application/vnd.npm.install-v1+json" },
      signal: AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    })
    if (!response.ok) return null
    const body = (await response.json()) as { "dist-tags"?: Record<string, unknown> }
    const version = body?.["dist-tags"]?.[DIST_TAG]
    return typeof version === "string" && version.length > 0 ? version : null
  } catch {
    return null
  }
}

/** `aisdk:@ai-sdk/openai-compatible@2.0.90` → `2.0.90`; a spec with no version → null. */
export function versionInSpec(spec: string): string | null {
  const at = spec.lastIndexOf("@")
  // The leading "@" of a scoped name is not a version separator.
  if (at <= spec.lastIndexOf("/")) return null
  const version = spec.slice(at + 1)
  return version.length > 0 ? version : null
}

/**
 * Rewrites the version inside an `aisdk:` provider package spec.
 * Returns null when the spec names no `@ai-sdk/*` package we know how to version.
 */
export function withVersion(spec: string, version: string): string | null {
  const prefix = "aisdk:"
  if (!spec.startsWith(prefix)) return null
  const rest = spec.slice(prefix.length)
  if (!rest.startsWith(`${PACKAGE_NAME}@`) && rest !== PACKAGE_NAME) return null
  return `${prefix}${PACKAGE_NAME}@${version}`
}
