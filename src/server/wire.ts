import type { Reading } from "./quota-source"

/** The object the RPC returns; the fields mirror `rpc.ts`'s output schema. */
export interface WireReading {
  ok: boolean
  stale: boolean
  remaining: number | null
  used: number | null
  total: number | null
  cycleStart: string | null
  cycleEnd: string | null
  resetAt: string | null
  fetchedAt: string | null
  error: string | null
}

/**
 * `ok` answers "do we have numbers", `stale` answers "did the latest attempt
 * fail". A reading with numbers but a failed refresh is `ok: true, stale: true`
 * — the GUI shows the old figure marked stale. Only a source that never
 * succeeded says `ok: false`, which the GUI treats as unavailable rather than
 * as a stale number.
 */
export function toWireReading(reading: Reading): WireReading {
  const numbers = {
    remaining: reading.remaining,
    used: reading.used,
    total: reading.total,
    cycleStart: reading.cycleStart,
    cycleEnd: reading.cycleEnd,
    resetAt: reading.resetAt,
    fetchedAt: reading.fetchedAt,
    error: reading.error,
  }
  if (reading.fetchedAt === null) {
    return {
      ok: false,
      stale: true,
      ...numbers,
      remaining: null,
      used: null,
      total: null,
      cycleStart: null,
      cycleEnd: null,
      resetAt: null,
      fetchedAt: null,
    }
  }
  return { ok: true, stale: reading.stale, ...numbers }
}
