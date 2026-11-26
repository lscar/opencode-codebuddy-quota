import { describe, expect, it } from "bun:test"
import { anySignal, timeoutSignal } from "./signal"

describe("anySignal", () => {
  it("aborts when any input signal aborts", () => {
    const a = new AbortController()
    const b = new AbortController()
    const combined = anySignal([a.signal, b.signal])
    expect(combined.aborted).toBe(false)
    b.abort("reason-b")
    expect(combined.aborted).toBe(true)
    expect(combined.reason).toBe("reason-b")
  })

  it("is already aborted when an input signal was aborted before combining", () => {
    const a = new AbortController()
    a.abort("already")
    const combined = anySignal([a.signal, new AbortController().signal])
    expect(combined.aborted).toBe(true)
    expect(combined.reason).toBe("already")
  })

  it("timeoutSignal aborts after the given delay", async () => {
    const signal = timeoutSignal(20)
    expect(signal.aborted).toBe(false)
    await new Promise<void>((resolve) => {
      signal.addEventListener("abort", () => resolve(), { once: true })
    })
    expect(signal.aborted).toBe(true)
  })

  it("timeoutSignal falls back to a timer when the runtime lacks AbortSignal.timeout", async () => {
    // The whole point of timeoutSignal is runtimes without native .timeout.
    // Force that branch so deleting the fallback would turn this test red.
    const native = AbortSignal.timeout
    try {
      Object.defineProperty(AbortSignal, "timeout", { value: undefined, configurable: true })
      const signal = timeoutSignal(20)
      expect(signal.aborted).toBe(false)
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true })
      })
      expect(signal.aborted).toBe(true)
    } finally {
      Object.defineProperty(AbortSignal, "timeout", { value: native, configurable: true })
    }
  })

  it("detaches listeners from the other signals once one wins", () => {
    const a = new AbortController()
    const b = new AbortController()
    // Spy on b's removeEventListener to prove the detach actually runs; merely
    // checking "late abort is harmless" would pass even with detach removed.
    let removed = 0
    const originalRemove = b.signal.removeEventListener.bind(b.signal)
    b.signal.removeEventListener = ((type: string, listener: EventListenerOrEventListenerObject, opts?: boolean) => {
      removed += 1
      return originalRemove(type, listener, opts)
    }) as typeof b.signal.removeEventListener
    const combined = anySignal([a.signal, b.signal])
    expect(removed).toBe(0)
    a.abort()
    expect(combined.aborted).toBe(true)
    // a winning aborts detaches the listener registered on b.
    expect(removed).toBeGreaterThan(0)
  })
})
