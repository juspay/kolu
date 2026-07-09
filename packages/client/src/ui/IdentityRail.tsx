/** IdentityRail — the "which kolu am I running" chrome readout.
 *
 *  Carries the ONE host-independent process chip: Kolu (server + client). Padi
 *  and Kaval are PER-HOST facts — they live in the STATIONARY daemon slot
 *  (`HostDaemonChips`'s `DaemonSlot`, mounted by `ChromeBar` right after this
 *  rail) since the W4 header redesign. Iteration 1 put that pair inside the
 *  active host chip; iteration 2 pulled it back out to a fixed position so a
 *  host switch never resizes/reflows anything — only the slot's content
 *  re-keys. The Kolu chip keeps the same compact shape it always had: icon +
 *  status dot, plus its version once it clears the width budget;
 *  build/commit/memory detail lives in the tooltip/hover and the click-through
 *  dialog, never as always-on chrome.
 *
 *  The server dot carries `data-ws-status` — the e2e smoke/reconnect hooks
 *  read it; it is the only element that holds it now that the daemon dots
 *  moved out. Live memory rides the chip's `aria-label`/tooltip (where the
 *  e2e asserts it), so the rail never repaints as a process monitor. */

import { useSurfaceApp } from "@kolu/surface-app/solid";
import type { KoluBuildInfo } from "kolu-common/surface";
import { type Component, createSignal, Show } from "solid-js";
import { daemonTransportLive, serverDot } from "../kaval/useDaemonStatus";
import type { WsStatus } from "../rpc/rpc";
import { IdentityMark, StatusDot } from "./IdentityMark";
import { joinTip } from "./joinTip";
import KoluInfoDialog from "./KoluInfoDialog";
import { mbText } from "./memory";
import { clientStale, StaleBadge } from "./StaleBadge";
import { clientHeapUsedBytes, serverRssBytes } from "./useMemoryUsage";

const IdentityRail: Component<{ status: WsStatus }> = (props) => {
  // The server's build identity rides surface-app's `buildInfo` cell; `clientCommit`
  // is this bundle's baked commit.
  const pwa = useSurfaceApp<KoluBuildInfo>();
  // The watchdog-backed liveness of the ws delivering surface-app's siblings. Floors
  // the "watchdog reconnecting" tip segment: a dead/half-open link means the retained
  // build info can't refresh, so the tooltip says so rather than reading confidently
  // stale.
  const daemonLive = daemonTransportLive;
  const [koluDialogOpen, setKoluDialogOpen] = createSignal(false);
  const stale = clientStale;

  // Memoized would be premature here (single consumer — both `title` and
  // `aria-label` read the SAME accessor call, not two independent trackings), so a
  // plain function is enough per solidjs.md's "memos for multi-consumer derivations."
  const koluTip = (): string =>
    joinTip(
      `kolu ${props.status}${daemonLive() ? "" : " (watchdog reconnecting)"}`,
      pwa.server()?.version ? `server v${pwa.server()?.version}` : undefined,
      pwa.server()?.commit ? `server ${pwa.server()?.commit}` : undefined,
      `server RSS ${mbText(serverRssBytes())}`,
      stale()
        ? "client build differs from server"
        : "client build matches server",
      pwa.clientCommit ? `client ${pwa.clientCommit}` : undefined,
      `client heap ${mbText(clientHeapUsedBytes())}`,
    );

  return (
    <div class="inline-flex items-center gap-0.5 rounded-xl border border-edge/90 bg-surface-2/80 px-1 py-1 font-mono text-xs shadow-sm shadow-black/25">
      <button
        type="button"
        data-testid="kolu-identity-chip"
        onClick={() => setKoluDialogOpen(true)}
        class="inline-flex h-7 items-center gap-1.5 rounded-lg px-2 leading-4 text-fg-2 transition-colors hover:bg-surface-3/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        title={koluTip()}
        aria-label={koluTip()}
      >
        <IdentityMark logoSrc="/favicon.svg">
          <StatusDot
            class={serverDot(props.status, daemonLive())}
            data-ws-status={props.status}
          />
        </IdentityMark>
        {/* Resting state = icon + status dot + version, nothing more — the "Kolu"
         *  wordmark that used to sit here is tooltip-only now (compaction rule, W4
         *  header redesign); hidden below `lg` where it doesn't fit the budget. */}
        <Show when={pwa.server()?.version}>
          {(v) => (
            <span class="hidden tabular-nums text-fg-3 lg:inline">v{v()}</span>
          )}
        </Show>
      </button>
      <Show when={stale()}>
        <StaleBadge />
      </Show>

      <KoluInfoDialog
        open={koluDialogOpen()}
        onOpenChange={setKoluDialogOpen}
        status={props.status}
        live={daemonLive()}
        dotClass={serverDot(props.status, daemonLive())}
      />
    </div>
  );
};

export default IdentityRail;
