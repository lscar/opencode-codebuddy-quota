import { PACKAGE_NAME, PACKAGE_PREFIX, isVersion, packageSpec } from "./package-spec"

/**
 * Looks up the newest `@ai-sdk/openai-compatible` build published under the
 * `ai-v6` dist-tag.
 *
 * OpenCode resolves a bare `@ai-sdk/*` spec through that tag, but it caches the
 * result under `<name>@<version>` and never re-resolves. Writing an explicit
 * version into the config is therefore the only way an upgrade takes effect,
 * which is why this exists rather than letting OpenCode follow the tag.
 */

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
    return isVersion(version) ? version : null
  } catch {
    return null
  }
}

/**
 * Rewrites the version inside an `aisdk:` provider package spec, or returns
 * null when the spec names some other package. A bare spec gains the version.
 */
export function withVersion(spec: string, version: string): string | null {
  const prefix = `${PACKAGE_PREFIX}${PACKAGE_NAME}`
  if (spec !== prefix && !spec.startsWith(`${prefix}@`)) return null
  return packageSpec(version)
}
