/**
 * A warning sink that reports each distinct message once per process.
 *
 * Import runs at plugin load and can emit the same "provider X has no entry for
 * Y" for several models at once; deduping keeps the console readable. Logging
 * must also never be the thing that breaks a caller: a throwing writer is
 * swallowed.
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
