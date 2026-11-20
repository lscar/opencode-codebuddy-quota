import { signedPp } from "./pace"
import type { Quota } from "./quota"

/** Integer percent for the compact legend, clamped to 0..100. */
export const pctInt = (v: number | null): string =>
  v === null || !Number.isFinite(v) ? "—" : `${Math.max(0, Math.min(100, Math.round(v)))}%`

/** Direction + magnitude copy for the pace hint, driven only by diff's sign. */
export const paceHint = (diff: number | null): string => {
  if (diff === null || !Number.isFinite(diff)) return ""
  const dir = diff >= 0 ? "慢于" : "快于"
  return ` · ${dir}时间 ${signedPp(Math.abs(diff))}`
}

export function freshness(q: Quota): { text: string; color: string } {
  if (q.status === "error") return { text: "不可用", color: "#ff7a7a" }
  if (q.status === "cached") {
    return { text: q.ageSeconds === null ? "缓存" : `缓存（${q.ageSeconds} 秒前）`, color: "#ffb84d" }
  }
  if (q.status === "stale") return { text: "过期", color: "#ff7a7a" }
  return { text: "实时", color: "#3ddc97" }
}
