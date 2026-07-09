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
    // Plain app identity mark. Hosts are the framed tab surface; Kolu should
    // not look like another host tab or daemon control.
    <div class="inline-flex h-8 items-center gap-0.5 font-mono text-xs">
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
