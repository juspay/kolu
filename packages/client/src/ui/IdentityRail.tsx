/** IdentityRail — the "which kolu am I running" chrome readout.
 *
 *  The rail is deliberately glance-first: three health groups, one per process in
 *  the ownership chain — Kolu (server + client), Padi (the per-host daemon that
 *  owns the terminals), and Kaval (the PTY daemon padi supervises). Each keeps its
 *  one visible version where the wire surfaces one (padi's doesn't reach the client,
 *  so its chip is logo + state only); memory, uptime, and exact build details live
 *  in hover text / dialogs unless they need attention (`≠ srv`, `⬆ update`,
 *  `mem ?`). The old all-numbers strip was useful for diagnostics but too dense as
 *  always-on chrome.
 *
 *  The server dot carries `data-ws-status`, the kaval dot `data-daemon-state`, and
 *  the padi dot `data-padi-link` — the e2e hooks the smoke / reconnect /
 *  kaval-daemon scenarios read; exactly one element holds each. Live memory rides
 *  each chip's `aria-label`/tooltip (where the e2e asserts it); only a padi/kaval
 *  memory-poll error surfaces its own visible chip, so the row never repaints as a
 *  process monitor. */

import { useSurfaceApp } from "@kolu/surface-app/solid";
import type { KoluBuildInfo } from "kolu-common/surface";
import {
  type Component,
  createMemo,
  createSignal,
  type JSX,
  Show,
} from "solid-js";
import { match, P } from "ts-pattern";
import { getClockNow } from "../time/clock";
import KavalInfoDialog, { KAVAL_LOGO_URL } from "../kaval/KavalInfoDialog";
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
  padiLinkState,
  serverDot,
} from "../kaval/useDaemonStatus";
import PadiInfoDialog, { PADI_LOGO_URL } from "../padi/PadiInfoDialog";
import {
  PADI_LINK_PRESENTATION,
  padiBoundHostSegment,
  padiDot,
} from "../padi/padiPresentation";
import type { WsStatus } from "../rpc/rpc";
import { activeHost, LOCAL_HOST } from "../binding/bindings";
import { activePadiSurfaceVersion } from "./useDaemonInventory";
import KoluInfoDialog from "./KoluInfoDialog";
import { formatMBCompact, mbText } from "./memory";
import { clientStale, StaleBadge } from "./StaleBadge";
import {
  clientHeapUsedBytes,
  kavalMemoryDisplay,
  padiMemoryDisplay,
  serverRssBytes,
} from "./useMemoryUsage";

/** The thin vertical rule between compact status groups. */
const Divider: Component = () => (
  <span class="mx-0.5 h-5 w-px self-center bg-edge-bright/60" />
);

const IdentityMark: Component<{
  logoSrc: string;
  children: JSX.Element;
}> = (props) => (
  <span class="relative grid h-5 w-5 shrink-0 place-items-center">
    <img src={props.logoSrc} alt="" class="h-4 w-4" />
    {props.children}
  </span>
);

/** A kaval memory poll error is visible because it is an actionable diagnostic
 *  anomaly; normal MB values stay in the real chip tooltip/aria-label. */
const KavalMemReadout: Component = () => (
  <Show when={kavalMemoryDisplay()?.kind === "error"}>
    <span
      data-testid="kaval-memory-error"
      class="rounded-full border border-warning/40 px-1.5 text-[9px] leading-4 text-warning"
    >
      mem ?
    </span>
  </Show>
);

/** The padi twin of {@link KavalMemReadout}: a padi memory-poll failure is a visible
 *  diagnostic anomaly; the normal RSS figure stays in the chip tooltip/aria-label. */
const PadiMemReadout: Component = () => (
  <Show when={padiMemoryDisplay()?.kind === "error"}>
    <span
      data-testid="padi-memory-error"
      class="rounded-full border border-warning/40 px-1.5 text-[9px] leading-4 text-warning"
    >
      mem ?
    </span>
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
  "data-padi-link"?: string;
}> = (props) => (
  <span
    data-ws-status={props["data-ws-status"]}
    data-daemon-state={props["data-daemon-state"]}
    data-padi-link={props["data-padi-link"]}
    class={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border border-surface-2 ${props.class}`}
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
  const [padiDialogOpen, setPadiDialogOpen] = createSignal(false);
  const [kavalDialogOpen, setKavalDialogOpen] = createSignal(false);
  const stale = clientStale;
  const kavalVersion = (): string | undefined => daemon()?.contractVersion;

  // Memoized: the chip binds it to both `title` and `aria-label`, and it folds in
  // the per-second memory/uptime ticks — so build the string once per change. padi's
  // RSS is no longer folded in here: padi now owns its own rail segment (below), so
  // its memory reads out on the Padi chip rather than beside the server's.
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

  // padi's connection state (from koluSurface's `padiLink` cell) for the Padi chip
  // — floored on transport liveness like the dot: a dead ws leaves the retained link
  // stale, so read "unknown" rather than a frozen definite state.
  const padiStateText = (): string => {
    if (!daemonLive()) return "unknown";
    const link = padiLinkState();
    return link ? PADI_LINK_PRESENTATION[link].label : "unknown";
  };

  const padiMemoryText = (): string =>
    match(padiMemoryDisplay())
      .with({ kind: "ok" }, (d) => `RSS ${formatMBCompact(d.rssBytes)}`)
      .with({ kind: "error" }, () => "memory poll failed")
      .with(P.nullish, () => "memory unavailable")
      .exhaustive();

  // The RUNNING padi's actual `padiSurface` version (off its control-core `hello`),
  // mirroring the kaval chip's `contract v<x.y>`. Honest `undefined` (no chip / tip
  // segment) when padi is unbound, never a fabricated build constant.
  const padiVersion = (): string | undefined =>
    activePadiSurfaceVersion() ?? undefined;

  // WHERE padi is: the `ssh · <host>` segment for a REMOTE binding, or null when
  // local (no host noise). W4 names the host THIS TAB is viewing (`activeHost()`),
  // not the server's default binding — so after a switch the chip reads the host you
  // actually see, and a per-host degraded state names the right machine. Rendered
  // through the pure `padiBoundHostSegment` source of truth.
  const padiHostSegment = (): string | null =>
    padiBoundHostSegment(activeHost() === LOCAL_HOST ? null : activeHost());

  const padiTip = createMemo((): string =>
    joinTip(
      `padi ${padiStateText()}`,
      padiHostSegment() ?? undefined,
      padiVersion() ? `contract v${padiVersion()}` : undefined,
      padiMemoryText(),
      "click for details",
    ),
  );

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

  const kavalMemoryText = (): string =>
    match(kavalMemoryDisplay())
      .with({ kind: "ok" }, (d) => `RSS ${formatMBCompact(d.rssBytes)}`)
      .with({ kind: "error" }, () => "memory poll failed")
      .with(P.nullish, () => "memory unavailable")
      .exhaustive();

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
    <div class="inline-flex items-center gap-0.5 rounded-xl border border-edge/90 bg-surface-2/80 px-1 py-1 font-mono text-xs shadow-sm shadow-black/25">
      <button
        type="button"
        data-testid="kolu-identity-chip"
        onClick={() => setKoluDialogOpen(true)}
        class="inline-flex h-7 items-center gap-2 rounded-lg px-2 leading-4 text-fg-2 transition-colors hover:bg-surface-3/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        title={koluTip()}
        aria-label={koluTip()}
      >
        <IdentityMark logoSrc="/favicon.svg">
          <StatusDot
            class={serverDot(props.status, daemonLive())}
            data-ws-status={props.status}
          />
        </IdentityMark>
        <span class="text-fg">Kolu</span>
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
        data-testid="padi-identity-chip"
        onClick={() => setPadiDialogOpen(true)}
        class="inline-flex h-7 items-center gap-2 rounded-lg px-2 leading-4 text-fg-2 transition-colors hover:bg-surface-3/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        title={padiTip()}
        aria-label={padiTip()}
      >
        <IdentityMark logoSrc={PADI_LOGO_URL}>
          <StatusDot
            data-padi-link={
              daemonLive() ? (padiLinkState() ?? "unknown") : "unknown"
            }
            class={padiDot(padiLinkState(), daemonLive())}
          />
        </IdentityMark>
        <span class="text-fg">Padi</span>
        <Show when={padiHostSegment()}>
          {(seg) => (
            <span data-testid="padi-bound-host" class="text-fg-3">
              {seg()}
            </span>
          )}
        </Show>
        <Show when={padiVersion()}>
          {(v) => <span class="tabular-nums text-fg-3">contract v{v()}</span>}
        </Show>
        <PadiMemReadout />
      </button>

      <Divider />

      <button
        type="button"
        data-testid="kaval-identity-chip"
        onClick={() => setKavalDialogOpen(true)}
        class="inline-flex h-7 items-center gap-2 rounded-lg px-2 leading-4 text-fg-2 transition-colors hover:bg-surface-3/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        title={kavalTip()}
        aria-label={kavalTip()}
      >
        <IdentityMark logoSrc={KAVAL_LOGO_URL}>
          <StatusDot
            data-daemon-state={
              daemonLive() ? (daemon()?.state ?? "unknown") : "unknown"
            }
            class={kavalDot(daemon()?.state, daemonLive())}
          />
        </IdentityMark>
        <span class="text-fg">Kaval</span>
        <Show when={kavalVersion()}>
          {(v) => <span class="tabular-nums text-fg-3">contract v{v()}</span>}
        </Show>
        <KavalMemReadout />
        <Show when={kavalUpdatePending()}>
          <KavalUpdateBadge />
        </Show>
      </button>

      <KoluInfoDialog
        open={koluDialogOpen()}
        onOpenChange={setKoluDialogOpen}
        status={props.status}
        live={daemonLive()}
        dotClass={serverDot(props.status, daemonLive())}
      />
      <PadiInfoDialog
        open={padiDialogOpen()}
        onOpenChange={setPadiDialogOpen}
        link={padiLinkState()}
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
