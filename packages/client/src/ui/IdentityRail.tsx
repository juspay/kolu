/** IdentityRail — the "which kolu am I running" chrome readout.
 *
 *  The rail is deliberately glance-first: one Kolu health group and one Kaval
 *  health group. Each keeps its one visible version; memory, uptime, and exact
 *  build details live in hover text / dialogs unless they need attention
 *  (`≠ srv`, `⬆ update`, `mem ?`). The old all-numbers strip was useful for
 *  diagnostics but too dense as always-on chrome.
 *
 *  The server dot carries `data-ws-status` and the kaval dot
 *  `data-daemon-state` — the e2e hooks the smoke / reconnect / kaval-daemon
 *  scenarios read; exactly one element holds each. Live memory rides each chip's
 *  `aria-label`/tooltip (where the e2e asserts it); only a kaval memory-poll
 *  error surfaces its own visible chip, so the row never repaints as a process
 *  monitor. */

import { useSurfaceApp } from "@kolu/surface-app/solid";
import type { KoluBuildInfo } from "kolu-common/surface";
import { type Component, createMemo, createSignal, Show } from "solid-js";
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
import KoluInfoDialog from "./KoluInfoDialog";
import { formatMBCompact, mbText } from "./memory";
import { clientStale, StaleBadge } from "./StaleBadge";
import Tip from "./Tip";
import {
  clientHeapUsedBytes,
  kavalMemoryDisplay,
  serverRssBytes,
} from "./useMemoryUsage";

/** The thin vertical rule between compact status groups. */
const Divider: Component = () => (
  <span class="h-4 w-px self-center bg-edge-bright/60" />
);

/** A kaval memory poll error is visible because it is an actionable diagnostic
 *  anomaly; normal MB values stay in the real chip tooltip/aria-label. */
const KavalMemReadout: Component = () => (
  <Show when={kavalMemoryDisplay()?.kind === "error"}>
    <Tip label="kaval daemon memory poll failed — the daemon reports connected but didn't answer its memory probe">
      <span
        data-testid="kaval-memory-error"
        class="rounded-full border border-warning/40 px-1.5 text-[9px] leading-4 text-warning"
      >
        mem ?
      </span>
    </Tip>
  </Show>
);

/** Join the present segments of a chip tooltip with a middle dot. */
function joinTip(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(" · ");
}

const StatusDot: Component<{
  class: string;
  "data-ws-status"?: WsStatus;
  "data-daemon-state"?: string;
}> = (props) => (
  <span
    data-ws-status={props["data-ws-status"]}
    data-daemon-state={props["data-daemon-state"]}
    class={`inline-block h-2 w-2 rounded-full ${props.class}`}
  />
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
  const [koluDialogOpen, setKoluDialogOpen] = createSignal(false);
  const [kavalDialogOpen, setKavalDialogOpen] = createSignal(false);
  const stale = clientStale;
  const kavalVersion = (): string | undefined => daemon()?.contractVersion;

  // Memoized: the chip binds it to both `title` and `aria-label`, and it folds in
  // the per-second memory/uptime ticks — so build the string once per change.
  const koluTip = createMemo((): string => {
    const server = pwa.server();
    return joinTip(
      `kolu ${props.status}${daemonLive() ? "" : " (watchdog reconnecting)"}`,
      server?.version ? `server v${server.version}` : undefined,
      server?.commit ? `server ${server.commit}` : undefined,
      `server RSS ${mbText(serverRssBytes())}`,
      stale()
        ? "client build differs from server"
        : "client build matches server",
      pwa.clientCommit ? `client ${pwa.clientCommit}` : undefined,
      `client heap ${mbText(clientHeapUsedBytes())}`,
    );
  });

  const kavalStateText = (): string => {
    if (!daemonLive()) return "unknown";
    const state = daemon()?.state;
    return state ? DAEMON_STATE_PRESENTATION[state].label : "unknown";
  };

  const kavalUptimeText = (): string | undefined => {
    if (!daemonLive() || daemon()?.state !== "connected") return undefined;
    const startedAt = daemon()?.startedAt;
    return startedAt === undefined
      ? undefined
      : `running ${formatUptime(clockNow() - startedAt)}`;
  };

  const kavalMemoryText = (): string => {
    const display = kavalMemoryDisplay();
    if (display?.kind === "ok")
      return `RSS ${formatMBCompact(display.rssBytes)}`;
    if (display?.kind === "error") return "memory poll failed";
    return "memory unavailable";
  };

  const kavalTip = createMemo((): string =>
    joinTip(
      `kaval ${kavalStateText()}`,
      kavalVersion() ? `contract v${kavalVersion()}` : undefined,
      kavalUptimeText(),
      kavalMemoryText(),
      kavalUpdatePending() ? "newer build available" : undefined,
      "click for details",
    ),
  );

  return (
    <div class="inline-flex items-center gap-1 rounded-lg border border-edge bg-surface-2/60 px-1.5 py-0.5 font-mono text-xs shadow-sm shadow-black/20">
      <button
        type="button"
        data-testid="kolu-identity-chip"
        onClick={() => setKoluDialogOpen(true)}
        class="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 leading-4 text-fg-2 transition-colors hover:bg-surface-3/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        title={koluTip()}
        aria-label={koluTip()}
      >
        <StatusDot
          class={serverDot(props.status, daemonLive())}
          data-ws-status={props.status}
        />
        <span>Kolu</span>
        <Show when={pwa.server()?.version}>
          {(v) => <span class="tabular-nums text-fg-3">v{v()}</span>}
        </Show>
      </button>
      <Show when={stale()}>
        <StaleBadge />
      </Show>

      <Divider />

      <button
        type="button"
        data-testid="kaval-identity-chip"
        onClick={() => setKavalDialogOpen(true)}
        class="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 leading-4 text-fg-2 transition-colors hover:bg-surface-3/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        title={kavalTip()}
        aria-label={kavalTip()}
      >
        <StatusDot
          data-daemon-state={
            daemonLive() ? (daemon()?.state ?? "unknown") : "unknown"
          }
          class={kavalDot(daemon()?.state, daemonLive())}
        />
        <span>Kaval</span>
        <Show when={kavalVersion()}>
          {(v) => <span class="tabular-nums text-fg-3">contract v{v()}</span>}
        </Show>
      </button>
      <KavalMemReadout />
      <Show when={kavalUpdatePending()}>
        <KavalUpdateBadge />
      </Show>

      <KoluInfoDialog
        open={koluDialogOpen()}
        onOpenChange={setKoluDialogOpen}
        status={props.status}
        live={daemonLive()}
        dotClass={serverDot(props.status, daemonLive())}
      />
      <KavalInfoDialog
        open={kavalDialogOpen()}
        onOpenChange={setKavalDialogOpen}
        status={daemon()}
      />
    </div>
  );
};

export default IdentityRail;
