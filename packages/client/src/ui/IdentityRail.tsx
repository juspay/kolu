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
import { IdentityMark, identityMarkBtnClass, StatusDot } from "./IdentityMark";
import { joinTip } from "./joinTip";
import KoluInfoDialog from "./KoluInfoDialog";
import { mbText } from "./memory";
import { clientStale, StaleBadge } from "./StaleBadge";
import Tip from "./Tip";
import { clientHeapUsedBytes, serverRssBytes } from "./useMemoryUsage";

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
    // Same outer height as a host chip (`h-7`) — no extra py/padding frame that
    // made Kolu taller than Padi/Kaval marks.
    <div class="inline-flex h-7 items-center gap-0.5 rounded-lg border border-edge/90 bg-surface-2/80 font-mono text-xs shadow-sm shadow-black/25">
      <Tip label={koluTip()}>
        <button
          type="button"
          ref={triggerEl}
          data-testid="kolu-identity-chip"
          onClick={() => setKoluDialogOpen((v) => !v)}
          class={identityMarkBtnClass}
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
