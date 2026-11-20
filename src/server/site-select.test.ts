import { describe, expect, it } from "bun:test"
import { resolveSite } from "./site-select"
import type { TokenCache } from "./token-store"

const cache = (selected: "cn" | "intl"): TokenCache => ({
  accounts: { cn: [], intl: [] },
  activeId: { cn: null, intl: null },
  selected,
})

describe("resolveSite", () => {
  it("persists an explicit requested site", () => {
    let selected: "cn" | "intl" | null = null as "cn" | "intl" | null
    const store = {
      all: () => cache("cn"),
      select: (s: "cn" | "intl") => { selected = s },
    }
    expect(resolveSite(store, "intl")).toBe("intl")
    expect(selected).toBe("intl")
  })

  it("does not fail the read when persistence throws", () => {
    const warnings: string[] = []
    const store = {
      all: () => cache("cn"),
      select: () => { throw new Error("disk full") },
    }
    expect(resolveSite(store, "intl", (m) => warnings.push(m))).toBe("intl")
    expect(warnings[0]).toContain("disk full")
  })

  it("falls back to currentSite when nothing is requested", () => {
    const store = { all: () => cache("intl"), select: () => {} }
    expect(resolveSite(store, undefined)).toBe("intl")
  })
})
