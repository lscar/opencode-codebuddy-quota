import type { CatalogModel } from "./catalog"
import type { QuotaConfig } from "./config"
import { resolveCost, type ModelCost, type ModelsDevCatalog } from "./pricing"

/**
 * Turns the CodeBuddy catalog into the shape a provider needs: models filtered
 * by the user's exclusions, priced, and renamed where two of them would
 * otherwise be indistinguishable in a model picker.
 */

export interface ImportedModel {
  id: string
  name: string
  cost: ModelCost[]
  limit: { context: number; output: number }
  imageInput: boolean
  efforts: readonly string[]
  defaultEffort: string | null
}

export interface BuildModelsDeps {
  catalog: readonly CatalogModel[]
  config: QuotaConfig
  modelsDev: ModelsDevCatalog | null
  log: (message: string) => void
}

/** Fallbacks for a model that declares only one of its two capacity figures. */
const FALLBACK_CONTEXT = 262_144
const FALLBACK_OUTPUT = 32_768

/**
 * The catalog declares `Hy4` twice (free and standard) and `Hy3` twice. Only
 * where names collide *after* exclusions are applied does the credit factor get
 * appended, so a model that happens to be unique keeps its clean name.
 */
function dedupeNames(models: readonly ImportedModel[], credits: ReadonlyMap<string, number | null>): ImportedModel[] {
  const counts = new Map<string, number>()
  for (const model of models) counts.set(model.name, (counts.get(model.name) ?? 0) + 1)

  return models.map((model) => {
    if ((counts.get(model.name) ?? 0) < 2) return model

    const factor = credits.get(model.id)
    // Never render "Hy4(undefined)": an undeclared factor falls back to the id.
    const suffix = factor === null || factor === undefined ? model.id : `x${factor.toFixed(2)}`
    return { ...model, name: `${model.name}(${suffix})` }
  })
}

export function buildModels(deps: BuildModelsDeps): readonly ImportedModel[] {
  const { config, modelsDev, log } = deps
  const excluded = new Set(config.excluded_models)

  const kept = deps.catalog.filter((model) => !excluded.has(model.id))

  const built = kept.map<ImportedModel>((model) => ({
    id: model.id,
    name: model.name,
    cost: resolveCost(model, config, modelsDev, log),
    limit: {
      context: model.context ?? FALLBACK_CONTEXT,
      output: model.output ?? FALLBACK_OUTPUT,
    },
    imageInput: model.imageInput,
    efforts: model.efforts,
    defaultEffort: model.defaultEffort,
  }))

  const credits = new Map(kept.map((model) => [model.id, model.credits]))
  return dedupeNames(built, credits)
}
