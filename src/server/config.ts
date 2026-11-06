import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

/** Keys the user may override; everything else in the file is ignored. */
export interface QuotaConfig {
  /** CodeBuddy model id → the id the models.dev catalog knows it by. */
  model_aliases: Record<string, string>
  /** CodeBuddy model id → the models.dev provider to take pricing from. */
  cost_providers: Record<string, string>
  /** Provider used when `cost_providers` has no entry (or its entry lacks the model). */
  default_cost_provider: string
  /** Models that must not be injected into OpenCode at all. */
  excluded_models: string[]
  /** Derive the provider from the model id prefix when `cost_providers` has no entry. */
  auto_prefix: boolean
}

/**
 * Mirrors `config.default.json`. The JSON file is documentation plus the
 * schema anchor; the constant is what runs, so nothing has to read a file at
 * plugin load time. A test asserts the two never drift apart.
 */
export const DEFAULT_CONFIG: QuotaConfig = {
  model_aliases: {
    hy4std: "hy4",
    hy4free: "hy4",
  },
  cost_providers: {
    "deepseek-v4.1-flash": "opencode",
    "deepseek-v4-pro": "opencode",
    "glm-5.3-flash": "zhipuai",
    "glm-5.3-flashx": "zhipuai",
    "minimax-m3.1-flash": "minimax-cn",
    "step-5-preview": "stepfun",
    "mimo-v2.6-pro": "xiaomi",
    hy4std: "tencent-tokenhub",
    hy4free: "tencent-tokenhub",
  },
  default_cost_provider: "opencode",
  excluded_models: ["space-bunny", "hy3", "hy3-x"],
  auto_prefix: true,
}

export const CONFIG_FILE_NAME = "codebuddy-quota.json"

/** `~/.config/opencode/codebuddy-quota.json`, beside the user's `opencode.jsonc`. */
export function configPath(home: string = homedir()): string {
  return join(home, ".config", "opencode", CONFIG_FILE_NAME)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** A string→string map; a single bad entry drops the whole field rather than half-applying it. */
function stringMap(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(value)) {
    if (typeof v !== "string" || v.length === 0) return undefined
    out[k] = v
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
 * The user file is layered over the defaults. The two map fields merge one
 * level deep, because a user who overrides a single provider should not have
 * to repeat the other eight; every other field replaces wholesale. A field
 * that fails validation silently keeps its default so one typo cannot take the
 * rest down. This function never throws — a broken config must not stop the
 * quota panel.
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

  const aliases = stringMap(parsed.model_aliases)
  const providers = stringMap(parsed.cost_providers)
  const excluded = stringList(parsed.excluded_models)
  const fallback =
    typeof parsed.default_cost_provider === "string" && parsed.default_cost_provider.length > 0
      ? parsed.default_cost_provider
      : undefined
  const autoPrefix = typeof parsed.auto_prefix === "boolean" ? parsed.auto_prefix : undefined

  return {
    model_aliases: aliases ? { ...DEFAULT_CONFIG.model_aliases, ...aliases } : DEFAULT_CONFIG.model_aliases,
    cost_providers: providers ? { ...DEFAULT_CONFIG.cost_providers, ...providers } : DEFAULT_CONFIG.cost_providers,
    default_cost_provider: fallback ?? DEFAULT_CONFIG.default_cost_provider,
    excluded_models: excluded ?? DEFAULT_CONFIG.excluded_models,
    auto_prefix: autoPrefix ?? DEFAULT_CONFIG.auto_prefix,
  }
}
