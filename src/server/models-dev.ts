import { DatabaseSync } from "node:sqlite"
import { homedir } from "node:os"
import { join } from "node:path"
import type { ModelsDevCatalog } from "./pricing"

/**
 * Reads the models.dev catalog out of the database OpenCode keeps for itself.
 *
 * The catalog is stored as a `kv` row whose `value` is JSON wrapping a `body`
 * string that is itself JSON — two parses, not one. Everything here is
 * best-effort: a missing database, a schema change, or a locked file must
 * degrade to "no prices" rather than break the plugin.
 */

const KV_KEY = "models-dev:v2:catalog"
const DB_FILE = "opencode.db"
/** Long enough to ride out another process's write lock, short enough not to stall a transform. */
const BUSY_TIMEOUT_MS = 2_000

/**
 * OpenCode's data directory. Mirrors its own precedence so a relocated install
 * is picked up without configuration.
 */
export function storageDir(
  env: Record<string, string | undefined> = process.env,
  home: string = homedir(),
): string {
  const explicit = env.OPENCODE_STORAGE_DIR
  if (explicit) return explicit
  const xdg = env.XDG_DATA_HOME
  if (xdg) return join(xdg, "opencode")
  return join(home, ".local", "share", "opencode")
}

export function databasePath(
  env: Record<string, string | undefined> = process.env,
  home: string = homedir(),
): string {
  return join(storageDir(env, home), DB_FILE)
}

/** `{ updatedAt, digest, body: "<json>" }` → the catalog. Null if either layer is unparseable. */
export function parseCatalogValue(value: string): ModelsDevCatalog | null {
  try {
    const outer = JSON.parse(value) as { body?: unknown }
    if (typeof outer?.body !== "string") return null
    const catalog = JSON.parse(outer.body) as unknown
    if (typeof catalog !== "object" || catalog === null) return null
    return catalog as ModelsDevCatalog
  } catch {
    return null
  }
}

export interface ReadCatalogDeps {
  dbPath?: string
  /** Seam for tests: given the database path, return the raw `kv.value` or null. */
  readValue?: (dbPath: string) => string | null
}

function readValueFromDatabase(dbPath: string): string | null {
  // Read-only: the plugin must never write to OpenCode's database.
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    db.exec(`pragma busy_timeout = ${BUSY_TIMEOUT_MS}`)
    const row = db.prepare("select value from kv where key = ?").get(KV_KEY) as { value?: unknown } | undefined
    return typeof row?.value === "string" ? row.value : null
  } finally {
    db.close()
  }
}

/** The whole models.dev catalog, or null when it cannot be read. Never throws. */
export function readModelsDevCatalog(deps: ReadCatalogDeps = {}): ModelsDevCatalog | null {
  const dbPath = deps.dbPath ?? databasePath()
  const read = deps.readValue ?? readValueFromDatabase
  try {
    const value = read(dbPath)
    if (value === null) return null
    return parseCatalogValue(value)
  } catch {
    return null
  }
}
