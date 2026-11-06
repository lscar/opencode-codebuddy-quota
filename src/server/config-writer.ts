import { readFileSync, writeFileSync } from "node:fs"
import type { ImportedModel } from "./model-info"
import { withVersion } from "./package-version"
import { isVersion, packageSpec, PROVIDER_ID } from "./package-spec"

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

/**
 * Three outcomes, not two booleans: the file was rewritten, it already matched
 * (so nothing was touched), or it was left alone because something about it
 * could not be understood.
 */
export type WriteModelsResult =
  | {
      status: "written"
      /** The `package` version moved. False when it already matched or was not a version. */
      packageUpdated: boolean
      /**
       * Set when a `package` key exists but updating it failed — the models still
       * land, but the caller should say why the version did not move.
       */
      packageWarning?: string
    }
  | { status: "unchanged" }
  | { status: "skipped"; reason: string }

/**
 * Blanks `//` and leading-`*` comments plus trailing commas, so `JSON.parse`
 * can read the text.
 *
 * Deleted characters are replaced by spaces rather than removed: every caller
 * splices the original text using offsets taken from this result, and a changed
 * length would silently cut a different span. Newlines survive so line offsets
 * and error messages stay meaningful.
 */
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
        out += "\n"
      } else {
        out += " "
      }
      continue
    }
    if (inBlock) {
      if (ch === "*" && next === "/") {
        inBlock = false
        out += "  "
        i++
      } else {
        out += ch === "\n" ? "\n" : " "
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
      out += "  "
      i++
      continue
    }
    if (ch === "/" && next === "*") {
      inBlock = true
      out += "  "
      i++
      continue
    }
    out += ch
  }

  return blankTrailingCommas(out)
}

/** JSONC allows a comma before a closing brace/bracket; JSON does not. */
function blankTrailingCommas(text: string): string {
  // Code units, not code points: the caller relies on a 1:1 index mapping back
  // into `text`, which a `[...text]` spread would break for astral characters.
  const chars = text.split("")
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (ch === "\\") i++
      else if (ch === "\"") inString = false
      continue
    }
    if (ch === "\"") {
      inString = true
      continue
    }
    if (ch !== ",") continue
    // Only a comma whose next non-space character closes a container is trailing.
    let j = i + 1
    while (j < text.length && /\s/.test(text[j])) j++
    if (j < text.length && (text[j] === "}" || text[j] === "]")) chars[i] = " "
  }
  return chars.join("")
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

/** The line ending the file actually uses, so a rewritten block does not mix them. */
function newlineOf(text: string): string {
  return text.includes("\r\n") ? "\r\n" : "\n"
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
 * Any malformed input ends in `skipped` rather than risk corrupting the user's
 * configuration.
 */
export function writeModels(deps: WriteModelsDeps): WriteModelsResult {
  const read = deps.readFile ?? ((p: string) => readFileSync(p, "utf8"))
  const write = deps.writeFile ?? ((p: string, c: string) => writeFileSync(p, c, "utf8"))

  let original: string
  try {
    original = read(deps.jsoncPath)
  } catch {
    return { status: "skipped", reason: "config file could not be read" }
  }

  const bare = stripComments(original)
  if (!isJsonObject(bare)) {
    return { status: "skipped", reason: "config file is not valid JSON/JSONC" }
  }

  const provider = locateProvider(bare)
  if (!provider) {
    return { status: "skipped", reason: `could not locate providers.${PROVIDER_ID} in the config text` }
  }
  const modelsRange = locateModelsBlock(bare, provider)
  if (!modelsRange) {
    return { status: "skipped", reason: `could not locate providers.${PROVIDER_ID}.models in the config text` }
  }

  const modelsById: Record<string, unknown> = {}
  for (const model of deps.models) modelsById[model.id] = toConfigModel(model)

  const modelsIndent = indentOf(original, modelsRange.open)
  const eol = newlineOf(original)
  const members = Object.entries(modelsById)
    .map(([id, value]) => `${modelsIndent}  ${JSON.stringify(id)}: ${compactJson(value)}`)
    .join(`,${eol}`)
  const body = members ? `${eol}${members}${eol}${modelsIndent}` : ""
  let next = `${original.slice(0, modelsRange.open + 1)}${body}${original.slice(modelsRange.close)}`

  // A version that is not a version (a whole file, an empty string, a URL) is
  // never written into the `package` spec; the models still land.
  const packageVersion = isVersion(deps.packageVersion) ? deps.packageVersion : null
  let packageUpdated = false
  let packageWarning: string | undefined
  if (packageVersion) {
    const retargeted = retargetPackage({ text: next, provider, version: packageVersion })
    next = retargeted.text
    packageUpdated = retargeted.applied
    packageWarning = retargeted.problem
  }

  if (next === original) return { status: "unchanged" }

  // Last gate before touching the user's file: a splice that landed on the
  // wrong offset produces text that no longer parses, and writing that would
  // destroy the config. Refuse instead. Comments are still in `next`, so it is
  // parsed the same way the input was.
  const rendered = parseJsonc(next)
  if (!rendered) {
    return { status: "skipped", reason: "rendered config would not parse; refusing to write" }
  }
  const renderedProvider = (rendered as { providers?: Record<string, unknown> }).providers?.[PROVIDER_ID] as
    | { models?: unknown; package?: unknown }
    | undefined
  const renderedIds = Object.keys((renderedProvider?.models as Record<string, unknown>) ?? {})
  if (renderedIds.join("\u0000") !== Object.keys(modelsById).join("\u0000")) {
    return { status: "skipped", reason: "model block did not land under the expected provider; refusing to write" }
  }
  if (packageVersion) {
    const expected = packageSpec(packageVersion)
    if (renderedProvider?.package !== undefined && renderedProvider.package !== expected && !packageWarning) {
      return { status: "skipped", reason: `package is ${JSON.stringify(renderedProvider.package)} after the rewrite; refusing to write` }
    }
  }

  deps.backup?.(deps.jsoncPath, original)
  write(deps.jsoncPath, next)
  return packageWarning
    ? { status: "written", packageUpdated, packageWarning }
    : { status: "written", packageUpdated }
}

function isJsonObject(text: string): boolean {
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === "object" && value !== null && !Array.isArray(value)
  } catch {
    return false
  }
}

/** The config as a value, comments and trailing commas tolerated. Null if it is not parseable. */
function parseJsonc(text: string): unknown | null {
  try {
    return JSON.parse(stripComments(text))
  } catch {
    return null
  }
}

/** Offsets of an object literal, `open` being its `{` and `close` its matching `}`. */
interface ObjectRange {
  open: number
  close: number
}

/**
 * Finds `providers.<PROVIDER_ID>`, walking the structure instead of searching
 * for the first `"codebuddy"`: that literal also appears inside other
 * providers' string values, and splicing there would drop the models into the
 * wrong provider.
 */
function locateProvider(bare: string): ObjectRange | null {
  const root = objectAt(bare, skipSpace(bare, 0))
  if (!root) return null
  const providers = memberObject(bare, root.open, "providers")
  return providers && memberObject(bare, providers.open, PROVIDER_ID)
}

/**
 * Finds the `{`/`}` of the provider's models object. Duplicate keys are
 * refused: text-level editing cannot tell which copy the parser would read, so
 * a wrong guess would edit the one that is never used.
 */
function locateModelsBlock(bare: string, provider: ObjectRange): ObjectRange | null {
  return memberObject(bare, provider.open, "models")
}

/**
 * Retargets the `package` directly under `providers.codebuddy` to `version`.
 *
 * Only that level is searched, so a `"package"` nested in `settings` or any
 * other sibling is never touched. `problem` explains a rewrite that was wanted
 * but could not be made, so the caller can say so instead of silently leaving
 * the version behind.
 */
function retargetPackage(deps: {
  text: string
  provider: ObjectRange
  version: string
}): { text: string; applied: boolean; problem?: string } {
  const { text, provider } = deps
  const bare = stripComments(text)

  const member = findMember(bare, provider.open, "package")
  if (!member) return { text, applied: false, problem: "no package key in this provider" }

  const spec = scalarAt(bare, member.valueAt)
  if (!spec?.[0].startsWith('"')) return { text, applied: false, problem: "package is not a string" }

  const current = JSON.parse(spec[0]) as string
  const replacement = withVersion(current, deps.version)
  if (!replacement) {
    return { text, applied: false, problem: `package ${JSON.stringify(current)} is not a known @ai-sdk spec` }
  }
  if (current === replacement) return { text, applied: false }

  return {
    text: `${text.slice(0, member.valueAt)}${JSON.stringify(replacement)}${text.slice(member.valueAt + spec[0].length)}`,
    applied: true,
  }
}

function skipSpace(text: string, at: number): number {
  let i = at
  while (i < text.length && " \t\n\r".includes(text[i])) i++
  return i
}

/** The end of the JSON string starting at `at` (just past the closing quote), or -1. */
function stringEnd(text: string, at: number): number {
  let i = at + 1
  while (i < text.length) {
    if (text[i] === "\\") i += 2
    else if (text[i] === '"') return i + 1
    else i++
  }
  return -1
}

/** Just past a number or literal starting at `at`, or -1. */
function scalarEnd(text: string, at: number): number {
  if (text[at] === '"') return stringEnd(text, at)
  let i = at
  while (i < text.length && !",}] \t\n\r".includes(text[i])) i++
  return i === at ? -1 : i
}

function scalarAt(text: string, at: number): [string, number] | null {
  const end = scalarEnd(text, at)
  return end < 0 ? null : [text.slice(at, end), end]
}

/**
 * The closing offset of the container opening at `at`, skipping nested
 * containers and strings. [close, next] where `next` is just past the container.
 */
function containerEnd(text: string, at: number): [number, number] | null {
  const open = text[at]
  const close = open === "{" ? "}" : open === "[" ? "]" : null
  if (!close) return null
  let depth = 0
  for (let i = at; i < text.length; ) {
    const ch = text[i]
    if (ch === '"') {
      const end = stringEnd(text, i)
      if (end < 0) return null
      i = end
      continue
    }
    if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) return [i, i + 1]
    }
    i++
  }
  return null
}

/** Just past whatever value starts at `at`: a string, a number/literal, an `{}` or a `[]`. */
function valueEnd(text: string, at: number): number {
  const container = containerEnd(text, at)
  return container ? container[1] : scalarEnd(text, at)
}

/** The `{`/`}` of the object starting at `at`. */
function objectAt(text: string, at: number): ObjectRange | null {
  const end = text[at] === "{" ? containerEnd(text, at) : null
  return end ? { open: at, close: end[0] } : null
}

/** A top-level member of the object literal whose `{` is at `at`. */
interface Member {
  /** Where the member's value starts. */
  valueAt: number
  /** True when that value is an object, for callers that need the braces. */
  isObject: boolean
}

/** Walks the object literal at `at` and returns its member named `key`, or null. */
function findMember(text: string, at: number, key: string): Member | null {
  const body = objectAt(text, at)
  if (!body) return null
  let i = skipSpace(text, body.open + 1)
  while (i < body.close && text[i] === '"') {
    const keyEnd = stringEnd(text, i)
    if (keyEnd < 0) return null
    const colon = skipSpace(text, keyEnd)
    if (text[colon] !== ":") return null
    const valueAt = skipSpace(text, colon + 1)
    if (JSON.parse(text.slice(i, keyEnd)) === key) {
      return { valueAt, isObject: text[valueAt] === "{" }
    }
    const end = valueEnd(text, valueAt)
    if (end < 0) return null
    i = skipSpace(text, end)
    if (text[i] !== ",") return null
    i = skipSpace(text, i + 1)
  }
  return null
}

/** The range of the object directly under `key`, or null when the member is missing or not an object. */
function memberObject(text: string, at: number, key: string): ObjectRange | null {
  const member = findMember(text, at, key)
  return member?.isObject ? { open: member.valueAt, close: containerEnd(text, member.valueAt)![0] } : null
}
