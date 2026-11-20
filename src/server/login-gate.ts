import type { Site } from "../shared"

/** Per-site single-flight for the browser login flow. */
export interface LoginGate {
  run(site: Site, task: () => Promise<{ ok: boolean; error: string | null }>): Promise<{ ok: boolean; error: string | null }>
}

export function createLoginGate(): LoginGate {
  const inFlight: Partial<Record<Site, Promise<{ ok: boolean; error: string | null }>>> = {}
  return {
    run(site, task) {
      const existing = inFlight[site]
      if (existing) return existing
      const p = task().finally(() => {
        delete inFlight[site]
      })
      inFlight[site] = p
      return p
    },
  }
}
