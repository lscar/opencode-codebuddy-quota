import type { JSX } from "solid-js"
import { createSignal, onMount } from "solid-js"
import { daysLeftInCycle } from "./days"
import { formatCredits, formatPct, paceColor, paceLabel, type PaceLabel } from "./pace"
import { PACE_CHIPS, paceChips } from "./pace-row"
import { remainingPercent, remainingShare, timeLeftPercent, type Quota } from "./quota"

export interface QuotaDialogProps {
  quota: Quota
  onRefresh: () => Promise<void>
  close: () => void
  ui: {
    Dialog: (props: Record<string, unknown>) => JSX.Element
    Button: (props: Record<string, unknown>) => JSX.Element
  }
}

const labelText: Record<PaceLabel, string> = {
  normal: "节奏正常",
  ahead: "略慢于时间",
  fast: "略快于时间",
  over: "超支",
  unknown: "—",
}

function statusText(q: Quota): string {
  switch (q.status) {
    case "ok":
      return "实时"
    case "cached":
      return q.ageSeconds === null ? "缓存" : `缓存（${q.ageSeconds} 秒前）`
    case "stale":
      return "过期"
    case "error":
      return "不可用"
  }
}

function clockOf(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  const p = (n: number) => String(n).padStart(2, "0")
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function daysLeft(cycleEnd: string | null): string {
  // Counted against the cycle's last day, inclusive, so the final day reads as
  // "1 day left" rather than "0". `resetAt` is the instant after it, which would
  // make the last day look finished.
  const days = daysLeftInCycle(cycleEnd, Date.now())
  return days === null ? "" : `（剩 ${days} 天）`
}

const row: JSX.CSSProperties = {
  display: "flex",
  "justify-content": "space-between",
  gap: "12px",
  padding: "7px 0",
  "font-size": "12.5px",
  "border-bottom": "1px dashed rgba(128,128,128,.25)",
}

const key: JSX.CSSProperties = { opacity: "0.62" }
const val: JSX.CSSProperties = { "font-variant-numeric": "tabular-nums" }

export function QuotaDialog(props: QuotaDialogProps): JSX.Element {
  const q = () => props.quota
  const unusable = () => q().status === "error"
  const pct = () => remainingPercent(q())
  // Same function the capsule's tooltip uses, so the two labels always agree.
  const left = () => remainingShare(q())
  const [busy, setBusy] = createSignal(false)

  const refresh = async () => {
    if (busy()) return
    setBusy(true)
    try {
      await props.onRefresh()
    } finally {
      setBusy(false)
    }
  }

  const Dialog = props.ui.Dialog
  const Button = props.ui.Button

  const body = () => (
    <div style={{ "min-width": "330px" }}>
      {unusable() ? (
        <div
          style={{
            padding: "10px 12px",
            "border-radius": "8px",
            background: "rgba(248,113,113,.12)",
            "border": "1px solid rgba(248,113,113,.35)",
            "font-size": "12px",
            "line-height": "1.6",
            "margin-bottom": "12px",
          }}
        >
          <b>CodeBuddy 额度取数失败</b>
          <br />
          {q().error ?? "未知错误"}
          <br />
          请检查 OPENCODE_CODEBUDDY_API_KEY 是否已设置。
        </div>
      ) : (
        <>
          <div
            style={{
              display: "flex",
              "align-items": "center",
              gap: "14px",
              "margin-bottom": "6px",
            }}
          >
            <div
              style={{
                flex: "1",
                height: "22px",
                position: "relative",
                "border-radius": "6px",
                background: "rgba(128,128,128,.18)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: "0",
                  top: "0",
                  bottom: "0",
                  width: `${Math.max(0, Math.min(100, pct() ?? 0))}%`,
                  background: paceColor(q()),
                  "border-radius": "4px",
                }}
              />
              {timeLeftPercent(q()) !== null && (
                <div
                  style={{
                    position: "absolute",
                    top: "0",
                    bottom: "0",
                    left: `${timeLeftPercent(q())}%`,
                    width: "2px",
                    background: "currentColor",
                    opacity: "0.55",
                  }}
                />
              )}
            </div>
            <div
              style={{
                "font-size": "26px",
                "font-weight": "700",
                "font-variant-numeric": "tabular-nums",
                "min-width": "76px",
                "text-align": "right",
              }}
            >
              {formatPct(left())}
            </div>
          </div>

          <div style={{ "font-size": "12px", opacity: "0.72", "margin-bottom": "12px" }}>
            剩余 <b style={{ "font-variant-numeric": "tabular-nums" }}>{formatCredits(q().remaining)}</b> /{" "}
            {formatCredits(q().total)} 积分
          </div>

          <div
            style={{
              "margin-bottom": "12px",
            }}
          >
            <div style={{ "font-size": "12px", "font-weight": "700", "margin-bottom": "8px" }}>
              {labelText[paceLabel(q())]}
            </div>
            {q().diff !== null && (
              // Equal columns: the label widths and value widths cancel each
              // other, so the three chips carry the same optical weight.
              <div style={{ display: "grid", "grid-template-columns": "repeat(3, 1fr)", gap: "8px" }}>
                {paceChips(q()).map((chip) => (
                  <div
                    style={{
                      position: "relative",
                      background: "rgba(128,128,128,.10)",
                      "border-radius": "6px",
                      padding: "8px 10px 8px 13px",
                      overflow: "hidden",
                    }}
                  >
                    {/* The accent bar is the only thing that changes colour per
                        chip, so a row of three stays readable when only one is
                        in a warning band. */}
                    <div
                      style={{
                        position: "absolute",
                        left: "0",
                        top: "0",
                        bottom: "0",
                        width: "3px",
                        background: chip.color,
                      }}
                    />
                    <div
                      style={{
                        display: "flex",
                        "align-items": "baseline",
                        gap: `${PACE_CHIPS.gap}px`,
                      }}
                    >
                      <span style={{ "font-size": "11px", opacity: "0.62", "flex": "none" }}>
                        {chip.label}
                      </span>
                      <span
                        style={{
                          "font-size": "15px",
                          "font-weight": "700",
                          "font-variant-numeric": "tabular-nums",
                          color: chip.color,
                          flex: "none",
                          // Reserved at the widest value so three digits do not
                          // nudge the row.
                          "min-width": `${PACE_CHIPS.valueMinCh}ch`,
                        }}
                      >
                        {chip.value}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: "flex", "flex-direction": "column" }}>
            <div style={row}>
              <span style={key}>已用</span>
              <span style={val}>{formatCredits(q().used)}</span>
            </div>
            <div style={row}>
              <span style={key}>本期周期</span>
              <span style={val}>
                {q().cycleStart ?? "—"} → {q().cycleEnd ?? "—"}
              </span>
            </div>
            <div style={row}>
              <span style={key}>重置时间</span>
              <span style={val}>
                {q().resetAt ?? "—"}
                {daysLeft(q().cycleEnd)}
              </span>
            </div>
            <div style={row}>
              <span style={key}>取数于</span>
              <span style={val}>{clockOf(q().fetchedAt)}</span>
            </div>
            <div style={{ ...row, "border-bottom": q().status === "stale" && q().error ? undefined : "none" }}>
              <span style={key}>状态</span>
              <span style={val}>{statusText(q())}</span>
            </div>
            {/* A stale reading keeps its numbers, so the full error block above is
                not shown; without this row the reason it went stale is invisible. */}
            {q().status === "stale" && q().error && (
              <div style={{ ...row, "border-bottom": "none" }}>
                <span style={key}>原因</span>
                <span style={{ ...val, opacity: "0.72" }}>{q().error}</span>
              </div>
            )}
          </div>

          <div
            style={{
              "margin-top": "4px",
              height: "72px",
              "border-radius": "8px",
              border: "1px dashed rgba(128,128,128,.35)",
              display: "flex",
              "align-items": "center",
              "justify-content": "center",
              "font-size": "11.5px",
              opacity: "0.55",
            }}
          >
            折线图 · 本期不做
          </div>
        </>
      )}
    </div>
  )

  onMount(() => {
    void refresh()
  })

  return (
    <Dialog title="CodeBuddy 额度" size="fit" footer={
      <Button variant="contrast" busy={busy()} onClick={refresh}>
        刷新
      </Button>
    }>
      {body()}
    </Dialog>
  )
}
