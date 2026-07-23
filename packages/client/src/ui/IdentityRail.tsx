/** IdentityRail — the quiet "which kolu am I running" chrome mark.
 *
 *  Host-independent process identity only: Kolu (server + client). Padi and
 *  Kaval are PER-HOST facts — they live in the host diagnostics popover
 *  (`HostDualDaemonSlot` in `HostDaemonChips.tsx`), not on every strip chip.
 *  Resting state is icon + status dot; version/build/commit/memory live in
 *  the tooltip and the click-through panel that drops under this mark. */

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

  // The server build (version + commit), floored on liveness ONCE (#1793) — read every
  // server-fact site through this rather than re-AND-ing `daemonLive()` at each one, matching
  // the sibling KoluInfoDialog's `liveServer` fold. Over a dead transport the always-reachable
  // tooltip stops asserting a definite "server v9.9" off a retained build the channel can't
  // confirm. (`serverRssBytes()` is already floored; the client commit/heap are local.)
  const liveServer = () => (daemonLive() ? pwa.server() : undefined);
  const koluTip = (): string =>
    joinTip(
      `kolu ${props.status}${daemonLive() ? "" : " (watchdog reconnecting)"}`,
      liveServer()?.version ? `server v${liveServer()?.version}` : undefined,
      liveServer()?.commit ? `server ${liveServer()?.commit}` : undefined,
      `server RSS ${mbText(serverRssBytes())}`,
      // The build-vs-server verdict: `stale()` already floors to `false` off a dead transport
      // (StaleBadge), but the outer `daemonLive()` gate distinguishes "unknown" (undefined)
      // from a definite "matches" — so a dead channel asserts NEITHER.
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
