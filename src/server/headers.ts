import { randomBytes } from "node:crypto"
import type { SiteAuth } from "./login"

export const CLI_VERSION = "2.185.0"
export const USER_AGENT = `CLI/${CLI_VERSION} CodeBuddy/${CLI_VERSION}`

const hostOf = (endpoint: string): string => {
  try {
    return new URL(endpoint).host
  } catch {
    return endpoint
  }
}

const newRequestId = (): string => randomBytes(16).toString("hex")

/**
 * Headers for config/chat/usage calls. `x-domain` is the endpoint host the
 * request actually hits — never the realm/login domain, which triggers 12403.
 */
export function apiHeaders(
  auth: SiteAuth,
  opts: { requestId?: string; accept?: string } = {},
): Record<string, string> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${auth.accessToken}`,
    "user-agent": USER_AGENT,
    "x-domain": hostOf(auth.endpoint),
    "x-product": "SaaS",
    "x-request-id": opts.requestId ?? newRequestId(),
    "x-user-id": auth.uid,
  }
  if (auth.enterpriseId) headers["x-enterprise-id"] = auth.enterpriseId
  if (opts.accept) headers.Accept = opts.accept
  return headers
}

/** Headers for the proprietary token-refresh endpoint; no bearer token. */
export function refreshHeaders(auth: SiteAuth): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Refresh-Token": auth.refreshToken,
    "X-Auth-Refresh-Source": "plugin",
    "Content-Type": "application/json",
    Accept: "application/json",
    "user-agent": USER_AGENT,
  }
  if (auth.enterpriseId) headers["x-enterprise-id"] = auth.enterpriseId
  return headers
}
