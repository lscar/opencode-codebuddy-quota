import type { CatalogModel } from "./catalog"
import type { QuotaConfig } from "./config"
import { resolveCost, vendorEfforts, type ModelCost, type ModelsDevCatalog } from "./pricing"

/**
 * Turns the CodeBuddy catalog into the shape a provider needs: models filtered
 * down to the ones the user mapped, priced, and renamed where two of them would
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

/**
 * One size for every model, regardless of what either the server or models.dev
 * declares. CodeBuddy bills the same credits per token whatever the model's
 * nominal window, so per-model limits only made the picker lie about capacity.
 */
const LIMIT = { context: 500_000, output: 64_000 } as const

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

  // A model the user has not mapped is not offered at all: without a models.dev
  // entry there is no price and no vendor reasoning table, and guessing either
  // would put a model in the picker that cannot be described correctly.
  const kept: CatalogModel[] = []
  for (const model of deps.catalog) {
    if (excluded.has(model.id)) continue
    if (!config.models[model.id]) {
      log(`${model.id} has no models entry in codebuddy-quota.json; not offered`)
      continue
    }
    kept.push(model)
  }

  const built = kept.map<ImportedModel>((model) => {
    const mapping = config.models[model.id]
    // Vendor levels win over whatever the gateway advertises. A model models.dev
    // knows nothing about keeps the server's levels rather than losing the
    // ability to reason at all.
    const vendor = vendorEfforts(mapping, modelsDev)
    const efforts = vendor ? vendor.efforts : model.efforts
    const defaultEffort = vendor
      ? // The vendor's own pick wins; without one, the gateway's if it exists in
        // the vendor table, else the heaviest level so a selection is valid.
        vendor.defaultEffort ??
        (vendor.efforts.includes(model.defaultEffort ?? "")
          ? model.defaultEffort
          : vendor.efforts[vendor.efforts.length - 1])
      : model.defaultEffort

    return {
      id: model.id,
      name: model.name,
      cost: resolveCost(model, mapping, modelsDev, log),
      limit: { context: LIMIT.context, output: LIMIT.output },
      imageInput: model.imageInput,
      efforts,
      defaultEffort,
    }
  })

  const credits = new Map(kept.map((model) => [model.id, model.credits]))
  // Sorted by id so the picker is stable no matter what order the server sends.
  const sorted = [...built].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return dedupeNames(sorted, credits)
}
