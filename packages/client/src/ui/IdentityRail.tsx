/** IdentityRail — the consolidated "which kolu am I running" chrome readout
 *  (R-4 A2 · Phase B). A three-column `srv · client · pty` rail:
 *
 *  - `srv` — the server you're connected to: its commit + version, the
 *    WebSocket liveness dot, and `up <uptime>` since this server process booted.
 *  - `client` — the commit this browser's JS bundle was built from
 *    (`__SURFACE_APP_COMMIT__`); flags `≠ srv` when a cached old bundle disagrees
 *    with a freshly deployed server.
 *  - `pty` — the surviving pty-host **daemon** serving your terminals. In Phase B
 *    it is a separate, surviving process, so this column is genuinely distinct
 *    from `srv`: its own state dot (connected / degraded / dead), its commit +
 *    closure staleKey, and `up <uptime>` since the *daemon* booted. The gap
 *    between `srv up 2m` and `pty up 3h` is the glanceable proof the daemon
 *    outlived the last deploy. It reads the live `daemonStatus` cell (the
 *    endpoint is its one owner), so a mid-session daemon death turns the dot red
 *    — never the empty-canvas lie. */

import { useSurfaceApp } from "@kolu/surface-app/solid";
import type { DaemonState, KoluBuildInfo } from "kolu-common/surface";
import { type Component, Show } from "solid-js";
import type { WsStatus } from "../rpc/rpc";
import { daemonStatus } from "../wire";
import Commit from "./Commit";
import { clientStale, StaleBadge } from "./StaleBadge";
import Tip from "./Tip";
import { formatUptime, useClock } from "./uptime";

/** WebSocket transport status → the `srv` liveness dot. */
const srvDot: Record<WsStatus, string> = {
  connecting: "bg-warning animate-pulse",
  open: "bg-ok",
  closed: "bg-danger",
};

/** Daemon state → the `pty` liveness dot. Distinct from the WebSocket dot: this
 *  is the daemon's *own* health, not the browser link's. `dead` is red (the
 *  heartbeat stopped) — visibly different from "you have no terminals". */
const ptyDot: Record<DaemonState, string> = {
  connecting: "bg-warning animate-pulse",
  connected: "bg-ok",
  degraded: "bg-warning",
  dead: "bg-danger",
};

/** Short-form a build id for display: a nix store hash's leading 7 chars, or a
 *  path basename capped at 12. The full id lives in the tooltip. */
function shortId(id: string | null | undefined): string {
  if (!id) return "—";
  const hash = /^([a-z0-9]{7})/.exec(id);
  if (hash) return hash[1] as string;
  const tail = id.split("/").pop() ?? id;
  return tail.length > 12 ? `${tail.slice(0, 12)}…` : tail;
}

const IdentityRail: Component<{ status: WsStatus }> = (props) => {
  // `srv` build identity rides surface-app's `buildInfo` cell; the daemon's
  // rides the kolu-surface `daemonStatus` cell. `clientStale` is this bundle's
  // commit vs the server's.
  const pwa = useSurfaceApp<KoluBuildInfo>();
  const stale = clientStale;
  const now = useClock();
  // Default to `connecting` before the first cell yield so the dot reads
  // "warming up", never a blank.
  const pty = () => daemonStatus();
  const ptyState = (): DaemonState => pty()?.state ?? "connecting";

  return (
    <div class="inline-flex items-stretch rounded-lg border border-edge bg-surface-2/60 p-0.5 font-mono text-xs">
      <span class="inline-flex items-center gap-1.5 px-2 py-0.5">
        <span class="text-[9px] uppercase tracking-wide text-fg-3">srv</span>
        <Tip label="Server connection">
          <span
            data-ws-status={props.status}
            class={`inline-block h-[7px] w-[7px] rounded-full ${srvDot[props.status]}`}
          />
        </Tip>
        <Show when={pwa.server()?.version}>
          {(v) => (
            <Tip label="kolu version">
              <span class="tabular-nums text-fg-2">v{v()}</span>
            </Tip>
          )}
        </Show>
        <Commit sha={pwa.server()?.commit} />
        <Show when={pwa.server()?.srvStartedAt}>
          {(at) => (
            <Tip label="Server uptime (since this kolu-server process booted)">
              <span class="tabular-nums text-fg-3">
                up {formatUptime(at(), now())}
              </span>
            </Tip>
          )}
        </Show>
      </span>
      <span class="mx-0.5 h-4 w-px self-center bg-edge-bright/70" />
      <span class="inline-flex items-center gap-1.5 px-2 py-0.5">
        <span class="text-[9px] uppercase tracking-wide text-fg-3">client</span>
        <Tip label="This browser's JS build (baked in at build time)">
          <Commit sha={pwa.clientCommit} />
        </Tip>
        <Show when={stale()}>
          <Tip label="This client build doesn't match the server — reload to pick up the server's version.">
            <StaleBadge />
          </Tip>
        </Show>
      </span>
      <span class="mx-0.5 h-4 w-px self-center bg-edge-bright/70" />
      <span class="inline-flex items-center gap-1.5 px-2 py-0.5">
        <span class="text-[9px] uppercase tracking-wide text-fg-3">pty</span>
        <Tip label="Terminal host — the surviving pty-host daemon">
          <span
            data-daemon-state={ptyState()}
            class={`inline-block h-[7px] w-[7px] rounded-full ${ptyDot[ptyState()]}`}
          />
        </Tip>
        <Commit sha={pty()?.navigableCommit} />
        <Show when={pty()?.staleKey}>
          {(key) => (
            <Tip
              label={`build ${key()} — @kolu/pty-host closure hash (staleness key)`}
            >
              <span class="cursor-help border-b border-dotted border-fg-3/50 text-[10px] text-fg-3">
                {shortId(key())}
              </span>
            </Tip>
          )}
        </Show>
        <Show when={pty()?.startedAt}>
          {(at) => (
            <Tip label="Daemon uptime — survives kolu-server restarts, so this can exceed srv">
              <span class="tabular-nums text-fg-3">
                up {formatUptime(at(), now())}
              </span>
            </Tip>
          )}
        </Show>
      </span>
    </div>
  );
};

export default IdentityRail;
