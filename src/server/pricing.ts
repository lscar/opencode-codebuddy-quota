import type { ModelMapping, QuotaConfig } from "./config"

/**
 * Pricing and reasoning levels for a CodeBuddy model, taken from the models.dev
 * catalog that OpenCode keeps locally.
 *
 * Every lookup goes through the user's `models` map: a model is only offered
 * because someone wrote down where it lives, so there is nothing to guess. The
 * same model carries different prices and levels depending on who resells it,
 * which is exactly why the mapping names the provider rather than inferring it.
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

/** What a lookup needs: the models.dev coordinates plus the credit multiplier. */
export interface PricedModel {
  id: string
  /** Credit multiplier. `0` means the model is free; `null` means the server did not say. */
  credits: number | null
}

const ZERO_COST: ModelCost = { input: 0, output: 0, cache: { read: 0, write: 0 } }

/** The models.dev entry a CodeBuddy model maps to, or undefined when unmapped or absent. */
export function mappingEntry(
  catalog: ModelsDevCatalog | null,
  mapping: ModelMapping | undefined,
): ModelsDevEntry | undefined {
  if (!catalog || !mapping) return undefined
  return catalog[mapping.provider]?.models?.[mapping.model]
}

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
 * Resolve a model's price, returning `[]` when no price can be trusted — an
 * unpriced model is better than a wrong one.
 */
export function resolveCost(
  model: PricedModel,
  mapping: ModelMapping | undefined,
  catalog: ModelsDevCatalog | null,
  log: (message: string) => void,
): ModelCost[] {
  // Checked before any lookup: a free model needs no price, and looking one up
  // would contradict the credit factor the server reported.
  if (model.credits === 0) return [ZERO_COST]

  if (!catalog) {
    log(`models.dev catalog unavailable; ${model.id} stays unpriced`)
    return []
  }
  if (!mapping) {
    log(`${model.id} has no models.dev mapping; leaving it unpriced`)
    return []
  }

  const entry = findEntry(catalog, mapping.provider, mapping.model)
  if (!entry) {
    log(`${mapping.provider} has no entry for ${mapping.model} (${model.id}); leaving it unpriced`)
    return []
  }
  const cost = toCost(entry)
  if (!cost) {
    log(`${mapping.provider}/${mapping.model} has no text pricing; ${model.id} stays unpriced`)
    return []
  }
  return [cost]
}

/**
 * The vendor's own reasoning levels for a model, or null when models.dev has
 * none for it. CodeBuddy's gateway rewrites some of these (it swaps `max` for
 * `xhigh` on `deepseek-v4-pro`, for instance), but the vendor table is the
 * source of record here.
 */
export function vendorEfforts(
  mapping: ModelMapping | undefined,
  catalog: ModelsDevCatalog | null,
): { efforts: string[]; toggle: boolean; defaultEffort: string | null } | null {
  const reasoning = mappingEntry(catalog, mapping)?.capabilities?.reasoning
  const efforts = reasoning?.effort
  if (!efforts || efforts.length === 0) return null

  const declared = typeof reasoning.default === "string" ? reasoning.default : reasoning.default?.value ?? null
  return {
    efforts: [...efforts],
    toggle: reasoning.toggle === true,
    // Only honour a vendor default that is actually one of its levels.
    defaultEffort: declared && efforts.includes(declared) ? declared : null,
  }
}
