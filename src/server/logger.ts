/**
 * A warning sink that reports each distinct message once per process.
 *
 * A provider transform runs on every model-list rebuild, so the same
 * "provider X has no entry for Y" would otherwise repeat on each one and bury
 * anything that actually changed. Logging must also never be the thing that
 * breaks a caller: a throwing writer is swallowed.
 */
export function createDedupedLogger(
  write: (line: string) => void,
  prefix?: string,
): (message: string) => void {
  const seen = new Set<string>()

  return (message: string) => {
    // Dedupe on the raw message, not the formatted line, so changing the
    // prefix later does not re-emit everything.
    if (seen.has(message)) return
    seen.add(message)
    try {
      write(prefix ? `${prefix} ${message}` : message)
    } catch {
      /* a broken writer must not become a broken transform */
    }
  }
}
