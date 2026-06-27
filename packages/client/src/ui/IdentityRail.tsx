/** IdentityRail — the "which kolu am I running" chrome readout.
 *
 *  Three columns — `srv` (the server you're connected to + the WebSocket
 *  liveness), `client` (this browser's JS build), and `kaval` (the pty-host
 *  daemon serving your terminals). In a clean deploy all three are built from one
 *  HEAD, so the rail used to print the SAME commit three times. The commit now
 *  shows **once**, in `srv` (the canonical identity):
 *
 *  - `client` collapses to a muted `≡` when its build matches the server, and
 *    only spells out its own commit + the actionable `≠ srv` chip when a stale
 *    cached bundle disagrees (`clientStale`).
 *  - `kaval` keeps its dot · uptime and stays a button onto `KavalInfoDialog`
 *    (daemon details, the session-preserving restart, `kaval-tui` attach). Its
 *    build commit + nix closure-hash live in that dialog now, not on the strip;
 *    the amber `⬆ update` chip still surfaces inline when the running daemon is a
 *    build behind what the server would spawn (`kavalUpdatePending`).
 *
 *  The `srv` dot carries `data-ws-status` and the `kaval` dot `data-daemon-state`
 *  — the e2e hooks the smoke / reconnect / kaval-daemon scenarios read; exactly
 *  one element holds each. */

import { useSurfaceApp } from "@kolu/surface-app/solid";
import type { KoluBuildInfo } from "kolu-common/surface";
import { type Component, createSignal, Match, Show, Switch } from "solid-js";
import { getClockNow } from "../time/clock";
import KavalInfoDialog from "../kaval/KavalInfoDialog";
import {
  KavalUpdateBadge,
  kavalUpdatePending,
} from "../kaval/KavalUpdateBadge";
import {
  DAEMON_STATE_PRESENTATION,
  daemonTransportLive,
  formatUptime,
  kavalDot,
  localDaemonStatus,
  serverDot,
} from "../kaval/useDaemonStatus";
import type { WsStatus } from "../rpc/rpc";
import Commit from "./Commit";
import { formatMBCompact } from "./memory";
import { clientStale, StaleBadge } from "./StaleBadge";
import Tip from "./Tip";
import {
  clientHeapUsedBytes,
  kavalMemoryDisplay,
  serverRssBytes,
} from "./useMemoryUsage";

/** The thin vertical rule between two columns. */
const Divider: Component = () => (
  <span class="mx-0.5 h-4 w-px self-center bg-edge-bright/70" />
);

/** A compact whole-MB memory readout for a rail column — hidden until the figure
 *  is present (undefined pre-yield, or `null` when there's nothing to measure:
 *  no kaval daemon, or a non-Chromium browser with no `performance.memory`). The
 *  `data-testid` lets the e2e assert each source's reading independently. */
const MemReadout: Component<{
  bytes: number | null;
  testid: string;
  tip: string;
}> = (props) => (
  <Show when={props.bytes}>
    {(bytes) => (
      <Tip label={props.tip}>
        <span
          data-testid={props.testid}
          class="tabular-nums text-[10px] text-fg-3"
        >
          {formatMBCompact(bytes())}
        </span>
      </Tip>
    )}
  </Show>
);

/** The kaval column's memory readout, from the shared {@link kavalMemoryDisplay}
 *  derivation (which folds in the connected-now gate + the three-way unwrap, so
 *  this and the Diagnostic dialog read one source). `ok` renders the MB figure;
 *  `error` (a believed-connected daemon whose poll failed) renders a distinct
 *  `mem ?` chip so a failed poll never looks identical to "no daemon"; `null`
 *  (not connected / absent) renders nothing. */
const KavalMemReadout: Component = () => (
  <Switch>
    <Match
      when={(() => {
        const d = kavalMemoryDisplay();
        return d?.kind === "ok" ? d : false;
      })()}
    >
      {(ok) => (
        <MemReadout
          bytes={ok().rssBytes}
          testid="kaval-memory"
          tip="kaval daemon memory (resident set size)"
        />
      )}
    </Match>
    <Match when={kavalMemoryDisplay()?.kind === "error"}>
      <Tip label="kaval daemon memory poll failed — the daemon reports connected but didn't answer its memory probe">
        <span
          data-testid="kaval-memory-error"
          class="tabular-nums text-[10px] text-warning"
        >
          mem ?
        </span>
      </Tip>
    </Match>
  </Switch>
);

const IdentityRail: Component<{ status: WsStatus }> = (props) => {
  // The server's build identity rides surface-app's `buildInfo` cell; `clientCommit`
  // is this bundle's baked commit.
  const pwa = useSurfaceApp<KoluBuildInfo>();
  const clockNow = getClockNow();
  const daemon = localDaemonStatus;
  // The watchdog-backed liveness of the ws delivering daemonStatus. The kaval dot
  // AND its uptime floor on this: a dead/half-open link can't refresh the retained
  // daemon state, so the column reads "unknown" rather than a stale definite
  // "running" + a uptime climbing off the local clock (the #1568 green-dot class).
  const daemonLive = daemonTransportLive;
  const [kavalDialogOpen, setKavalDialogOpen] = createSignal(false);
  const stale = clientStale;

  const dialogTitle = (): string =>
    kavalUpdatePending()
      ? "kaval — a newer build is available; click to restart and pick it up"
      : "kaval daemon — click for details and how to attach with kaval-tui";

  return (
    <div class="inline-flex items-stretch rounded-lg border border-edge bg-surface-2/60 p-0.5 font-mono text-xs">
      {/* srv — the one canonical identity: WS-dot · version · the shared commit. */}
      <span class="inline-flex items-center gap-1.5 px-2 py-0.5">
        <span class="text-[9px] uppercase tracking-wide text-fg-3">srv</span>
        <Tip label="Server connection">
          <span
            data-ws-status={props.status}
            // Floored on the watchdog-backed `daemonLive()` (the kolu ws's
            // `health().live`), so a silent half-open the watchdog already caught
            // can't paint a definite green "connected" while the open/close-only
            // lifecycle still reads `open`. Same fact the kaval dot floors on.
            class={`inline-block h-[7px] w-[7px] rounded-full ${serverDot(props.status, daemonLive())}`}
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
        <MemReadout
          bytes={serverRssBytes()}
          testid="server-memory"
          tip="kolu-server memory (resident set size)"
        />
      </span>

      <Divider />

      {/* client — this browser's bundle. Collapses to a muted `≡` when it matches
          the server; spells out its own commit + the `≠ srv` nudge only when a
          stale cached bundle disagrees. */}
      <span class="inline-flex items-center gap-1.5 px-2 py-0.5">
        <span class="text-[9px] uppercase tracking-wide text-fg-3">client</span>
        <Show
          when={stale()}
          fallback={
            <Tip label="This browser's build matches the server.">
              <span class="text-fg-3">≡</span>
            </Tip>
          }
        >
          <Tip label="This browser's JS build (baked in at build time)">
            <Commit sha={pwa.clientCommit} />
          </Tip>
          <Tip label="This client build doesn't match the server — reload to pick up the server's version.">
            <StaleBadge />
          </Tip>
        </Show>
        <MemReadout
          bytes={clientHeapUsedBytes()}
          testid="client-memory"
          tip="This browser's JS heap (used)"
        />
      </span>

      <Divider />

      {/* kaval — the daemon serving your terminals. The whole column is a button:
          click it for the daemon details, the restart, the running build + closure
          hash, and how to reach these terminals from `kaval-tui`. */}
      <button
        type="button"
        onClick={() => setKavalDialogOpen(true)}
        class="inline-flex items-center gap-1.5 rounded px-2 py-0.5 transition-colors hover:bg-surface-3/50"
        title={dialogTitle()}
      >
        <span class="text-[9px] uppercase tracking-wide text-fg-3">kaval</span>
        <span
          // Dot floored on transport liveness (`kavalDot(state, live)`): a non-ok
          // state can only refine WITHIN a live link, never paint a definite bg-ok
          // "running" over a dead/half-open channel that left the state stale.
          data-daemon-state={
            daemonLive() ? (daemon()?.state ?? "unknown") : "unknown"
          }
          class={`inline-block h-[7px] w-[7px] rounded-full ${kavalDot(daemon()?.state, daemonLive())}`}
        />
        {/* Live link: connected → live uptime; any other known state → its label
            ("not running", "restarting…"); unknown (pre-first-yield) → nothing.
            Dead/half-open link: the retained state is stale and the channel that
            would refresh it is gone, so show a neutral "—" — never a definite label
            or a uptime that climbs off the local clock while contact is lost. */}
        <Show
          when={daemonLive()}
          fallback={<span class="text-[10px] text-fg-3/60">—</span>}
        >
          <Show when={daemon()?.state}>
            {(state) => (
              <Show
                when={state() === "connected"}
                fallback={
                  <span class="text-[10px] text-fg-3">
                    {DAEMON_STATE_PRESENTATION[state()].label}
                  </span>
                }
              >
                <Show when={daemon()?.startedAt}>
                  {(t) => (
                    <span class="tabular-nums text-[10px] text-fg-3">
                      {formatUptime(clockNow() - t())}
                    </span>
                  )}
                </Show>
              </Show>
            )}
          </Show>
        </Show>
        <KavalMemReadout />
        {/* B3.4: the running daemon is a build behind what the server would spawn.
            A passive amber chip — the column's own click opens the dialog where
            the running-vs-expected detail and the restart live. */}
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
