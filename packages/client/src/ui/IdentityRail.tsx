/** IdentityRail — the consolidated "which kolu am I running" chrome readout
 *  (R-4 A2, extended in B2). A three-column `srv · client · kaval` rail:
 *  `srv` is the server you're connected to (its commit + the WebSocket liveness
 *  dot), `client` is this browser's JS build, and `kaval` is the pty-host daemon
 *  serving your terminals.
 *
 *  Before B2 the pty-host ran in-process, so its column was a no-op duplicate of
 *  `srv` and stayed commented out. B2 makes kaval a separate, spawned daemon, so
 *  the column is live: its **dot** is the supervisor's honest daemon state
 *  (`connected`/`degraded`/`dead` — not the WebSocket's), its **uptime** is
 *  derived from the daemon's `startedAt`, and its commit + closure-hash come from
 *  surface-app's `buildInfo.ptyHost` axis (the staleKey the B-phase "update
 *  pending" derivation will read). The daemon state rides the `daemonStatus`
 *  surface collection (`useDaemonStatus`), not a prop, so desktop and mobile
 *  chrome read the same source.
 *
 *  The `client` column is the commit this browser's JS was built from; when both
 *  refs are clean and disagree it flags `≠ srv` (a stale bundle served from
 *  cache against a freshly deployed server). */

import { useSurfaceApp } from "@kolu/surface-app/solid";
import type { DaemonState, KoluBuildInfo } from "kolu-common/surface";
import {
  type Accessor,
  type Component,
  createSignal,
  onCleanup,
  Show,
} from "solid-js";
import { createSharedRoot } from "../createSharedRoot";
import KavalInfoDialog from "../KavalInfoDialog";
import { localDaemonStatus } from "../useDaemonStatus";
import type { WsStatus } from "../rpc/rpc";
import Commit from "./Commit";
import { clientStale, StaleBadge } from "./StaleBadge";
import Tip from "./Tip";

/** WebSocket transport status → the `srv` liveness dot. */
const srvDot: Record<WsStatus, string> = {
  connecting: "bg-warning animate-pulse",
  open: "bg-ok",
  closed: "bg-danger",
};

/** The daemon's honest state → the `kaval` dot. Distinct from the WebSocket dot:
 *  a live WS link says nothing about whether the daemon behind the server is up.
 *  Undefined (status still loading) is grey, not red — we don't claim "dead"
 *  before the first yield. */
function kavalDot(state: DaemonState | undefined): string {
  switch (state) {
    case "connected":
      return "bg-ok";
    case "connecting":
      return "bg-warning animate-pulse";
    case "degraded":
    case "dead":
      return "bg-danger";
    default:
      return "bg-fg-3/50";
  }
}

/** Short-form a build id for display: a nix store hash's leading 7 chars, or a
 *  path basename capped at 12. The full id lives in the tooltip. */
function shortId(id: string | null | undefined): string {
  if (!id) return "—";
  const hash = /^([a-z0-9]{7})/.exec(id);
  if (hash) return hash[1] as string;
  const tail = id.split("/").pop() ?? id;
  return tail.length > 12 ? `${tail.slice(0, 12)}…` : tail;
}

/** Compact human uptime from a boot epoch — `45s`, `12m`, `3h 20m`, `2d 4h`. */
function formatUptime(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ${min % 60}m`;
  return `${Math.floor(hr / 24)}d ${hr % 24}h`;
}

// A coarse 30s clock so the kaval uptime advances without a per-second timer.
// One shared owner for the desktop + mobile rails (the `createSharedRoot`
// singleton idiom shared with `staleness.ts`/`useDockOrder`), so the interval
// is owned and its `onCleanup` clears it — never an orphaned module-level timer
// that leaks under HMR or a test teardown.
const getClockNow = createSharedRoot<Accessor<number>>(() => {
  const [now, setNow] = createSignal(Date.now());
  const id = setInterval(() => setNow(Date.now()), 30_000);
  onCleanup(() => clearInterval(id));
  return now;
});

const IdentityRail: Component<{ status: WsStatus }> = (props) => {
  // The server's build identity (commit + the pty-host column) rides
  // surface-app's `buildInfo` cell; `clientCommit` is this bundle's baked commit.
  const pwa = useSurfaceApp<KoluBuildInfo>();
  // The shared 30s uptime clock — owned by the app root, cleaned up with it.
  const clockNow = getClockNow();
  // The kaval daemon's live status — read once per render (the column reads its
  // state, dot, identity, and uptime), not re-resolved per use.
  const daemon = localDaemonStatus;
  const [kavalDialogOpen, setKavalDialogOpen] = createSignal(false);
  // A genuinely outdated client — old bundle against a freshly deployed server.
  // Shared with the mobile chrome via `StaleBadge`.
  const stale = clientStale;

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
      {/* The kaval column reads its identity from the SAME daemonStatus source
          as the dot + uptime (not buildInfo.ptyHost — that's the pre-B2
          in-process axis the out-of-process daemon doesn't populate). The whole
          column is a button: click it for the daemon details + how to reach
          these terminals from `kaval-tui`. */}
      <button
        type="button"
        onClick={() => setKavalDialogOpen(true)}
        class="inline-flex items-center gap-1.5 rounded px-2 py-0.5 transition-colors hover:bg-surface-3/50"
        title="kaval daemon — click for details and how to attach with kaval-tui"
      >
        <span class="text-[9px] uppercase tracking-wide text-fg-3">kaval</span>
        <span
          data-daemon-state={daemon()?.state ?? "unknown"}
          class={`inline-block h-[7px] w-[7px] rounded-full ${kavalDot(
            daemon()?.state,
          )}`}
        />
        <Commit sha={daemon()?.identity?.navigableCommit} />
        <Show when={daemon()?.identity?.staleKey}>
          {(key) => (
            <span class="border-b border-dotted border-fg-3/50 text-[10px] text-fg-3">
              {shortId(key())}
            </span>
          )}
        </Show>
        <Show when={daemon()?.startedAt}>
          {(startedAt) => (
            <span class="tabular-nums text-[10px] text-fg-3">
              {formatUptime(clockNow() - startedAt())}
            </span>
          )}
        </Show>
      </button>
      <KavalInfoDialog
        open={kavalDialogOpen()}
        onOpenChange={setKavalDialogOpen}
        status={daemon()}
      />
    </div>
  );
};

export default IdentityRail;
