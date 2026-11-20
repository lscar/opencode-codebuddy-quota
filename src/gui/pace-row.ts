import { formatPct, progressColor, signedPp, signedPpColor } from "./pace"
import type { Quota } from "./quota"

export interface PaceChip {
  label: string
  value: string
  color: string
}

/**
 * The three figures under the pace label, in display order.
 *
 * The chips are laid out in equal columns. That only looks even because the
 * label widths and the value widths cancel: 偏差 is two characters shorter than
 * 使用进度/时间进度, while its value is two characters longer than a percent.
 * If either label changes length, re-check the row.
 */
export function paceChips(q: Quota): PaceChip[] {
  return [
    { label: "使用进度", value: formatPct(q.usedPct), color: progressColor(q.usedPct) },
    { label: "时间进度", value: formatPct(q.timePct), color: progressColor(q.timePct) },
    { label: "偏差", value: signedPp(q.diff), color: signedPpColor(q.diff) },
  ]
}

export const PACE_CHIPS = {
  /**
   * Every value is reserved at the width of the widest one it can ever show
   * ("100.00%"), so crossing from two digits into three does not nudge the row.
   * Measured in `ch` against tabular figures, which makes the unit stable.
   */
  valueMinCh: 7.4,
  /** Fixed gap between label and value; never `auto`, see the note above. */
  gap: 8,
} as const
