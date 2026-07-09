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
 *  identity, daemonStatus) — never the free `activeHost` alone. Click still
 *  opens the info dialog; if the mark's host is not active, we switch first
 *  so the dialog (which is active-host scoped) matches the mark.
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
import {
  DAEMON_STATE_PRESENTATION,
  daemonTransportLive,
  formatUptime,
  kavalDot,
} from "../kaval/useDaemonStatus";
import { channelLive } from "../kaval/daemonPresentation";
import PadiInfoDialog, { PADI_LOGO_URL } from "../padi/PadiInfoDialog";
import { getClockNow } from "../time/clock";
import { IdentityMark, StatusDot } from "../ui/IdentityMark";
import { joinTip } from "../ui/joinTip";
import { formatMBCompact } from "../ui/memory";
import Tip from "../ui/Tip";
import { activeHost, padiMap, setActiveHost } from "../wire";
import { dotClass, sameHost, statusTitle } from "./hostChipTone";

/** Outer dual-daemon slot — fixed on every host chip. */
const DUAL_DAEMON_SLOT_CLASS =
  "flex h-7 w-[3.25rem] shrink-0 items-center justify-center";

// Hover wash must read on both active (`bg-surface-3`) and inactive chips.
const subChipClass =
  "pointer-events-auto shrink-0 relative flex h-7 w-[1.5rem] items-center justify-center rounded-md leading-4 text-fg-2 transition-colors hover:bg-white/10 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 cursor-pointer";

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

/** Switch to `host` if needed, then open the dialog (dialogs are active-scoped). */
function activateThen(host: HostKey, open: (v: boolean) => void): void {
  if (!sameHost(activeHost(), host)) setActiveHost(host);
  open(true);
}

/** The Padi sub-chip for one host — icon + that host's entry-state dot. */
const PadiSubChip: Component<{ host: HostKey }> = (props) => {
  const [open, setOpen] = createSignal(false);
  const daemonLive = daemonTransportLive;
  const entry = (): EntryState => padiMap.entry(props.host).state();
  const entryLive = (): boolean =>
    channelLive(daemonLive(), entry().kind === "connected");
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
    daemonLive() ? entryAsPadiLink(entry()) : undefined;

  return (
    <>
      <Tip label={padiTip()}>
        <button
          type="button"
          data-testid="padi-identity-chip"
          onClick={() => activateThen(props.host, setOpen)}
          class={subChipClass}
          aria-label={padiTip()}
        >
          <IdentityMark logoSrc={PADI_LOGO_URL}>
            <StatusDot
              data-padi-link={
                daemonLive()
                  ? (entryAsPadiLink(entry()) ?? "unknown")
                  : "unknown"
              }
              class={entryLive() ? dotClass(entry()) : "bg-fg-3/40"}
            />
          </IdentityMark>
        </button>
      </Tip>
      {/* Dialog is active-host scoped — only mount content while open and this
       *  host is active (after activateThen). */}
      <Show when={open() && sameHost(activeHost(), props.host)}>
        <PadiInfoDialog
          open={open()}
          onOpenChange={setOpen}
          link={linkForDialog()}
        />
      </Show>
    </>
  );
};

/** The Kaval sub-chip for one host — icon + that host's daemon-state dot. */
const KavalSubChip: Component<{ host: HostKey }> = (props) => {
  const [open, setOpen] = createSignal(false);
  const clockNow = getClockNow();
  const daemonLive = daemonTransportLive;
  const entryConnected = (): boolean =>
    padiMap.entry(props.host).state().kind === "connected";
  const kavalLive = (): boolean => channelLive(daemonLive(), entryConnected());
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
    return startedAt === undefined
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
  const kavalTip = (): string =>
    joinTip(
      `kaval ${kavalStateText()}`,
      kavalVersion() ? `contract v${kavalVersion()}` : undefined,
      kavalUptimeText(),
      kavalMemoryText(),
      "click for details",
    );

  return (
    <>
      <Tip label={kavalTip()}>
        <button
          type="button"
          data-testid="kaval-identity-chip"
          onClick={() => activateThen(props.host, setOpen)}
          class={subChipClass}
          aria-label={kavalTip()}
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
      <Show when={open() && sameHost(activeHost(), props.host)}>
        <KavalInfoDialog
          open={open()}
          onOpenChange={setOpen}
          status={daemon()}
        />
      </Show>
    </>
  );
};

/** Fixed-width dual-daemon slot for one host chip.
 *
 *  Fills for every non-measure mount (active *and* inactive). Measure-row twins
 *  stay empty so width reserve ≠ second live pair. */
export const HostDualDaemonSlot: Component<{
  host: HostKey;
  measure?: boolean;
}> = (props) => {
  const filled = () => !props.measure;
  return (
    <div
      class={DUAL_DAEMON_SLOT_CLASS}
      data-testid="host-dual-daemon-slot"
      data-filled={filled() ? "" : undefined}
      aria-hidden={filled() ? undefined : true}
    >
      <Show when={filled()}>
        <PadiSubChip host={props.host} />
        <KavalSubChip host={props.host} />
      </Show>
    </div>
  );
};
