/** IdentityRail — the quiet "which kolu am I running" chrome mark.
 *
 *  Host-independent process identity only: Kolu (server + client). Padi and
 *  Kaval are PER-HOST facts — they live in each host chip's dual-daemon slot
 *  (`HostDualDaemonSlot` in `HostDaemonChips.tsx`). Resting state is icon +
 *  status dot; version/build/commit/memory live in the tooltip and the
 *  click-through panel that drops under this mark. */

import { useSurfaceApp } from "@kolu/surface-app/solid";
import type { KoluBuildInfo } from "kolu-common/surface";
import { type Component, createSignal, Show } from "solid-js";
import { daemonTransportLive, serverDot } from "../kaval/useDaemonStatus";
import type { WsStatus } from "../rpc/rpc";
import { identityMarkBtnClass, IdentityMark, StatusDot } from "./IdentityMark";
import { joinTip } from "./joinTip";
import KoluInfoDialog from "./KoluInfoDialog";
import { mbText } from "./memory";
import { clientStale, StaleBadge } from "./StaleBadge";
import Tip from "./Tip";
import { clientHeapUsedBytes, serverRssBytes } from "./useMemoryUsage";

// Kolu, Padi, and Kaval share ONE mark button — same frame size + same
// hover language (`identityMarkBtnClass`) — so the three process marks read
// as one consistent family. The Kolu mark's only distinction is its position
// (leftmost, outside the host tab strip), never a different size or hover.
const koluIdentityBtnClass = identityMarkBtnClass;

const IdentityRail: Component<{ status: WsStatus }> = (props) => {
  const pwa = useSurfaceApp<KoluBuildInfo>();
  const daemonLive = daemonTransportLive;
  const [koluDialogOpen, setKoluDialogOpen] = createSignal(false);
  let triggerEl!: HTMLButtonElement;
  const stale = clientStale;

  const koluTip = (): string =>
    joinTip(
      `kolu ${props.status}${daemonLive() ? "" : " (watchdog reconnecting)"}`,
      // Server version/commit + the client-build-vs-server verdict are connected-era facts
      // off the ws (#1793) — gate on `daemonLive()`, so the always-reachable tooltip stops
      // asserting a definite "server v9.9" / "build differs/matches" over a dead transport.
      // (`serverRssBytes()`, the client commit, and the client heap are already floored / are
      // local build constants.)
      daemonLive() && pwa.server()?.version
        ? `server v${pwa.server()?.version}`
        : undefined,
      daemonLive() && pwa.server()?.commit
        ? `server ${pwa.server()?.commit}`
        : undefined,
      `server RSS ${mbText(serverRssBytes())}`,
      daemonLive()
        ? stale()
          ? "client build differs from server"
          : "client build matches server"
        : undefined,
      pwa.clientCommit ? `client ${pwa.clientCommit}` : undefined,
      `client heap ${mbText(clientHeapUsedBytes())}`,
    );

  return (
    // Plain app identity mark. Hosts are the framed tab surface; Kolu should
    // not look like another host tab or daemon control.
    //
    // `-translate-y-px`: the host tabs are pulled up 1px by their wrapper's
    // `-mb-px` (which lets the active tab merge through the strip baseline),
    // so their in-tab Padi/Kaval marks sit 1px above the header's true centre.
    // This mark lives OUTSIDE a tab and would otherwise land 1px lower — the
    // nudge lands it on the SAME row as the daemon marks so the three process
    // marks read as one aligned family.
    <div class="inline-flex h-8 items-center gap-0.5 font-mono text-xs -translate-y-px">
      <Tip label={koluTip()}>
        <button
          type="button"
          ref={triggerEl}
          data-testid="kolu-identity-chip"
          onClick={() => setKoluDialogOpen((v) => !v)}
          class={koluIdentityBtnClass}
          aria-label={koluTip()}
          aria-expanded={koluDialogOpen()}
        >
          <IdentityMark logoSrc="/favicon.svg">
            <StatusDot
              class={serverDot(props.status, daemonLive())}
              data-ws-status={props.status}
            />
          </IdentityMark>
        </button>
      </Tip>
      <Show when={stale()}>
        <StaleBadge />
      </Show>

      <KoluInfoDialog
        open={koluDialogOpen()}
        onOpenChange={setKoluDialogOpen}
        status={props.status}
        live={daemonLive()}
        dotClass={serverDot(props.status, daemonLive())}
        triggerRef={() => triggerEl}
      />
    </div>
  );
};

export default IdentityRail;
