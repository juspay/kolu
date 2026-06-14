/** IdentityRail — the "which kolu am I running" chrome readout.
 *
 *  Three identities ride this rail: `srv` (the server you're connected to + the
 *  WebSocket liveness), `client` (this browser's JS build), and `kaval` (the
 *  pty-host daemon serving your terminals). In a clean deploy all three are built
 *  from one HEAD, so the old three-column rail printed the SAME commit three times
 *  behind three labels — noise for the one bit a calm user reads: "in sync, alive".
 *
 *  So the rail **collapses when everything agrees** and **fans back out when a
 *  source diverges** (the design note: `docs/atlas/chrome-bar-declutter`):
 *
 *  - **Calm (the ~95% case):** one *worst-of* health dot + the version + the one
 *    shared commit. Hover for the per-source breakdown (the `<Tip>`); click the `▸`
 *    for the daemon deep-store (`KavalInfoDialog`). Nothing is lost, it just stops
 *    shouting.
 *  - **Diverged:** the offending source re-materializes inline with its own dot,
 *    commit and actionable chip — `≠ srv` (stale bundle), `⬆ update` (kaval a build
 *    behind), a red daemon, or a down/connecting socket. Louder than before, never
 *    quieter: the alarm is exactly what the rail was built to show.
 *
 *  The single resting dot carries BOTH `data-ws-status` and `data-daemon-state`
 *  (the per-axis dots are gone from the strip) — those are the e2e hooks the
 *  smoke / reconnect / kaval-daemon scenarios read, so they stay on whatever dot
 *  now owns each axis, and exactly one element holds `data-ws-status`. */

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
  daemonWarming,
  downState,
  formatUptime,
  localDaemonStatus,
  nudgeDot,
  toneDot,
  wsDot,
} from "../kaval/useDaemonStatus";
import type { WsStatus } from "../rpc/rpc";
import Commit from "./Commit";
import { clientStale, StaleBadge } from "./StaleBadge";
import Tip from "./Tip";

/** The daemon's honest state → the `kaval` tone, via the shared presentation
 *  table (so the rail and the dialog can't drift); undefined (status still
 *  loading) is grey, not red — we don't claim "dead" before the first yield. */
function kavalDot(state: DaemonState | undefined): string {
  if (!state) return "bg-fg-3/50";
  return toneDot[DAEMON_STATE_PRESENTATION[state].tone];
}

/** Short-form a build id for display: a nix store hash's leading 7 chars, or a
 *  path basename capped at 12. The full id lives in the dialog. */
function shortId(id: string | null | undefined): string {
  if (!id) return "—";
  const hash = /^([a-z0-9]{7})/.exec(id);
  if (hash) return hash[1] as string;
  const tail = id.split("/").pop() ?? id;
  return tail.length > 12 ? `${tail.slice(0, 12)}…` : tail;
}

// A 1s clock so the kaval uptime in the breakdown ticks live rather than freezing
// at mount-time. One shared owner for any rail that reads it (the `createSharedRoot`
// singleton idiom shared with `staleness.ts`/`useDockOrder`), so the single
// interval is owned and its `onCleanup` clears it — never an orphaned module-level
// timer that leaks under HMR or a test teardown.
const getClockNow = createSharedRoot<Accessor<number>>(() => {
  const [now, setNow] = createSignal(Date.now());
  const id = setInterval(() => setNow(Date.now()), 1_000);
  onCleanup(() => clearInterval(id));
  return now;
});

/** The thin vertical rule between the resting identity and a fanned-out source. */
const Divider: Component = () => (
  <span class="mx-0.5 h-4 w-px self-center bg-edge-bright/70" />
);

const IdentityRail: Component<{ status: WsStatus }> = (props) => {
  // The server's build identity rides surface-app's `buildInfo` cell; `clientCommit`
  // is this bundle's baked commit. Read here in the parent (under the provider) so
  // the portalled breakdown tooltip never calls `useSurfaceApp` outside the tree.
  const pwa = useSurfaceApp<KoluBuildInfo>();
  const clockNow = getClockNow();
  const daemon = localDaemonStatus;
  const [kavalDialogOpen, setKavalDialogOpen] = createSignal(false);
  const stale = clientStale;

  // The single resting dot: worst-of across the WS link and the daemon, resolved
  // through the shared tone receptacles (wsDot/kavalDot/nudgeDot/toneDot, no new tone
  // table). The link wins when it's down (identity is untrustworthy with no server to
  // read), then an unknown daemon stays grey — never a false-green before the first
  // status yield (#1034) — then a down/warming daemon, then the amber currency nudges,
  // else all-clear.
  const unifiedDot = (): string => {
    if (props.status !== "open") return wsDot(props.status);
    const state = daemon()?.state;
    if (!state) return kavalDot(undefined);
    if (downState() || daemonWarming()) return kavalDot(state);
    if (stale() || kavalUpdatePending()) return nudgeDot;
    return toneDot.ok;
  };

  // The kaval source fans out when it's behind (⬆ update) or not cleanly running.
  const kavalDiverged = (): boolean =>
    kavalUpdatePending() || !!downState() || daemonWarming();

  const uptime = (): string | undefined => {
    const t = daemon()?.startedAt;
    return t === undefined ? undefined : formatUptime(clockNow() - t);
  };

  // The per-source split the resting strip collapses away — shown on hover. Built
  // here (in the provider's reactive scope) so its reads stay live across the portal.
  const breakdown = () => (
    <div class="flex min-w-[12rem] flex-col gap-1 font-mono text-[11px]">
      <div class="flex items-center gap-2">
        <span class="w-12 text-[9px] uppercase tracking-wide text-fg-3">
          srv
        </span>
        <span class={`h-[6px] w-[6px] rounded-full ${wsDot(props.status)}`} />
        <span class="flex-1 text-fg-2">{pwa.server()?.commit ?? "—"}</span>
        <Show when={pwa.server()?.version}>
          {(v) => <span class="text-fg-3">v{v()}</span>}
        </Show>
      </div>
      <div class="flex items-center gap-2">
        <span class="w-12 text-[9px] uppercase tracking-wide text-fg-3">
          client
        </span>
        <span
          class={`h-[6px] w-[6px] rounded-full ${stale() ? nudgeDot : toneDot.ok}`}
        />
        <span class="flex-1 text-fg-2">{pwa.clientCommit ?? "—"}</span>
      </div>
      <div class="flex items-center gap-2">
        <span class="w-12 text-[9px] uppercase tracking-wide text-fg-3">
          kaval
        </span>
        <span
          class={`h-[6px] w-[6px] rounded-full ${kavalDot(daemon()?.state)}`}
        />
        <span class="flex-1 text-fg-2">
          {daemon()?.identity?.navigableCommit ?? "—"}
        </span>
        <Show when={daemon()?.identity?.staleKey}>
          {(key) => <span class="text-fg-3">{shortId(key())}</span>}
        </Show>
        <Show when={uptime()}>
          {(u) => <span class="tabular-nums text-fg-3">{u()}</span>}
        </Show>
      </div>
    </div>
  );

  const dialogTitle = (): string =>
    kavalUpdatePending()
      ? "kaval — a newer build is available; click to restart and pick it up"
      : "kaval daemon — click for details and how to attach with kaval-tui";

  return (
    <div class="inline-flex items-stretch rounded-lg border border-edge bg-surface-2/60 px-1 py-0.5 font-mono text-xs">
      {/* The unified identity — one worst-of dot + version + the one shared commit.
          The dot carries both machine-readable axes (the e2e hooks); the leading seg
          is the `<Tip>` trigger, so hovering the identity reveals the breakdown. */}
      <Tip
        label={breakdown()}
        class="inline-flex items-center gap-1.5 px-1.5 py-0.5"
      >
        <span
          data-ws-status={props.status}
          data-daemon-state={daemon()?.state ?? "unknown"}
          class={`inline-block h-[7px] w-[7px] rounded-full ${unifiedDot()}`}
        />
        <Show when={pwa.server()?.version}>
          {(v) => <span class="tabular-nums text-fg-2">v{v()}</span>}
        </Show>
        {/* Dropped while the socket is down — we can't vouch for identity with no
            server to read it from; the `srv` fan-out names the outage instead. */}
        <Show when={props.status === "open"}>
          <Commit sha={pwa.server()?.commit} />
        </Show>
      </Tip>

      {/* ── Fan-outs: only the diverging source(s) re-materialize inline ── */}

      {/* The socket itself is the problem — server unreachable / reconnecting. */}
      <Show when={props.status !== "open"}>
        <Divider />
        <span class="inline-flex items-center gap-1.5 px-1.5 py-0.5">
          <span class="text-[9px] uppercase tracking-wide text-fg-3">srv</span>
          <span class="text-danger">
            {props.status === "closed" ? "offline" : "reconnecting…"}
          </span>
        </span>
      </Show>

      {/* Stale client bundle — the actionable `≠ srv` nudge, with its own commit. */}
      <Show when={stale()}>
        <Divider />
        <span
          class="inline-flex items-center gap-1.5 px-1.5 py-0.5"
          title="This client build doesn't match the server — reload to pick up the server's version."
        >
          <span class="text-[9px] uppercase tracking-wide text-fg-3">
            client
          </span>
          <Commit sha={pwa.clientCommit} />
          <StaleBadge />
        </span>
      </Show>

      {/* kaval behind (⬆ update) or not cleanly running — its own dot + detail. */}
      <Show when={kavalDiverged()}>
        <Divider />
        <span class="inline-flex items-center gap-1.5 px-1.5 py-0.5">
          <span class="text-[9px] uppercase tracking-wide text-fg-3">
            kaval
          </span>
          <span
            class={`inline-block h-[7px] w-[7px] rounded-full ${kavalDot(daemon()?.state)}`}
          />
          <Show
            when={!!downState() || daemonWarming()}
            fallback={
              <>
                <Show when={daemon()?.identity?.staleKey}>
                  {(key) => (
                    <span class="border-b border-dotted border-fg-3/50 text-[10px] text-fg-3">
                      {shortId(key())}
                    </span>
                  )}
                </Show>
                <KavalUpdateBadge />
              </>
            }
          >
            <Show when={daemon()?.state}>
              {(s) => (
                <span class="text-fg-2">
                  {DAEMON_STATE_PRESENTATION[s()].label}
                </span>
              )}
            </Show>
          </Show>
        </span>
      </Show>

      {/* The deep-store affordance — the one click target (so the server commit
          stays a normal link, no nested interactives). Opens KavalInfoDialog:
          daemon details, the session-preserving restart, kaval-tui attach. */}
      <button
        type="button"
        onClick={() => setKavalDialogOpen(true)}
        class="inline-flex items-center self-center rounded px-1 text-fg-3 transition-colors hover:bg-surface-3/50 hover:text-fg"
        title={dialogTitle()}
        aria-label="kaval daemon details"
      >
        <span aria-hidden="true">▸</span>
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
