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
 *  derived from the daemon's `startedAt`, and its commit + closure-hash are the
 *  daemon's REPORTED identity, read from the `daemonStatus` surface collection
 *  (`useDaemonStatus`), not a prop, so desktop and mobile chrome read the same
 *  source. B3.4 adds an amber **⬆ update** chip when that reported `staleKey`
 *  differs from `buildInfo.expectedKaval` (the build the server would spawn) —
 *  the read-site currency nudge ({@link kavalUpdatePending}).
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
import KavalInfoDialog from "../kaval/KavalInfoDialog";
import {
  KavalUpdateBadge,
  kavalUpdatePending,
} from "../kaval/KavalUpdateBadge";
import {
  DAEMON_STATE_PRESENTATION,
  formatUptime,
  localDaemonStatus,
  toneDot,
} from "../kaval/useDaemonStatus";
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
 *  The per-state tone is the shared `DAEMON_STATE_PRESENTATION` projection (so
 *  the rail and the dialog can't drift); undefined (status still loading) is
 *  grey, not red — we don't claim "dead" before the first yield. */
function kavalDot(state: DaemonState | undefined): string {
  if (!state) return "bg-fg-3/50";
  return toneDot[DAEMON_STATE_PRESENTATION[state].tone];
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

// A 1s clock so the kaval uptime ticks live (`15s → 16s → …`) rather than
// jumping in 30s steps that read as frozen — a freshly (re)started daemon's
// sub-minute uptime would otherwise sit unchanged until the next coarse tick,
// only "correcting" on a full reload (which re-reads `Date.now()` at mount).
// One shared owner for the desktop + mobile rails (the `createSharedRoot`
// singleton idiom shared with `staleness.ts`/`useDockOrder`), so the single
// interval is owned and its `onCleanup` clears it — never an orphaned
// module-level timer that leaks under HMR or a test teardown. Cost is one
// signal tick/sec feeding one small `<span>`; above a minute `formatUptime`
// collapses to coarser units, so the rendered text only changes when it must.
const getClockNow = createSharedRoot<Accessor<number>>(() => {
  const [now, setNow] = createSignal(Date.now());
  const id = setInterval(() => setNow(Date.now()), 1_000);
  onCleanup(() => clearInterval(id));
  return now;
});

const IdentityRail: Component<{ status: WsStatus }> = (props) => {
  // The server's build identity (commit + the pty-host column) rides
  // surface-app's `buildInfo` cell; `clientCommit` is this bundle's baked commit.
  const pwa = useSurfaceApp<KoluBuildInfo>();
  // The shared 1s uptime clock — owned by the app root, cleaned up with it.
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
      {/* The kaval column reads the daemon's REPORTED identity (dot · commit ·
          staleKey · uptime) from the `daemonStatus` collection. `buildInfo`
          carries the server's EXPECTED kaval (`expectedKaval`) instead — the
          amber update-pending chip below compares the two. The whole column is a
          button: click it for the daemon details, the restart, and how to reach
          these terminals from `kaval-tui`. */}
      <button
        type="button"
        onClick={() => setKavalDialogOpen(true)}
        class="inline-flex items-center gap-1.5 rounded px-2 py-0.5 transition-colors hover:bg-surface-3/50"
        title={
          kavalUpdatePending()
            ? "kaval — a newer build is available; click to restart and pick it up"
            : "kaval daemon — click for details and how to attach with kaval-tui"
        }
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
        {/* B3.4: the running daemon is a build behind what the server would
            spawn. A passive amber chip (not a nested button) — the column's own
            click opens the dialog where the restart lives. */}
        <Show when={kavalUpdatePending()}>
          <KavalUpdateBadge />
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
