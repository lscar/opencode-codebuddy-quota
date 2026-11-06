import { readFileSync, writeFileSync } from "node:fs"
import type { ImportedModel } from "./model-info"
import { withVersion } from "./package-version"
import { PROVIDER_ID } from "./provider-default"

/**
 * Writes the imported model list into the user's `opencode.jsonc`.
 *
 * Why the config file and not `ctx.provider.transform`: in OpenCode 2.2.5 the
 * provider records handed to a transform are already frozen — every write path
 * (`add`, `models.set`, `update`) throws `Attempted to assign to readonly
 * property`. The config file is read before providers are resolved, so it is
 * the only place a plugin can add models that actually reach the model picker.
 *
 * The file is JSONC, so this edits text rather than re-serializing: comments and
 * key order survive, and an unrelated field is never reformatted. Failure to
 * parse means the file is left untouched.
 */

export interface WriteModelsDeps {
  jsoncPath: string
  models: readonly ImportedModel[]
  /** When set, the provider's `package` version is moved to this value. */
  packageVersion?: string | null
  readFile?: (path: string) => string
  writeFile?: (path: string, content: string) => void
  /** Called with the original text right before it is replaced. */
  backup?: (path: string, content: string) => void
}

export interface WriteModelsResult {
  written: boolean
  /** Why nothing was written; absent when `written` is true. */
  reason?: string
  /** True when the text handed to `writeFile` differs from the text read. */
  changed?: boolean
}

/** Strips `//` and leading-`*` comments plus trailing commas, so `JSON.parse` can read the text. */
export function stripComments(text: string): string {
  let out = ""
  let inString = false
  let inLine = false
  let inBlock = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const next = text[i + 1]

    if (inLine) {
      if (ch === "\n") {
        inLine = false
        out += ch
      }
      continue
    }
    if (inBlock) {
      if (ch === "*" && next === "/") {
        inBlock = false
        i++
      }
      continue
    }
    if (inString) {
      out += ch
      if (ch === "\\") {
        out += next ?? ""
        i++
      } else if (ch === "\"") {
        inString = false
      }
      continue
    }
    if (ch === "\"") {
      inString = true
      out += ch
      continue
    }
    if (ch === "/" && next === "/") {
      inLine = true
      i++
      continue
    }
    if (ch === "/" && next === "*") {
      inBlock = true
      i++
      continue
    }
    out += ch
  }

  // Trailing commas before a closing brace/bracket are legal in JSONC only.
  return out.replace(/,(\s*[}\]])/g, "$1")
}

/** A model as it must appear in `opencode.jsonc`, matching the existing hand-written entries. */
export function toConfigModel(model: ImportedModel): Record<string, unknown> {
  const cost = model.cost[0]
  const entry: Record<string, unknown> = {
    name: model.name,
    capabilities: {
      tools: true,
      input: model.imageInput ? ["text", "image"] : ["text"],
      output: ["text"],
    },
    limit: { context: model.limit.context, output: model.limit.output },
  }

  if (cost) {
    entry.cost = {
      input: cost.input,
      output: cost.output,
      cache: { read: cost.cache.read, write: cost.cache.write },
    }
  }

  const variants = model.efforts.map((effort) => ({
    id: effort,
    settings: effort === "off" ? {} : { reasoningEffort: effort },
  }))
  if (variants.length > 0) {
    entry.variants = variants
    entry.settings = { reasoningEffort: model.defaultEffort ?? model.efforts[model.efforts.length - 1] }
  }

  return entry
}

/**
 * Serializes one property value on a single line: `{ ... }` with spaces inside
 * the braces and `[a, b]` for arrays, which is how these config files are
 * normally hand-written. Keeping it compact matters — a fully expanded entry
 * costs ~40 lines, so ten models would turn a 190-line file into 500.
 */
function compactJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(compactJson).join(", ")}]`
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return "{}"
    return `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${compactJson(v)}`).join(", ")} }`
  }
  return JSON.stringify(value)
}

function indentOf(text: string, at: number): string {
  const lineStart = text.lastIndexOf("\n", at) + 1
  const prefix = text.slice(lineStart, at)
  const match = /^[ \t]*/.exec(prefix)
  return match ? match[0] : "  "
}

/**
 * Brings `providers.codebuddy` in line with what the plugin computed: the
 * `models` block is replaced, and the provider `package` version is moved
 * forward when a newer one was found.
 *
 * The whole block is compared by content, not just by the set of model ids, so
 * a price or reasoning-level change from models.dev also lands. Nothing is
 * written when the rendered text already matches what is on disk.
 *
 * Returns `written: false` on any malformed input rather than risk corrupting
 * the user's configuration.
 */
export function writeModels(deps: WriteModelsDeps): WriteModelsResult {
  const read = deps.readFile ?? ((p: string) => readFileSync(p, "utf8"))
  const write = deps.writeFile ?? ((p: string, c: string) => writeFileSync(p, c, "utf8"))

  let original: string
  try {
    original = read(deps.jsoncPath)
  } catch {
    return { written: false, reason: "config file could not be read" }
  }

  let existing: unknown
  try {
    existing = JSON.parse(stripComments(original))
  } catch {
    return { written: false, reason: "config file is not valid JSON/JSONC" }
  }

  const root = existing as Record<string, unknown>
  if (typeof root !== "object" || root === null || Array.isArray(root)) {
    return { written: false, reason: "config root is not an object" }
  }

  const modelsById: Record<string, unknown> = {}
  for (const model of deps.models) modelsById[model.id] = toConfigModel(model)

  const modelsRange = locateModelsBlock(original)
  if (!modelsRange) {
    return { written: false, reason: `could not locate providers.${PROVIDER_ID}.models in the config text` }
  }

  const indent = `${indentOf(original, modelsRange.open)}  `
  const members = Object.entries(modelsById)
    .map(([id, value]) => `${indent}${JSON.stringify(id)}: ${compactJson(value)}`)
    .join(",\n")
  const body = members ? `\n${members}\n${indentOf(original, modelsRange.open)}` : ""
  let next = `${original.slice(0, modelsRange.open + 1)}${body}${original.slice(modelsRange.close)}`

  if (deps.packageVersion) {
    next = retargetPackage(next, deps.packageVersion)
  }

  if (next === original) return { written: true, changed: false }

  deps.backup?.(deps.jsoncPath, original)
  write(deps.jsoncPath, next)
  return { written: true, changed: true }
}

/**
 * Retargets the `package` inside `providers.codebuddy` to `version`, leaving a
 * spec that is not one of our known `@ai-sdk/*` packages untouched.
 */
function retargetPackage(text: string, version: string): string {
  const bare = stripComments(text)
  const providerAt = bare.indexOf(`"${PROVIDER_ID}"`)
  if (providerAt < 0) return text

  const after = bare.slice(providerAt)
  const match = /"package"\s*:\s*"([^"]*)"/.exec(after)
  if (!match) return text

  const replacement = withVersion(match[1], version)
  if (!replacement || replacement === match[1]) return text

  const start = providerAt + match.index
  return `${text.slice(0, start)}${JSON.stringify("package")}: ${JSON.stringify(replacement)}${text.slice(start + match[0].length)}`
}

/**
 * Finds the `{`/`}` of the models object. Searches for `"models"` only after the
 * `"codebuddy"` provider block, so an unrelated provider's models are never hit.
 */
function locateModelsBlock(text: string): { open: number; close: number } | null {
  const bare = stripComments(text)
  const providerNeedle = `"${PROVIDER_ID}"`
  const providerAt = bare.indexOf(providerNeedle)
  if (providerAt < 0) return null

  const after = bare.slice(providerAt)
  const modelsMatch = /"models"\s*:\s*\{/.exec(after)
  if (!modelsMatch) return null

  const open = providerAt + modelsMatch.index + modelsMatch[0].length - 1
  let depth = 0
  let inString = false
  for (let i = open; i < bare.length; i++) {
    const ch = bare[i]
    if (inString) {
      if (ch === "\\") i++
      else if (ch === "\"") inString = false
      continue
    }
    if (ch === "\"") {
      inString = true
      continue
    }
    if (ch === "{") depth++
    else if (ch === "}") {
      depth--
      if (depth === 0) return { open, close: i }
    }
  }
  return null
}
