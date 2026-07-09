/** Per-host Padi + Kaval dual marks for every host chip (host-first chrome).
 *
 *  Mounted INSIDE every `HostChip` as a FIXED-width dual-daemon slot. The outer
 *  box is always the same size; every non-measure chip **fills** it with that
 *  host's own Padi + Kaval marks (not only the active host). Inactive hosts
 *  used to leave the reserve empty — glanceability across the pool required
 *  switching first. Measure-row twins stay empty so width is reserved without
 *  a second live mount pair.
 *
 *  Each sub-chip keys off `props.host` via `padiMap.entry(host)` (entry state,
 *  identity, daemonStatus) — never the free `activeHost` alone. Click switches
 *  to that host before opening the info dialog, matching master: the dialog's
 *  active-host detail sections stay complete rather than being hidden for
 *  inactive chips.
 *
 *  COMPACTION: resting state is icon + status dot only. Steady versions,
 *  memory, and update detail live in the Tip / dialogs. */

import {
  type DaemonStatus,
  encodeHostLocation,
  LOCAL_LOCATION,
} from "@kolu/padi/surface";
import type { EntryState } from "@kolu/surface-map";
import type { HostKey } from "kolu-common/hostKey";
import type { PadiLink } from "kolu-common/surface";
import type {
  PadiEntryStatus,
  SkewVersionPair,
} from "kolu-common/surfacesWithPadi";
import type { Component } from "solid-js";
import { createSignal, Show } from "solid-js";
import { match, P } from "ts-pattern";
import { toast } from "solid-sonner";
import KavalInfoDialog, { KAVAL_LOGO_URL } from "../kaval/KavalInfoDialog";
import { kavalStale } from "../kaval/kavalCurrency";
import {
  DAEMON_STATE_PRESENTATION,
  daemonTransportLive,
  formatUptime,
  kavalDot,
} from "../kaval/useDaemonStatus";
import { channelLive } from "../kaval/daemonPresentation";
import PadiInfoDialog, { PADI_LOGO_URL } from "../padi/PadiInfoDialog";
import { padiDot } from "../padi/padiPresentation";
import { getClockNow } from "../time/clock";
import {
  dualDaemonSlotClass,
  IdentityMark,
  identityMarkBtnClass,
  identityMarkStaticClass,
  StatusDot,
} from "../ui/IdentityMark";
import { joinTip } from "../ui/joinTip";
import { formatMBCompact } from "../ui/memory";
import Tip from "../ui/Tip";
import { activeHost, padiMap, setActiveHost } from "../wire";
import { sameHost, statusTitle } from "./hostChipTone";

/** Map entry → dialog's legacy `PadiLink` vocabulary. Exhaustive on kind. */
const ENTRY_AS_PADI_LINK: Record<EntryState["kind"], PadiLink | undefined> = {
  connected: "connected",
  warming: "connecting",
  failed: "degraded",
  "not-a-member": undefined,
};
function entryAsPadiLink(state: EntryState): PadiLink | undefined {
  return ENTRY_AS_PADI_LINK[state.kind];
}

function skewPairFor(host: HostKey): SkewVersionPair | undefined {
  const state = padiMap.entry(host).state() as PadiEntryStatus;
  if (state.kind !== "failed" || state.cause !== "contract-skew-refused")
    return undefined;
  const { running, expected } = state as SkewVersionPair;
  return { running, expected };
}

function hostLabel(h: HostKey): string {
  return h.kind === "local" ? "local" : h.target;
}

/** The Padi sub-chip for one host — icon + that host's entry-state dot.
 *  Click switches to that host, then opens the complete info panel. */
const PadiSubChip: Component<{ host: HostKey }> = (props) => {
  const [open, setOpen] = createSignal(false);
  let triggerEl!: HTMLButtonElement;
  const daemonLive = daemonTransportLive;
  const entry = (): EntryState => padiMap.entry(props.host).state();
  const padiLive = (): boolean => daemonLive();
  /** True when this chip is the canvas's active host. */
  const isCanvasHost = () => sameHost(activeHost(), props.host);
  const openForHost = (): void => {
    const alreadyActive = isCanvasHost();
    if (!alreadyActive) setActiveHost(props.host);
    setOpen((v) => (alreadyActive ? !v : true));
  };
  // Per-host identity (version for the tip).
  const identity = padiMap.entry(props.host).cells.identity.use({
    onError: (err: Error) => toast.error(`Padi identity error: ${err.message}`),
  });
  // Per-host process memory (tip only).
  const processMemory = padiMap.entry(props.host).cells.processMemory.use({
    onError: (err: Error) =>
      toast.error(`Padi/kaval memory error: ${err.message}`),
  });
  const padiVersion = (): string | undefined =>
    identity.value()?.surfaceVersion;
  const padiStartedAt = (): number | null => {
    const raw = identity.value()?.startedAt;
    if (raw === undefined) return null;
    return padiMap.entry(props.host).clock.toLocal(raw) ?? null;
  };
  const padiMemoryText = (): string => {
    if (!daemonLive()) return "memory unavailable";
    const m = processMemory.value()?.padi;
    return match(m)
      .with({ status: "ok" }, (d) => `RSS ${formatMBCompact(d.rssBytes)}`)
      .with({ status: "error" }, () => "memory poll failed")
      .with({ status: "absent" }, () => "memory unavailable")
      .with(P.nullish, () => "memory unavailable")
      .exhaustive();
  };
  const padiTip = (): string => {
    const skew = skewPairFor(props.host);
    return joinTip(
      `padi ${daemonLive() ? statusTitle(entry()) : "unknown"}`,
      skew
        ? `contract skew v${skew.running} → v${skew.expected}`
        : padiVersion()
          ? `contract v${padiVersion()}`
          : undefined,
      padiMemoryText(),
      "click for details",
    );
  };
  const linkForDialog = (): PadiLink | undefined =>
    padiLive() ? entryAsPadiLink(entry()) : undefined;

  return (
    <>
      <Tip label={padiTip()}>
        <button
          type="button"
          ref={triggerEl}
          data-testid="padi-identity-chip"
          onClick={(e) => {
            e.stopPropagation();
            openForHost();
          }}
          class={identityMarkBtnClass}
          aria-label={padiTip()}
          aria-expanded={open()}
        >
          <IdentityMark logoSrc={PADI_LOGO_URL}>
            <StatusDot
              data-padi-link={linkForDialog() ?? "unknown"}
              class={padiDot(linkForDialog(), padiLive())}
            />
          </IdentityMark>
        </button>
      </Tip>
      <Show when={open()}>
        <PadiInfoDialog
          open={open()}
          onOpenChange={setOpen}
          link={linkForDialog()}
          live={padiLive()}
          identity={identity.value()}
          startedAt={padiStartedAt()}
          triggerRef={() => triggerEl}
          hostLabel={hostLabel(props.host)}
        />
      </Show>
    </>
  );
};

/** The Kaval sub-chip for one host — icon + that host's daemon-state dot.
 *  Click switches to that host, then opens the complete info panel. */
const KavalSubChip: Component<{ host: HostKey }> = (props) => {
  const [open, setOpen] = createSignal(false);
  let triggerEl!: HTMLButtonElement;
  const clockNow = getClockNow();
  const daemonLive = daemonTransportLive;
  const entryConnected = (): boolean =>
    padiMap.entry(props.host).state().kind === "connected";
  const kavalLive = (): boolean => channelLive(daemonLive(), entryConnected());
  const isCanvasHost = () => sameHost(activeHost(), props.host);
  const openForHost = (): void => {
    const alreadyActive = isCanvasHost();
    if (!alreadyActive) setActiveHost(props.host);
    setOpen((v) => (alreadyActive ? !v : true));
  };
  // Each remote/local padi serves its kaval under the LOCAL location key
  // (that host's own "local" kaval — not the browser's host key).
  const daemonKey = encodeHostLocation(LOCAL_LOCATION);
  const daemonSub = padiMap.entry(props.host).collections.daemonStatus.use({
    keys: () => [daemonKey],
    onError: (err: Error) => toast.error(`Daemon status error: ${err.message}`),
  });
  const processMemory = padiMap.entry(props.host).cells.processMemory.use({
    onError: (err: Error) =>
      toast.error(`Padi/kaval memory error: ${err.message}`),
  });
  const padiStatus = padiMap.entry(props.host).cells.status.use({
    onError: (err: Error) => toast.error(`Kaval status error: ${err.message}`),
  });
  const daemon = (): DaemonStatus | undefined => {
    const status = daemonSub.byKey(daemonKey)?.();
    if (status === undefined || typeof status.startedAt !== "number")
      return status;
    const local = padiMap.entry(props.host).clock.toLocal(status.startedAt);
    return { ...status, startedAt: local ?? 0 };
  };
  const kavalVersion = (): string | undefined => daemon()?.contractVersion;
  const kavalStateText = (): string => {
    if (!kavalLive()) return "unknown";
    const state = daemon()?.state;
    return state ? DAEMON_STATE_PRESENTATION[state].label : "unknown";
  };
  const kavalUptimeText = (): string | undefined => {
    if (!kavalLive() || daemon()?.state !== "connected") return undefined;
    const startedAt = daemon()?.startedAt;
    return startedAt === undefined || startedAt <= 0
      ? undefined
      : `running ${formatUptime(clockNow() - startedAt)}`;
  };
  const kavalMemoryText = (): string => {
    if (!kavalLive() || daemon()?.state !== "connected")
      return "memory unavailable";
    if (!daemonLive()) return "memory unavailable";
    const m = processMemory.value()?.kaval;
    return match(m)
      .with({ status: "ok" }, (d) => `RSS ${formatMBCompact(d.rssBytes)}`)
      .with({ status: "error" }, () => "memory poll failed")
      .with({ status: "absent" }, () => "memory unavailable")
      .with(P.nullish, () => "memory unavailable")
      .exhaustive();
  };
  const kavalUpdateText = (): string | undefined => {
    const expected = padiStatus.value()?.expectedKaval;
    const status = daemon();
    if (
      !kavalStale(
        expected?.staleKey,
        status?.identity?.staleKey,
        status?.state,
        kavalLive(),
      )
    )
      return undefined;
    return expected?.navigableCommit
      ? `newer build ${expected.navigableCommit.slice(0, 7)} available`
      : "newer build available";
  };
  const kavalTip = (): string =>
    joinTip(
      `kaval ${kavalStateText()}`,
      kavalVersion() ? `contract v${kavalVersion()}` : undefined,
      kavalUpdateText(),
      kavalUptimeText(),
      kavalMemoryText(),
      "click for details",
    );

  return (
    <>
      <Tip label={kavalTip()}>
        <button
          type="button"
          ref={triggerEl}
          data-testid="kaval-identity-chip"
          onClick={(e) => {
            e.stopPropagation();
            openForHost();
          }}
          class={identityMarkBtnClass}
          aria-label={kavalTip()}
          aria-expanded={open()}
        >
          <IdentityMark logoSrc={KAVAL_LOGO_URL}>
            <StatusDot
              data-daemon-state={
                kavalLive() ? (daemon()?.state ?? "unknown") : "unknown"
              }
              class={kavalDot(daemon()?.state, kavalLive())}
            />
          </IdentityMark>
        </button>
      </Tip>
      <Show when={open()}>
        <KavalInfoDialog
          open={open()}
          onOpenChange={setOpen}
          status={daemon()}
          live={kavalLive()}
          triggerRef={() => triggerEl}
          hostLabel={hostLabel(props.host)}
        />
      </Show>
    </>
  );
};

const PadiStaticMark: Component<{ host: HostKey }> = (props) => {
  const daemonLive = daemonTransportLive;
  const entry = (): EntryState => padiMap.entry(props.host).state();
  const link = (): PadiLink | undefined =>
    daemonLive() ? entryAsPadiLink(entry()) : undefined;

  return (
    <span class={identityMarkStaticClass}>
      <IdentityMark logoSrc={PADI_LOGO_URL}>
        <StatusDot
          data-padi-link={link() ?? "unknown"}
          class={padiDot(link(), daemonLive())}
        />
      </IdentityMark>
    </span>
  );
};

const KavalStaticMark: Component<{ host: HostKey }> = (props) => {
  const daemonLive = daemonTransportLive;
  const entryConnected = (): boolean =>
    padiMap.entry(props.host).state().kind === "connected";
  const kavalLive = (): boolean => channelLive(daemonLive(), entryConnected());
  const daemonKey = encodeHostLocation(LOCAL_LOCATION);
  const daemonSub = padiMap.entry(props.host).collections.daemonStatus.use({
    keys: () => [daemonKey],
    onError: (err: Error) => toast.error(`Daemon status error: ${err.message}`),
  });
  const daemon = (): DaemonStatus | undefined => daemonSub.byKey(daemonKey)?.();

  return (
    <span class={identityMarkStaticClass}>
      <IdentityMark logoSrc={KAVAL_LOGO_URL}>
        <StatusDot
          data-daemon-state={
            kavalLive() ? (daemon()?.state ?? "unknown") : "unknown"
          }
          class={kavalDot(daemon()?.state, kavalLive())}
        />
      </IdentityMark>
    </span>
  );
};

/** Fixed-width dual-daemon slot for one host chip.
 *
 *  Fills for every non-measure mount (active *and* inactive). Switcher rows ask
 *  for non-interactive marks so the transient switcher never owns a dialog that
 *  unmounts itself during host switching. Measure-row twins stay empty so width
 *  reserve ≠ second live pair. */
export const HostDualDaemonSlot: Component<{
  host: HostKey;
  measure?: boolean;
  interactive?: boolean;
}> = (props) => {
  const filled = () => !props.measure;
  const interactive = () => props.interactive ?? true;
  return (
    <div
      class={dualDaemonSlotClass}
      data-testid="host-dual-daemon-slot"
      data-filled={filled() ? "" : undefined}
      data-interactive={filled() && interactive() ? "" : undefined}
      aria-hidden={filled() && interactive() ? undefined : true}
    >
      <Show when={filled()}>
        <Show
          when={interactive()}
          fallback={
            <>
              <PadiStaticMark host={props.host} />
              <KavalStaticMark host={props.host} />
            </>
          }
        >
          <PadiSubChip host={props.host} />
          <KavalSubChip host={props.host} />
        </Show>
      </Show>
    </div>
  );
};
