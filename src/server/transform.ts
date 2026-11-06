import { Model, Provider, type Plugin } from "@opencode/plugin"
import type { ImportedModel } from "./model-info"
import { API_KEY_ENV, PROVIDER_DEFAULT, PROVIDER_ID } from "./provider-default"

/**
 * The provider-editor surface this module needs, derived from the real plugin
 * context so a change in OpenCode's own types breaks compilation here instead
 * of silently drifting.
 */
type Context = Parameters<NonNullable<Plugin.Plugin["setup"]>>[0]
type RealEditor = Parameters<Parameters<Context["provider"]["transform"]>[0]>[0]
export type ProviderEditorLike = Pick<RealEditor, "get" | "add" | "models">

export interface TransformDeps {
  loadModels: () => Promise<readonly ImportedModel[]>
  env?: Record<string, string | undefined>
  log: (message: string) => void
  providerDefault?: typeof PROVIDER_DEFAULT
}

/**
 * `ImportedModel` → `Model.Info`.
 *
 * The extra fields are not decoration: OpenCode decides which models it may
 * offer, and how it bills them, from `status`, `enabled`, `variants` and
 * `time`. A model that reaches the editor without them is silently treated as
 * something else.
 */
export function toModelInfo(model: ImportedModel): Model.Info {
  return {
    id: Model.ID.make(model.id),
    modelID: Model.ID.make(model.id),
    providerID: Provider.ID.make(PROVIDER_ID),
    name: model.name,
    capabilities: {
      tools: true,
      input: model.imageInput ? ["text", "image"] : ["text"],
      output: ["text"],
    },
    limit: {
      context: model.limit.context,
      output: model.limit.output,
    },
    cost: model.cost.map((entry) => ({
      input: toMoney(entry.input),
      output: toMoney(entry.output),
      cache: { read: toMoney(entry.cache.read), write: toMoney(entry.cache.write) },
    })),
    // One variant per selectable reasoning level; the variant id is the level
    // the endpoint expects back. A model with no declared levels gets none.
    variants: model.efforts.map((effort) => ({
      id: Model.VariantID.make(effort),
      settings: effort === "off" ? {} : { reasoningEffort: effort },
    })),
    time: { released: 0 },
    status: "active" as const,
    enabled: true,
  }
}

/** `Money.USDPerMillionTokens` is a branded number; the brand carries no runtime behaviour. */
function toMoney(value: number) {
  return value as Model.Cost["input"]
}

/**
 * What the provider list should look like once the plugin has run.
 *
 * Two cases, because a model list is useless without a provider to hang it on:
 *  - the provider already exists (the user configured it): only its models are
 *    replaced. Its package, endpoint and credential are the user's business.
 *  - it does not exist: created whole, but only when an API key is present.
 *    Without one the provider would be non-functional, so nothing is added.
 *
 * `add` is used rather than `update` in the second case specifically because
 * `update` would overwrite a configuration the user wrote.
 *
 * This function never throws: OpenCode disables an entire plugin whose
 * transform fails, which would take the quota panel down with it.
 */
export function createModelTransform(
  deps: TransformDeps,
): (editor: ProviderEditorLike) => Promise<void> {
  const env = deps.env ?? process.env
  const info = deps.providerDefault ?? PROVIDER_DEFAULT

  return async (editor: ProviderEditorLike) => {
    try {
      const loaded = await deps.loadModels()
      // An empty result means the catalog call failed or returned nothing
      // usable. Writing it would wipe the user's models for no reason.
      if (loaded.length === 0) return

      const models = loaded.map(toModelInfo)

      if (editor.get(PROVIDER_ID)) {
        editor.models.set(PROVIDER_ID, models)
        return
      }

      const key = (env[API_KEY_ENV] ?? "").trim()
      if (!key) {
        deps.log(`no ${PROVIDER_ID} provider configured and ${API_KEY_ENV} is unset; skipping model import`)
        return
      }

      editor.add({
        info: {
          ...info,
          id: Provider.ID.make(info.id),
        },
        models,
      })
    } catch (error) {
      deps.log(`model import failed: ${String((error as Error)?.message ?? error)}`)
    }
  }
}
