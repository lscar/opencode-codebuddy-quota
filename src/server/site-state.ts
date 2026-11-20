import type { AccountBrief, Site, SiteInfo } from "../shared"
import { activeAccount, type TokenCache } from "./token-store"

/** A site is available if it has a usable session and refresh has not just failed. */
const siteAvailable = (
  cache: TokenCache,
  site: Site,
  refreshFailed?: (site: Site) => boolean,
): boolean => {
  const auth = activeAccount(cache, site)
  if (!auth) return false
  const now = Date.now()
  // Usable if the access token is still valid, or the refresh token has not expired.
  if (!(now < auth.expiresAt || now < auth.refreshExpiresAt)) return false
  // A recent refresh failure means "needs login" — surface the login button
  // instead of looping on a session that keeps failing to refresh.
  if (refreshFailed?.(site)) return false
  return true
}

export function availableSites(
  cache: TokenCache,
  refreshFailed?: (site: Site) => boolean,
): Site[] {
  const sites: Site[] = ["cn", "intl"]
  return sites.filter((s) => siteAvailable(cache, s, refreshFailed))
}

export function currentSite(
  cache: TokenCache,
  refreshFailed?: (site: Site) => boolean,
): Site {
  const available = availableSites(cache, refreshFailed)
  if (available.includes(cache.selected)) return cache.selected
  if (available.length === 1) return available[0]
  return cache.selected
}

/** SiteInfo for the GUI: availability + account briefs (never tokens). */
export function siteInfo(
  cache: TokenCache,
  refreshFailed?: (site: Site) => boolean,
): { sites: SiteInfo[]; selected: Site } {
  const sites: SiteInfo[] = (["cn", "intl"] as Site[]).map((site) => {
    const account = activeAccount(cache, site)
    const accounts: AccountBrief[] = cache.accounts[site].map((a) => ({
      id: a.id,
      label: a.uid,
    }))
    return {
      site,
      available: siteAvailable(cache, site, refreshFailed),
      accounts,
      activeId: account?.id ?? null,
    }
  })
  return { sites, selected: currentSite(cache, refreshFailed) }
}
