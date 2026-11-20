import type { JSX } from "solid-js"
import { createSignal, onMount } from "solid-js"
import type { Ui } from "@opencode/plugin/gui"
import type { Site, SiteInfo } from "../shared"
import { formatCredits, formatPct, paceColor, paceLabel, signedPp, type PaceLabel } from "./pace"
import { remainingShare, type Quota } from "./quota"

export interface QuotaDialogProps {
  quota: Quota
  onRefresh: (site?: Site) => Promise<void>
  onLogin: (site: Site) => Promise<boolean>
  close: () => void
  /** Only the two host components the dialog draws with. */
  ui: Pick<Ui, "Dialog" | "Button">
}

const labelText: Record<PaceLabel, string> = {
  normal: "节奏正常",
  ahead: "略慢于时间",
  fast: "略快于时间",
  over: "超支",
  unknown: "—",
}

const hintTone: Record<PaceLabel, "normal" | "fast" | "over"> = {
  normal: "normal",
  ahead: "normal",
  fast: "fast",
  over: "over",
  unknown: "fast",
}

const hintColor: Record<"normal" | "fast" | "over", string> = {
  normal: "#3ddc97",
  fast: "#ffb84d",
  over: "#ff7a7a",
}

const row: JSX.CSSProperties = {
  display: "flex",
  "justify-content": "space-between",
  gap: "12px",
  padding: "6px 0",
  "font-size": "12px",
  "border-bottom": "1px dashed rgba(128,128,128,.25)",
}
const key: JSX.CSSProperties = { opacity: "0.62" }
const val: JSX.CSSProperties = { "font-variant-numeric": "tabular-nums" }

const SITE_LABEL: Record<Site, string> = { cn: "国内站", intl: "国际站" }

function freshness(q: Quota): { text: string; color: string } {
  if (q.status === "error") return { text: "不可用", color: "#ff7a7a" }
  if (q.status === "cached") {
    return { text: q.ageSeconds === null ? "缓存" : `缓存（${q.ageSeconds} 秒前）`, color: "#ffb84d" }
  }
  if (q.status === "stale") return { text: "过期", color: "#ff7a7a" }
  return { text: "实时", color: "#3ddc97" }
}

export function QuotaDialog(props: QuotaDialogProps): JSX.Element {
  const q = () => props.quota
  const site = () => q().site
  const sites = (): SiteInfo[] => q().sites
  const unusable = () => q().status === "error" || q().remaining === null
  const fresh = () => freshness(q())
  const [busy, setBusy] = createSignal(false)
  const [logging, setLogging] = createSignal<Site | null>(null)

  const refresh = async (s?: Site) => {
    if (busy()) return
    setBusy(true)
    try {
      await props.onRefresh(s)
    } finally {
      setBusy(false)
    }
  }

  const login = async (s: Site) => {
    if (logging()) return
    setLogging(s)
    try {
      await props.onLogin(s)
    } finally {
      setLogging(null)
    }
  }

  const select = (s: Site) => {
    if (s !== site()) void refresh(s)
  }

  const Dialog = props.ui.Dialog
  const Button = props.ui.Button

  const tag = (info: SiteInfo): JSX.Element => {
    const selected = info.site === site()
    const tagStyle: JSX.CSSProperties = {
      flex: "1",
      border: "1px solid",
      "border-color": selected ? "rgba(91,140,255,.9)" : "rgba(128,128,128,.35)",
      background: selected ? "linear-gradient(135deg,#33508f,#4a3f9e)" : "rgba(0,0,0,.15)",
      color: selected ? "#fff" : "inherit",
      "font-size": "12px",
      padding: "8px 6px",
      "border-radius": "8px",
      cursor: "pointer",
      "font-weight": "600",
    }
    return (
      <div style={tagStyle} onClick={() => (info.available ? select(info.site) : login(info.site))}>
        <span
          style={{
            "display": "inline-block",
            width: "6px",
            height: "6px",
            "border-radius": "50%",
            "margin-right": "6px",
            "vertical-align": "middle",
            background: info.available ? "#3ddc97" : "#ff7a7a",
          }}
        />
        {SITE_LABEL[info.site]}
        {!info.available && (
          <span style={{ "margin-left": "6px", "font-size": "10px", opacity: "0.8" }}>
            {logging() === info.site ? "登录中…" : "· 登录"}
          </span>
        )}
      </div>
    )
  }

  const body = () => (
    <div style={{ "min-width": "340px" }}>
      <div style={{ display: "flex", gap: "4px", "margin-bottom": "14px" }}>
        {sites().map(tag)}
      </div>

      {unusable() ? (
        <div
          style={{
            padding: "12px",
            "border-radius": "10px",
            background: "rgba(255,255,255,.04)",
            border: "1px dashed rgba(255,255,255,.2)",
            "font-size": "12px",
            "line-height": "1.6",
            "text-align": "center",
          }}
        >
          <div style={{ color: "var(--sub, #aab3c6)", "margin-bottom": "10px" }}>
            <b style={{ color: "#ffb84d" }}>{SITE_LABEL[site()]}未登录</b>或认证已过期
          </div>
          <Button
            variant="contrast"
            busy={logging() === site()}
            onClick={() => login(site())}
          >
            登录{SITE_LABEL[site()]}
          </Button>
          <div style={{ "font-size": "10px", opacity: "0.6", "margin-top": "10px" }}>
            打开浏览器授权，插件自行轮询获取凭据；无需安装 CodeBuddy CLI。
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", "align-items": "baseline", "justify-content": "space-between", "margin-bottom": "2px" }}>
            <span style={{ "font-size": "12px", opacity: "0.72" }}>本周期剩余额度</span>
            <span style={{ "font-size": "26px", "font-weight": "750", "font-variant-numeric": "tabular-nums" }}>
              {formatCredits(q().remaining)} <small style={{ "font-size": "12px", "font-weight": "500", opacity: "0.7" }}>积分</small>
            </span>
          </div>

          {/* Variant A: one bar for both progressions. Fill = credits used,
              white marker = elapsed time. Legend carries the numbers once. */}
          <div style={{ position: "relative", height: "16px", "border-radius": "6px", background: "rgba(128,128,128,.18)", "margin-top": "10px" }}>
            <div
              style={{
                position: "absolute", left: "0", top: "0", bottom: "0",
                width: `${Math.max(0, Math.min(100, q().usedPct ?? 0))}%`,
                background: paceColor(q()), "border-radius": "6px",
              }}
            />
            {q().timePct !== null && (
              <div
                style={{
                  position: "absolute", top: "-3px", bottom: "-3px",
                  left: `${Math.max(0, Math.min(100, 100 - (q().timePct ?? 0)))}%`,
                  width: "2px", background: "#fff", "border-radius": "2px", opacity: "0.9",
                }}
              />
            )}
          </div>
          <div style={{ display: "flex", "justify-content": "space-between", "font-size": "10.5px", opacity: "0.8", "margin-top": "8px" }}>
            <span>● 已用进度 {formatPct(q().usedPct)}</span>
            <span>▏时间已过 {formatPct(q().timePct)}</span>
          </div>

          <div
            style={{
              display: "flex", gap: "9px", "align-items": "flex-start",
              "border-radius": "9px", padding: "10px 12px", "font-size": "12px",
              border: "1px solid rgba(255,255,255,.08)", background: "rgba(255,255,255,.05)",
              "margin-top": "12px",
            }}
          >
            <span style={{ "font-weight": "800", color: hintColor[hintTone[paceLabel(q())]] }}>
              {hintTone[paceLabel(q())] === "normal" ? "✓" : "!"}
            </span>
            <div>
              <div style={{ "font-weight": "700", color: hintColor[hintTone[paceLabel(q())]] }}>
                {labelText[paceLabel(q())]}
                {q().diff !== null ? ` · ${paceLabel(q()) === "normal" ? "慢于" : "快于"}时间 ${signedPp(Math.abs(q().diff!))}` : ""}
              </div>
              <div style={{ opacity: "0.72", "font-size": "10.5px" }}>
                积分消耗{q().diff !== null && q().diff! < 0 ? "快于" : "慢于"}时间流逝，按当前速度
                {q().diff !== null && q().diff! < 0 ? "可能在周期末前用完，建议控制用量。" : "可用到周期末。"}
              </div>
            </div>
          </div>

          <div style={{ "margin-top": "13px", "border-top": "1px solid rgba(255,255,255,.1)", "padding-top": "6px" }}>
            <div style={row}><span style={key}>已使用</span><span style={val}>{formatCredits(q().used)} 积分</span></div>
            <div style={row}><span style={key}>总额度</span><span style={val}>{formatCredits(q().total)} 积分</span></div>
            <div style={{ ...row, "border-bottom": "none" }}><span style={key}>下次重置</span><span style={val}>{q().resetAt ?? "—"}</span></div>
          </div>
        </>
      )}
    </div>
  )

  onMount(() => {
    void refresh(site())
  })

  return (
    <Dialog
      title={`CodeBuddy 额度 · ${SITE_LABEL[site()]}`}
      size="fit"
      footer={
        <Button variant="contrast" busy={busy()} onClick={() => refresh(site())}>
          刷新
        </Button>
      }
    >
      {body()}
    </Dialog>
  )
}
