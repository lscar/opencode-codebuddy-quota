import type { Site } from "../shared"
import type { TokenStore } from "./token-store"
import { currentSite } from "./site-state"

/**
 * Decide which site a `read` should use. An explicit requested site becomes the
 * persisted selection, so a tag switch survives restart. A failed persist must
 * not fail the read — the caller still gets numbers for the requested site.
 */
export function resolveSite(
  store: Pick<TokenStore, "all" | "select">,
  requested: Site | undefined,
  onError?: (message: string) => void,
): Site {
  if (requested === "cn" || requested === "intl") {
    try {
      store.select(requested)
    } catch (error) {
      onError?.(`could not persist selected site: ${String((error as Error)?.message ?? error)}`)
    }
    return requested
  }
  return currentSite(store.all())
}
