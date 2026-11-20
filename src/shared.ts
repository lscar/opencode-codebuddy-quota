/** The two CodeBuddy sites. Pure type shared by server and GUI bundles. */
export type Site = "cn" | "intl"

/** A brief account identity sent to the GUI. Never carries a token. */
export interface AccountBrief {
  id: string
  label: string
}

/**
 * Per-site availability and account list for the quota dialog. `accounts` and
 * `activeId` are always 0/1 this term; the shape leaves room for future
 * multi-account switching without changing the RPC contract.
 */
export interface SiteInfo {
  site: Site
  available: boolean
  accounts: AccountBrief[]
  activeId: string | null
}
