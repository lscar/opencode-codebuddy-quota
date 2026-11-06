import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

/** Where a CodeBuddy model lives in the models.dev catalog. */
export interface ModelMapping {
  /** models.dev provider id, e.g. `deepseek`, `zhipuai`, `tencent-tokenhub`. */
  provider: string
  /** The id the provider files the model under, which is not always CodeBuddy's. */
  model: string
}

/** Keys the user may override; everything else in the file is ignored. */
export interface QuotaConfig {
  /** CodeBuddy model id → its models.dev entry. A model absent here is never offered. */
  models: Record<string, ModelMapping>
  /** Hard block, applied on top of `models`: listed ids are dropped even when mapped. */
  excluded_models: string[]
  /**
   * The `@ai-sdk/openai-compatible` version to write when the npm lookup fails
   * or is unavailable. Ships as "the version this plugin was tested against", so
   * an offline start still produces a working config rather than a bare spec
   * OpenCode would resolve unpredictably.
   */
  package_version: string
}

/**
 * Mirrors `config.default.json`. The JSON file is documentation plus the
 * schema anchor; the constant is what runs, so nothing has to read a file at
 * plugin load time. A test asserts the two never drift apart.
 */
export const DEFAULT_CONFIG: QuotaConfig = {
  models: {
    "deepseek-v4-pro": { provider: "deepseek", model: "deepseek-v4-pro" },
    // CodeBuddy's revision of v4.1-flash is the vendor's plain v4-flash.
    "deepseek-v4.1-flash": { provider: "deepseek", model: "deepseek-v4-flash" },
    "glm-5.3-flash": { provider: "zhipuai", model: "glm-5.3-flash" },
    "glm-5.3-flashx": { provider: "zhipuai", model: "glm-5.3-flashx" },
    "minimax-m3.1-flash": { provider: "minimax-cn", model: "MiniMax-M3.1-Flash" },
    "step-5-preview": { provider: "stepfun", model: "step-5-preview" },
    "mimo-v2.6-pro": { provider: "xiaomi", model: "mimo-v2.6-pro" },
    hy4std: { provider: "tencent-tokenhub", model: "hy4" },
    hy4free: { provider: "tencent-tokenhub", model: "hy4" },
    hy3: { provider: "tencent-tokenhub", model: "hy3" },
    "hy3-x": { provider: "tencent-tokenhub", model: "hy3" },
    // Same model as minimax-m3.1-flash; CodeBuddy just bills it under its own id.
    "space-bunny": { provider: "minimax-cn", model: "MiniMax-M3.1-Flash" },
  },
  excluded_models: ["space-bunny", "hy3", "hy3-x"],
  package_version: "2.0.90",
}

export const CONFIG_FILE_NAME = "codebuddy-quota.json"

/** `~/.config/opencode/codebuddy-quota.json`, beside the user's `opencode.jsonc`. */
export function configPath(home: string = homedir()): string {
  return join(home, ".config", "opencode", CONFIG_FILE_NAME)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * `{ codebuddyId: { provider, model } }`. A single malformed entry drops the
 * whole field rather than half-applying it — a partially understood model list
 * is worse than the shipped one.
 */
function modelMap(value: unknown): Record<string, ModelMapping> | undefined {
  if (!isRecord(value)) return undefined
  const out: Record<string, ModelMapping> = {}
  for (const [id, entry] of Object.entries(value)) {
    if (id.length === 0 || !isRecord(entry)) return undefined
    const { provider, model } = entry as Record<string, unknown>
    if (typeof provider !== "string" || provider.length === 0) return undefined
    if (typeof model !== "string" || model.length === 0) return undefined
    out[id] = { provider, model }
  }
  return out
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: string[] = []
  for (const v of value) {
    if (typeof v !== "string" || v.length === 0) return undefined
    out.push(v)
  }
  return out
}

export interface LoadConfigDeps {
  configPath?: string
  readFile?: (path: string) => string
}

/**
 * The user file is layered over the defaults: `models` merges one level deep so
 * a user who adds a model does not have to repeat the twelve shipped ones, while
 * `excluded_models` replaces wholesale. A field that fails validation silently
 * keeps its default so one typo cannot take the rest down. This function never
 * throws — a broken config must not stop the quota panel.
 */
export function loadConfig(deps: LoadConfigDeps = {}): QuotaConfig {
  const path = deps.configPath ?? configPath()
  const read = deps.readFile ?? ((p: string) => readFileSync(p, "utf8"))

  let parsed: unknown
  try {
    parsed = JSON.parse(read(path))
  } catch {
    return DEFAULT_CONFIG
  }
  if (!isRecord(parsed)) return DEFAULT_CONFIG

  const models = modelMap(parsed.models)
  const excluded = stringList(parsed.excluded_models)
  const packageVersion =
    typeof parsed.package_version === "string" && parsed.package_version.trim().length > 0
      ? parsed.package_version.trim()
      : undefined

  return {
    models: models ? { ...DEFAULT_CONFIG.models, ...models } : DEFAULT_CONFIG.models,
    excluded_models: excluded ?? DEFAULT_CONFIG.excluded_models,
    package_version: packageVersion ?? DEFAULT_CONFIG.package_version,
  }
}
