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

/**
 * The international gateway verifies the full official-CLI header set on every
 * chat request. CodeBuddy CN is not gated; only intl needs these. The
 * X-Conversation-* family is mandatory — any subset is rejected with 11128.
 */
export function channelHeaders(): Record<string, string> {
  const messageId = randomBytes(16).toString("hex")
  return {
    "x-app": "cli",
    "x-ide-type": "CLI",
    "x-ide-name": "CLI",
    "x-ide-version": CLI_VERSION,
    "x-private-data": "false",
    "x-agent-intent": "craft",
    "x-agent-purpose": "conversation",
    "x-conversation-id": randomBytes(16).toString("hex"),
    // The official client mirrors the request id from the message id.
    "x-request-id": messageId,
    "x-conversation-request-id": messageId,
    "x-conversation-message-id": messageId,
  }
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
