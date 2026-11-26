/**
 * CodeBuddy model catalog, read from `/v3/config`.
 *
 * The endpoint returns both a full model table and a per-agent allowlist. Only
 * the `cli` allowlist matters here: it carries exactly the models the current
 * API key may spend credits on, so a model that exists in the table but is
 * absent from the allowlist must not be offered.
 */

import type { Site } from "../shared"
import { apiHeaders } from "./headers"
import type { SiteAuth } from "./login"
import { anySignal, timeoutSignal } from "./signal"

export const CONFIG_URL = "https://copilot.tencent.com/v3/config"

/**
 * The client identity the endpoint keys on. `CLI/` must appear in the
 * User-Agent or the server answers HTTP 200 with a well-formed body that
 * simply omits `data.models` — an empty catalog that looks like success.
 * `CodeBuddy/<version>` must also parse, or the request is rejected outright.
 */
export const CLIENT_NAME = "deepseekharness"
export const CLI_UA_MARKER = "CLI/unknown"
export const CODEBUDDY_CLI_VERSION = "2.137.1"
export const REQUEST_USER_AGENT = `${CLIENT_NAME} ${CLI_UA_MARKER} CodeBuddy/${CODEBUDDY_CLI_VERSION}`
export const PRODUCT_HEADER = "SaaS"

const DEFAULT_TIMEOUT_MS = 15_000

export interface CatalogModel {
  id: string
  name: string
  /** Credit multiplier from `"x0.29 credits"` as `0.29`; null when the server did not declare one. */
  credits: number | null
  imageInput: boolean
  /** Reasoning effort ids, ordered from least to most. Empty when the model does not reason. */
  efforts: readonly string[]
  defaultEffort: string | null
}

export interface FetchCatalogDeps {
  site: Site
  auth: SiteAuth
  signal?: AbortSignal
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

/** Effort ids the catalog uses, least to most. Unknown ids sort after all of these. */
const EFFORT_RANK: Readonly<Record<string, number>> = {
  off: 0,
  minimal: 1,
  low: 2,
  medium: 3,
  high: 4,
  xhigh: 5,
  max: 6,
}
const UNKNOWN_EFFORT_RANK = Number.MAX_SAFE_INTEGER

/** The server does not guarantee ascending order, and downstream code relies on it. */
function sortEfforts(levels: readonly string[]): string[] {
  return levels
    .map((level, index) => ({ level, index }))
    .sort(
      (a, b) =>
        (EFFORT_RANK[a.level] ?? UNKNOWN_EFFORT_RANK) - (EFFORT_RANK[b.level] ?? UNKNOWN_EFFORT_RANK) ||
        a.index - b.index,
    )
    .map((entry) => entry.level)
}

/** `"x0.29 credits"` → `0.29`. A missing or unparseable value stays null. */
export function shortCredits(raw: unknown): number | null {
  if (typeof raw !== "string") return null
  const match = /x(\d+(?:\.\d+)?)/i.exec(raw)
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) ? value : null
}

/** True when any of the values is a positive integer, i.e. the model declares some capacity. */
function declaresCapacity(...values: readonly unknown[]): boolean {
  return values.some((value) => typeof value === "number" && Number.isSafeInteger(value) && value > 0)
}

function text(...values: readonly unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) return value
  }
  return null
}

/**
 * Two shapes the server uses for reasoning:
 * `{ supportedEfforts: [...], canDisableThinking, defaultEffort }` for a model
 * with selectable levels, and `{ effort: "high" }` for one locked to a single
 * level. `canDisableThinking: false` means no `off` level.
 */
function readEfforts(reasoning: Record<string, unknown> | null): { efforts: string[]; defaultEffort: string | null } {
  if (!reasoning) return { efforts: [], defaultEffort: null }

  const supported = Array.isArray(reasoning.supportedEfforts)
    ? (reasoning.supportedEfforts as unknown[]).filter((l): l is string => typeof l === "string" && l.length > 0)
    : []

  if (supported.length > 0) {
    const efforts = sortEfforts(supported)
    // Some servers list `off` among the supported efforts and also flag it via
    // `canDisableThinking`; the guard keeps it from shipping as two variants.
    if (reasoning.canDisableThinking !== false && !efforts.includes("off")) efforts.unshift("off")
    return { efforts, defaultEffort: text(reasoning.defaultEffort) }
  }

  const fixed = text(reasoning.effort)
  if (fixed) return { efforts: [fixed], defaultEffort: fixed }
  return { efforts: [], defaultEffort: null }
}

/**
 * Pure parser for the `/v3/config` body. Returns `[]` rather than throwing when
 * the body carries no models — deciding that emptiness is a failure is
 * `fetchCatalog`'s job, not this function's.
 */
/** ids a tier blocks for the current account (paywall tiers WorkBuddy hides). */
function paywallIds(data: Record<string, unknown>): Set<string> {
  const out = new Set<string>()
  if (!Array.isArray(data.modelTiers)) return out
  for (const tier of data.modelTiers as Array<Record<string, unknown>>) {
    if (tier?.accessMode !== "paywall" || !Array.isArray(tier.modelIds)) continue
    for (const id of tier.modelIds) if (typeof id === "string") out.add(id)
  }
  return out
}

/** ids carrying an active-looking promotion (WorkBuddy keeps the free/featured twin). */
function promotedIds(data: Record<string, unknown>): Set<string> {
  const out = new Set<string>()
  if (!Array.isArray(data.modelPromotions)) return out
  for (const promo of data.modelPromotions as Array<Record<string, unknown>>) {
    if (!Array.isArray(promo?.modelIds)) continue
    for (const id of promo.modelIds) if (typeof id === "string") out.add(id)
  }
  return out
}

export function parseModelConfig(body: unknown): readonly CatalogModel[] {
  const data = (body as { data?: unknown })?.data as Record<string, unknown> | undefined
  if (!data) return []

  // Pro-only filtering applies where the gateway sends tier metadata (intl).
  // Credit labels and free-vs-paid de-dup apply to every site: CN also ships a
  // promoted free twin ("Hy4 flash") alongside its paid id.
  const hasTiers = Array.isArray(data.modelTiers)
  const hasPromotions = Array.isArray(data.modelPromotions)
  const blocked = hasTiers ? paywallIds(data) : new Set<string>()
  const promoted = promotedIds(data)

  const agents = Array.isArray(data.agents)
    ? (data.agents as Array<Record<string, unknown>>)
    : Array.isArray((data.agent as { agents?: unknown })?.agents)
      ? ((data.agent as { agents: Array<Record<string, unknown>> }).agents)
      : []

  const cli = agents.find((agent) => agent?.name === "cli")
  const allowed = Array.isArray(cli?.models) ? (cli.models as unknown[]) : []
  if (allowed.length === 0) return []

  const byId = new Map<string, Record<string, unknown>>()
  if (Array.isArray(data.models)) {
    for (const model of data.models as Array<Record<string, unknown>>) {
      const id = text(model?.id)
      if (id) byId.set(id, model)
    }
  }

  const parsed: CatalogModel[] = []
  for (const raw of allowed) {
    if (typeof raw !== "string" || blocked.has(raw)) continue
    const model = byId.get(raw)
    if (!model) continue

    // A model that declares no capacity at all is not a usable model; the
    // figures themselves are not imported (see model-info's fixed limit).
    if (!declaresCapacity(model.maxInputTokens, model.maxAllowedSize, model.maxOutputTokens)) continue

    const reasoning =
      model.supportsReasoning === true && model.reasoning !== null && typeof model.reasoning === "object"
        ? (model.reasoning as Record<string, unknown>)
        : null
    const { efforts, defaultEffort } = readEfforts(reasoning)

    parsed.push({
      id: raw,
      name: text(model.name) ?? raw, // base name; credit suffix added after de-dup
      credits: shortCredits(model.credits),
      imageInput: model.supportsImages === true,
      efforts,
      defaultEffort,
    })
  }

  let result = parsed
  if (hasPromotions) {
    // Same display name (e.g. two "Hy4 flash" ids): WorkBuddy keeps the one with
    // an active promotion (the free trial) and drops the paid twin. Compare base
    // names; the credit suffix is appended after de-dup.
    const byName = new Map<string, CatalogModel>()
    for (const model of parsed) {
      const existing = byName.get(model.name)
      if (!existing) { byName.set(model.name, model); continue }
      const takeNew = promoted.has(model.id) && !promoted.has(existing.id)
      if (takeNew) byName.set(model.name, model)
    }
    result = [...byName.values()]
  }

  // WorkBuddy shows the credit multiplier in the picker; match its labels on
  // every site (CN and intl) so the provider mirrors what the client displays.
  return result.map((m) =>
    m.credits !== null ? { ...m, name: `${m.name}(x${m.credits.toFixed(2)})` } : m,
  )
}

/**
 * Fetch and parse the catalog for one API key. Throws on anything that would
 * make the returned list untrustworthy — including the silently-empty response,
 * whose error message names the `CLI/` marker so the cause is not a mystery.
 */
export async function fetchCatalog(deps: FetchCatalogDeps): Promise<readonly CatalogModel[]> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const timeout = timeoutSignal(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const signal = deps.signal ? anySignal([deps.signal, timeout]) : timeout
  const url = `${deps.auth.endpoint}/v3/config`

  const headers = apiHeaders(deps.auth, { accept: "application/json" })
  // The international gateway serves WorkBuddy's catalogue (with tier/promo
  // metadata) only when the caller identifies as the WorkBuddy IDE. Without
  // these headers it returns the narrower CLI catalogue with no Pro-only info.
  if (deps.site === "intl") {
    headers["x-ide-type"] = "WorkBuddy"
    headers["x-product"] = "WorkBuddy"
    headers["user-agent"] = "WorkBuddy/5.11.4"
  }
  const response = await fetchImpl(url, {
    method: "GET",
    headers,
    signal,
  })

  if (!response.ok) throw new Error(`catalog HTTP ${response.status}`)

  const body = (await response.json()) as { code?: number; msg?: string }
  if (body?.code !== 0) throw new Error(`catalog code ${body?.code}: ${body?.msg ?? "unknown"}`)

  const models = parseModelConfig(body)
  if (models.length === 0) {
    throw new Error(
      "catalog returned no CLI models — the request must carry a `CLI/` marker in its User-Agent",
    )
  }
  return models
}
