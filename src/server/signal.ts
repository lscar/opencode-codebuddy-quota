/**
 * AbortSignal.any is not guaranteed in every runtime OpenCode embeds, so keep a
 * small compatible implementation shared by the server and the catalog fetch.
 */
export function anySignal(signals: AbortSignal[]): AbortSignal {
  for (const signal of signals) {
    if (signal.aborted) return AbortSignal.abort(signal.reason)
  }
  const controller = new AbortController()
  const listeners = signals.map((signal) => {
    const handler = () => controller.abort(signal.reason)
    signal.addEventListener("abort", handler, { once: true })
    return { signal, handler }
  })
  // When one signal wins, detach from the others so a long-lived parent does
  // not accumulate listeners across many requests.
  controller.signal.addEventListener("abort", () => {
    for (const { signal, handler } of listeners) signal.removeEventListener("abort", handler)
  }, { once: true })
  return controller.signal
}

/**
 * AbortSignal.timeout is also not guaranteed in every embedded runtime. Prefer
 * the native implementation; fall back to a timer-driven AbortController.
 */
export function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  // On Node the timer would otherwise hold the process open until it fires.
  // Browsers return a numeric id with no unref — optional call is safe there.
  timer.unref?.()
  controller.signal.addEventListener("abort", () => clearTimeout(timer), { once: true })
  return controller.signal
}
