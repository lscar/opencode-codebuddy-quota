import type { QuotaConfig } from "./config"

/**
 * Pricing for a CodeBuddy model, taken from the models.dev catalog that
 * OpenCode keeps locally. The catalog is looked up by provider *and* model id,
 * because the same model carries different prices depending on who resells it.
 */

export interface ModelsDevCost {
  text?: {
    input?: { price?: number; cache?: { read?: number; write?: number } }
    output?: { price?: number }
  }
}

export interface ModelsDevEntry {
  name?: string
  cost?: ModelsDevCost
  capabilities?: {
    reasoning?: {
      supported?: boolean
      toggle?: boolean
      /** Selectable reasoning levels, least to most. */
      effort?: readonly string[]
      /** The level the vendor picks when the caller names none. */
      default?: { type?: string; value?: string } | string
    }
  }
}

/** `{ [providerID]: { models: { [modelID]: entry } } }`, as stored under `models-dev:v2:catalog`. */
export type ModelsDevCatalog = Record<string, { models?: Record<string, ModelsDevEntry> }>

export interface ModelCost {
  input: number
  output: number
  cache: { read: number; write: number }
}

/** What `resolveCost` needs from a catalog model; keeps this module independent of `catalog.ts`. */
export interface PricedModel {
  id: string
  /** Credit multiplier. `0` means the model is free; `null` means the server did not say. */
  credits: number | null
}

/**
 * Model-id prefixes that identify the model's own vendor. Used only when
 * `cost_providers` has no entry for the model, so a newly added model still
 * gets a plausible price instead of none. Order matters: longer, more specific
 * prefixes come first.
 */
export const PREFIX_PROVIDERS: readonly (readonly [string, string])[] = [
  ["deepseek-", "opencode"],
  ["glm-", "zhipuai"],
  ["minimax-", "minimax-cn"],
  ["step-", "stepfun"],
  ["mimo-", "xiaomi"],
  ["kimi-", "moonshotai-cn"],
  ["hy4", "tencent-tokenhub"],
  ["hy3", "tencent-tokenhub"],
]

const ZERO_COST: ModelCost = { input: 0, output: 0, cache: { read: 0, write: 0 } }

/**
 * Exact id first, then a case-insensitive pass — the server writes
 * `minimax-m3.1-flash` while models.dev writes `MiniMax-M3.1-Flash`.
 *
 * Deliberately never prefix- or substring-matches: the catalog is full of
 * `-free` siblings (`step-5-preview-free`, `hy3-free`, …) that price at zero,
 * and a fuzzy match would silently report those instead of the paid model.
 */
export function findEntry(
  catalog: ModelsDevCatalog,
  provider: string,
  modelID: string,
): ModelsDevEntry | undefined {
  const models = catalog[provider]?.models
  if (!models) return undefined

  const exact = models[modelID]
  if (exact) return exact

  const lowered = modelID.toLowerCase()
  for (const [id, entry] of Object.entries(models)) {
    if (id.toLowerCase() === lowered) return entry
  }
  return undefined
}

/** Which catalog provider to price a model from, before checking whether it exists there. */
export function providerFor(id: string, config: QuotaConfig): string {
  const explicit = config.cost_providers[id]
  if (explicit) return explicit

  if (config.auto_prefix) {
    for (const [prefix, provider] of PREFIX_PROVIDERS) {
      if (id.startsWith(prefix)) return provider
    }
  }
  return config.default_cost_provider
}

function toCost(entry: ModelsDevEntry): ModelCost | null {
  const text = entry.cost?.text
  const input = text?.input?.price
  const output = text?.output?.price
  if (typeof input !== "number" || typeof output !== "number") return null
  return {
    input,
    output,
    // Most catalog entries omit cache.write; zero is the honest reading.
    cache: { read: text?.input?.cache?.read ?? 0, write: text?.input?.cache?.write ?? 0 },
  }
}

/**
 * Resolve a model's entry, returning `[]` when no price can be trusted — an
 * unpriced model is better than a wrong one. Every miss is reported through
 * `log` so a stale `cost_providers` entry is visible rather than silent.
 */
function findPricedEntry(
  model: PricedModel,
  config: QuotaConfig,
  catalog: ModelsDevCatalog | null,
  log: (message: string) => void,
): ModelsDevEntry | null {
  if (!catalog) {
    log(`models.dev catalog unavailable; ${model.id} stays unpriced`)
    return null
  }

  const modelID = config.model_aliases[model.id] ?? model.id
  const primary = providerFor(model.id, config)

  const direct = findEntry(catalog, primary, modelID)
  if (direct) {
    if (toCost(direct)) return direct
    log(`${primary}/${modelID} has no text pricing`)
  } else {
    log(`${primary} has no entry for ${modelID}`)
  }

  const fallback = config.default_cost_provider
  if (fallback !== primary) {
    const entry = findEntry(catalog, fallback, modelID)
    if (entry) {
      if (toCost(entry)) return entry
      log(`${fallback}/${modelID} has no text pricing`)
    } else {
      log(`${fallback} has no entry for ${modelID} either`)
    }
  }

  log(`no price for ${model.id}; leaving it unpriced`)
  return null
}

/**
 * The vendor's own reasoning levels for a model, or null when models.dev has
 * none. CodeBuddy's gateway rewrites some of these (it swaps `max` for `xhigh`
 * on `deepseek-v4-pro`, for instance), but the vendor table is what was asked
 * for, and a level the gateway rejects is a visible failure rather than a
 * silent one.
 */
export function vendorEfforts(
  model: PricedModel,
  config: QuotaConfig,
  catalog: ModelsDevCatalog | null,
): { efforts: string[]; toggle: boolean; defaultEffort: string | null } | null {
  if (!catalog) return null

  const modelID = config.model_aliases[model.id] ?? model.id
  const providers = [providerFor(model.id, config), config.default_cost_provider]
  for (const provider of providers) {
    const reasoning = findEntry(catalog, provider, modelID)?.capabilities?.reasoning
    if (reasoning?.effort && reasoning.effort.length > 0) {
      const declared =
        typeof reasoning.default === "string" ? reasoning.default : reasoning.default?.value ?? null
      return {
        efforts: [...reasoning.effort],
        toggle: reasoning.toggle === true,
        // Only honour a vendor default that is actually one of its levels.
        defaultEffort: declared && reasoning.effort.includes(declared) ? declared : null,
      }
    }
  }
  return null
}

export function resolveCost(
  model: PricedModel,
  config: QuotaConfig,
  catalog: ModelsDevCatalog | null,
  log: (message: string) => void,
): ModelCost[] {
  // Checked before any lookup: a free model needs no price, and looking one up
  // would contradict the credit factor the server reported.
  if (model.credits === 0) return [ZERO_COST]

  const entry = findPricedEntry(model, config, catalog, log)
  if (!entry) return []
  const cost = toCost(entry)
  return cost ? [cost] : []
}
