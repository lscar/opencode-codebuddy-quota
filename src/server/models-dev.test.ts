import { describe, expect, it } from "bun:test"
import { join } from "node:path"
import { parseCatalogValue, readModelsDevCatalog, storageDir } from "./models-dev"

describe("storageDir", () => {
  it("honours OPENCODE_STORAGE_DIR", () => {
    expect(storageDir({ OPENCODE_STORAGE_DIR: "/tmp/oc" }, "/home/u")).toBe("/tmp/oc")
  })
  it("honours XDG_DATA_HOME", () => {
    expect(storageDir({ XDG_DATA_HOME: "/xdg" }, "/home/u")).toBe(join("/xdg", "opencode"))
  })
  it("defaults to ~/.local/share/opencode", () => {
    expect(storageDir({}, "/home/u")).toBe(join("/home/u", ".local", "share", "opencode"))
  })
})

describe("parseCatalogValue", () => {
  it("parses the doubly-encoded body", () => {
    const inner = JSON.stringify({ opencode: { models: { a: { cost: {} } } } })
    const value = JSON.stringify({ updatedAt: 1, digest: "d", body: inner })
    expect(parseCatalogValue(value)).toEqual({ opencode: { models: { a: { cost: {} } } } })
  })
  it("returns null on malformed JSON", () => {
    expect(parseCatalogValue("not json")).toBe(null)
    expect(parseCatalogValue(JSON.stringify({ body: "not json" }))).toBe(null)
  })
})

describe("readModelsDevCatalog", () => {
  it("returns null instead of throwing when the database is missing", () => {
    expect(readModelsDevCatalog({ readValue: () => { throw new Error("SQLITE_CANTOPEN") } })).toBe(null)
  })
  it("returns null when the key is absent", () => {
    expect(readModelsDevCatalog({ readValue: () => null })).toBe(null)
  })
  it("returns the parsed catalog on success", () => {
    const inner = JSON.stringify({ zhipuai: { models: {} } })
    const value = JSON.stringify({ body: inner })
    expect(readModelsDevCatalog({ readValue: () => value })).toEqual({ zhipuai: { models: {} } })
  })
})
