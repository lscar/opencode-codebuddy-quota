import type { AccountBrief, Site, SiteInfo } from "../shared"
import { activeAccount, type TokenCache } from "./token-store"

/** A site is available if it has an active account whose session can still be used. */
const siteAvailable = (cache: TokenCache, site: Site): boolean => {
  const auth = activeAccount(cache, site)
  if (!auth) return false
  const now = Date.now()
  // Usable if the access token is still valid, or the refresh token has not expired.
  return now < auth.expiresAt || now < auth.refreshExpiresAt
}

export function availableSites(cache: TokenCache): Site[] {
  const sites: Site[] = ["cn", "intl"]
  return sites.filter((s) => siteAvailable(cache, s))
}

export function currentSite(cache: TokenCache): Site {
  const available = availableSites(cache)
  if (available.includes(cache.selected)) return cache.selected
  if (available.length === 1) return available[0]
  return cache.selected
}

/** SiteInfo for the GUI: availability + account briefs (never tokens). */
export function siteInfo(cache: TokenCache): { sites: SiteInfo[]; selected: Site } {
  const sites: SiteInfo[] = (["cn", "intl"] as Site[]).map((site) => {
    const account = activeAccount(cache, site)
    const accounts: AccountBrief[] = cache.accounts[site].map((a) => ({
      id: a.id,
      label: a.uid,
    }))
    return {
      site,
      available: siteAvailable(cache, site),
      accounts,
      activeId: account?.id ?? null,
    }
  })
  return { sites, selected: currentSite(cache) }
}
