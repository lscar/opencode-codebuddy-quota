import { Plugin, Slot } from "@opencode/plugin/gui"
import { createSignal, onCleanup } from "solid-js"
import { CodebuddyQuota } from "../rpc"
import { Battery } from "./gui/battery"
import { QuotaDialog } from "./gui/dialog"
import { formatPct, paceColor } from "./gui/pace"
import { remainingPercent, remainingShare, type Quota } from "./gui/quota"
import { createQuotaStore, HOVER_MIN_AGE_MS } from "./gui/store"

export default Plugin.define({
  setup(ctx) {
    // The client is read per request, not captured here: it changes when the
    // OpenCode server restarts, and a captured one would keep failing.
    const store = createQuotaStore(() => ctx.client.rpc(CodebuddyQuota))
    const [quota, setQuota] = createSignal<Quota>(store.read())
    onCleanup(store.subscribe(setQuota))
    onCleanup(store.start())

    const openDetails = () => {
      // Refreshing here as well as on the dialog's mount would fire two requests
      // for one click, so the dialog owns that refresh.
      ctx.dialogs.open((dialog) => {
        // The subscription lives in its own component so its owner is the dialog's
        // render, not whatever scope `dialogs.open` happens to run in.
        const Live = () => {
          const [live, setLive] = createSignal<Quota>(store.read())
          onCleanup(store.subscribe(setLive))
          return (
            <QuotaDialog
              quota={live()}
              ui={ctx.ui}
              onRefresh={(site) => store.refresh({ force: true, site })}
              onLogin={(site) => store.login(site)}
              close={dialog.close}
            />
          )
        }
        return <Live />
      })
    }

    // Hover is the main way this refreshes: the background timer is only a safety
    // net, so pointing at the capsule pulls a reading that is older than a minute.
    const onHover = () => {
      void store.refresh({ maxAgeMs: HOVER_MIN_AGE_MS, site: store.read().site })
    }
    const SITE_LABEL = { cn: "国内站", intl: "国际站" } as const
    // Any site needing login shows an amber dot outside the capsule.
    const needsLogin = () => store.read().sites.some((s) => !s.available)

    // The capsule lives on the session header row — the only surface the
    // side-tabs layout leaves a plugin. See the design notes for why.
    //
    // Every value is read inside the JSX, not in the render body: a signal read
    // outside a tracked expression is evaluated once and then frozen, which is
    // why the capsule used to stay on "--" while the dialog showed live numbers.
    ctx.add(Slot, {
      at: "session.header",
      order: 50,
      render: () => (
        <button
          type="button"
          title={
            remainingShare(quota()) === null
              ? `CodeBuddy 额度 · ${SITE_LABEL[quota().site]}：暂不可用（点击查看/登录）`
              : `CodeBuddy 额度 · ${SITE_LABEL[quota().site]}：剩余 ${formatPct(remainingShare(quota()))}`
          }
          onMouseEnter={onHover}
          onFocus={onHover}
          onClick={openDetails}
          style={{
            position: "relative",
            background: "transparent",
            border: "none",
            padding: "2px 6px 2px 0",
            "margin-left": "auto",
            cursor: "pointer",
            "line-height": "0",
          }}
        >
          <Battery
            value={remainingPercent(quota())}
            color={paceColor(quota())}
            dim={quota().status === "stale"}
          />
          {needsLogin() && (
            <span
              style={{
                position: "absolute",
                top: "0",
                right: "0",
                width: "9px",
                height: "9px",
                "border-radius": "50%",
                background: "#ffb84d",
                border: "1.5px solid transparent",
              }}
            />
          )}
        </button>
      ),
    })
  },
})
