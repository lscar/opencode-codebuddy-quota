/**
 * CodeBuddy model catalog, read from `/v3/config`.
 *
 * The endpoint returns both a full model table and a per-agent allowlist. Only
 * the `cli` allowlist matters here: it carries exactly the models the current
 * API key may spend credits on, so a model that exists in the table but is
 * absent from the allowlist must not be offered.
 */

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
  context: number | null
  output: number | null
  imageInput: boolean
  /** Reasoning effort ids, ordered from least to most. Empty when the model does not reason. */
  efforts: readonly string[]
  defaultEffort: string | null
}

export interface FetchCatalogDeps {
  key: string
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

function positiveInt(...values: readonly unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value
  }
  return null
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
    if (reasoning.canDisableThinking !== false) efforts.unshift("off")
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
export function parseModelConfig(body: unknown): readonly CatalogModel[] {
  const data = (body as { data?: unknown })?.data as Record<string, unknown> | undefined
  if (!data) return []

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

  const out: CatalogModel[] = []
  for (const raw of allowed) {
    if (typeof raw !== "string") continue
    const model = byId.get(raw)
    if (!model) continue

    const context = positiveInt(model.maxInputTokens, model.maxAllowedSize)
    const output = positiveInt(model.maxOutputTokens)
    // A model with no declared capacity loses every limit the plugin needs, so it is dropped.
    if (context === null && output === null) continue

    const reasoning =
      model.supportsReasoning === true && model.reasoning !== null && typeof model.reasoning === "object"
        ? (model.reasoning as Record<string, unknown>)
        : null
    const { efforts, defaultEffort } = readEfforts(reasoning)

    out.push({
      id: raw,
      name: text(model.name) ?? raw,
      credits: shortCredits(model.credits),
      context,
      output,
      imageInput: model.supportsImages === true,
      efforts,
      defaultEffort,
    })
  }
  return out
}

/**
 * Fetch and parse the catalog for one API key. Throws on anything that would
 * make the returned list untrustworthy — including the silently-empty response,
 * whose error message names the `CLI/` marker so the cause is not a mystery.
 */
export async function fetchCatalog(deps: FetchCatalogDeps): Promise<readonly CatalogModel[]> {
  const key = deps.key.trim()
  if (!key) throw new Error(`${"OPENCODE_CODEBUDDY_API_KEY"} is not set`)

  const fetchImpl = deps.fetchImpl ?? fetch
  const timeout = AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const signal = deps.signal ? AbortSignal.any([deps.signal, timeout]) : timeout

  const response = await fetchImpl(CONFIG_URL, {
    method: "GET",
    headers: {
      accept: "application/json",
      "x-api-key": key,
      "user-agent": REQUEST_USER_AGENT,
      "x-product": PRODUCT_HEADER,
      "x-ide-name": CLIENT_NAME,
    },
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
