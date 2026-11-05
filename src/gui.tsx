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
              ui={{ Dialog: ctx.ui.Dialog, Button: ctx.ui.Button }}
              onRefresh={() => store.refresh({ force: true })}
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
      void store.refresh({ maxAgeMs: HOVER_MIN_AGE_MS })
    }

    // plan B: the capsule lives on the session header row, the only surface the
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
              ? "CodeBuddy 额度：暂不可用"
              : `CodeBuddy 额度：剩余 ${formatPct(remainingShare(quota()))}`
          }
          onMouseEnter={onHover}
          onFocus={onHover}
          onClick={openDetails}
          style={{
            background: "transparent",
            border: "none",
            padding: "2px 0",
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
        </button>
      ),
    })
  },
})
