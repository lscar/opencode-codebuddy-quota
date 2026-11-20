import type { JSX } from "solid-js"

export interface BatteryProps {
  /** Remaining share, 0..100, already rounded. `null` renders an empty track. */
  value: number | null
  color: string
  /** Stale data: dim the whole capsule and hatch the fill. */
  dim?: boolean
}

const STALE_HATCH = "repeating-linear-gradient(45deg, rgba(0,0,0,.22) 0 3px, transparent 3px 6px)"
const TRACK = "rgba(127, 137, 156, 0.35)"
const TRACK_EMPTY = "rgba(127, 137, 156, 0.22)"

const clampPct = (value: number | null) =>
  value === null ? 0 : Math.max(0, Math.min(100, value))

/**
 * An iOS-style capacity pill: no stroke, one solid rounded track, and the charge
 * drawn as a solid block of the same radius sitting flush inside it. The two share
 * an edge, so there is no gap to misalign at the rounded ends — the border/arc
 * mismatch that a stroke plus an inset fill always produces.
 *
 * Every style is a getter, not a snapshot, so a live `value`/`color` repaints in
 * place instead of freezing at the first paint.
 */
export function Battery(props: BatteryProps): JSX.Element {
  const empty = () => props.value === null

  const shell = (): JSX.CSSProperties => ({
    position: "relative",
    display: "inline-flex",
    "align-items": "center",
    "justify-content": "center",
    width: "52px",
    height: "18px",
    "border-radius": "6px",
    // No border: the track itself is the shape, which is what lets the fill meet
    // the outline without a seam.
    background: empty() ? TRACK_EMPTY : TRACK,
    opacity: props.dim ? "0.72" : "1",
    "box-sizing": "border-box",
    "vertical-align": "middle",
    overflow: "hidden",
  })

  const fill = (): JSX.CSSProperties => ({
    position: "absolute",
    left: "0",
    top: "0",
    height: "100%",
    width: `${clampPct(props.value)}%`,
    // Same radius as the track, and clipped by its overflow, so the leading edge
    // is a perfect half-round and the trailing edge is a crisp vertical cut.
    "border-radius": "6px",
    background: props.color,
    "background-image": props.dim ? STALE_HATCH : undefined,
    transition: "width 200ms ease-out, background 200ms ease-out",
  })

  const text = (): JSX.CSSProperties => ({
    position: "relative",
    "font-size": "10px",
    "font-weight": "700",
    "font-variant-numeric": "tabular-nums",
    "line-height": "1",
    "letter-spacing": "-0.2px",
    // The fill is saturated, so a dark label reads on it; over the bare track the
    // label needs to be light instead.
    color: empty() ? "#8b90a0" : "#0d1117",
    "pointer-events": "none",
    "text-shadow": empty() ? "none" : "0 0 2px rgba(0,0,0,.18)",
  })

  return (
    <span style={shell()}>
      <span style={fill()} />
      <span style={text()}>{empty() ? "--" : String(props.value)}</span>
    </span>
  )
}
