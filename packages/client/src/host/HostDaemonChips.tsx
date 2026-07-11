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
import type { PadiLink, ProcessRss } from "kolu-common/surface";
import type {
  PadiEntryStatus,
  SkewVersionPair,
} from "kolu-common/surfacesWithPadi";
import type { Component, Setter } from "solid-js";
import { createEffect, createMemo, createSignal, Show } from "solid-js";
import { match, P } from "ts-pattern";
import { toast } from "solid-sonner";
import KavalInfoDialog, { KAVAL_LOGO_URL } from "../kaval/KavalInfoDialog";
import { kavalStale } from "../kaval/kavalCurrency";
import {
  DAEMON_STATE_PRESENTATION,
  daemonTransportLive,
  formatUptime,
  kavalDot,
  reprojectDaemonStatus,
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
import { hostLabel, sameHost, statusTitle } from "./hostChipTone";

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

/** The ONE per-host reader for Padi liveness + entry state — the receptacle for
 *  "how do I read a given host's Padi status from `padiMap`". Both the
 *  presentational {@link PadiMark} and the interactive {@link PadiSubChip} read
 *  through this, so the volatile axis (entry-state → padiLink projection, the
 *  transport-liveness floor) lives in exactly one place, not sprayed across the
 *  static and interactive marks. */
function useHostPadi(host: HostKey): {
  live: () => boolean;
  entry: () => EntryState;
  link: () => PadiLink | undefined;
} {
  const live = daemonTransportLive;
  const entry = (): EntryState => padiMap.entry(host).state();
  const link = (): PadiLink | undefined =>
    live() ? entryAsPadiLink(entry()) : undefined;
  return { live, entry, link };
}

/** The ONE per-host reader for Kaval liveness + daemon status — the receptacle
 *  for "how do I read a given host's Kaval status from `padiMap`". `daemon`
 *  reprojects `startedAt` onto the browser clock via `clock.toLocal` UNIFORMLY
 *  (the static mark used to skip this — that silent divergence is gone now that
 *  both marks read through this single reader). */
function useHostKaval(host: HostKey): {
  live: () => boolean;
  daemon: () => DaemonStatus | undefined;
} {
  const entryConnected = (): boolean =>
    padiMap.entry(host).state().kind === "connected";
  const live = (): boolean =>
    channelLive(daemonTransportLive(), entryConnected());
  // Each remote/local padi serves its kaval under the LOCAL location key
  // (that host's own "local" kaval — not the browser's host key).
  const daemonKey = encodeHostLocation(LOCAL_LOCATION);
  const daemonSub = padiMap.entry(host).collections.daemonStatus.use({
    keys: () => [daemonKey],
    onError: (err: Error) => toast.error(`Daemon status error: ${err.message}`),
  });
  // Memoized: this host's KavalSubChip reads `daemon()` ~8× per render pass
  // (mark dot, version, state, uptime ×2, memory, update) — each an unmemoized
  // call would redo the `byKey` lookup AND mint a fresh `{...status}` spread.
  // One reprojection per `daemonStatus` change, shared by every consumer
  // (`solidjs.md`: memo a multi-consumer derivation). Runs for every mounted
  // host chip (active and inactive), so it sits on the per-host-status path.
  // Reprojection body is the shared `reprojectDaemonStatus` (useDaemonStatus.ts)
  // — the local-daemon memo there reprojects through the SAME function.
  const daemon = createMemo((): DaemonStatus | undefined =>
    reprojectDaemonStatus(host, daemonSub.byKey(daemonKey)?.()),
  );
  return { live, daemon };
}

/** The ONE per-host `processMemory` reader — the Padi and Kaval sub-chips read
 *  `.padi` and `.kaval` off the SAME cell, so sharing one subscription (and one
 *  `onError`) means a single memory-poll failure surfaces ONE toast, not one
 *  per sub-chip. Same reader-as-shared-value discipline the daemonStatus reader
 *  already follows. */
function useHostProcessMemory(host: HostKey) {
  return padiMap.entry(host).cells.processMemory.use({
    onError: (err: Error) =>
      toast.error(`Padi/kaval memory error: ${err.message}`),
  });
}

/** The 4-arm process-RSS readout → tooltip text, in ONE place: the Padi and
 *  Kaval tips rendered a byte-identical `match(...).exhaustive()` block each. */
function formatProcessMemoryText(m: ProcessRss | undefined): string {
  return match(m)
    .with({ status: "ok" }, (d) => `RSS ${formatMBCompact(d.rssBytes)}`)
    .with({ status: "error" }, () => "memory poll failed")
    .with({ status: "absent" }, () => "memory unavailable")
    .with(P.nullish, () => "memory unavailable")
    .exhaustive();
}

/** Presentational Padi mark — logo + status dot for a host. Takes the ALREADY-
 *  constructed {@link useHostPadi} reader from its parent rather than opening its
 *  own: the static path and the interactive sub-chip each build the reader once
 *  and hand it in, so a single mark never re-derives (and, for Kaval, never
 *  double-subscribes) the same host's status. The static path wraps this bare in
 *  a span; the interactive path wraps this SAME mark in the dialog-owning
 *  button. */
const PadiMark: Component<{ padi: ReturnType<typeof useHostPadi> }> = (
  props,
) => (
  <IdentityMark logoSrc={PADI_LOGO_URL} imgClass="host-daemon-logo">
    <StatusDot
      data-padi-link={props.padi.link() ?? "unknown"}
      class={padiDot(props.padi.link(), props.padi.live())}
    />
  </IdentityMark>
);

/** Presentational Kaval mark — logo + status dot for a host, derived from a
 *  parent-supplied {@link useHostKaval} reader. Same one-derivation-two-
 *  placements shape as {@link PadiMark}; taking the reader as a prop is what
 *  keeps a single interactive mark from opening TWO `daemonStatus` subscriptions
 *  for the same host (the sub-chip already holds one). */
const KavalMark: Component<{
  kaval: ReturnType<typeof useHostKaval>;
  /** A newer kaval build is available for this host (see {@link kavalStale}).
   *  Surfaces the update at a glance — an amber corner pip in the OPPOSITE
   *  corner from the state dot — so a build-behind kaval doesn't look identical
   *  to a current one in the chrome (the fuller "newer build …" text still
   *  rides the tooltip + dialog). Static switcher marks don't pass it. */
  stale?: boolean;
}> = (props) => (
  <IdentityMark logoSrc={KAVAL_LOGO_URL} imgClass="host-daemon-logo">
    <StatusDot
      data-daemon-state={
        props.kaval.live()
          ? (props.kaval.daemon()?.state ?? "unknown")
          : "unknown"
      }
      class={kavalDot(props.kaval.daemon()?.state, props.kaval.live())}
    />
    <Show when={props.stale}>
      <span
        data-testid="kaval-update-pip"
        class="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full border border-surface-2 bg-amber-500"
        aria-hidden="true"
      />
    </Show>
  </IdentityMark>
);

/** The ONE open/switch seam for a daemon mark: opens the info panel for this
 *  host, switching the canvas to it first when it isn't already active (a
 *  no-op-close toggle only when it already is). Both sub-chips share this so the
 *  switch-first rule — opening an inactive host's panel makes the dialog's
 *  active-host-scoped detail rows describe that host — lives in exactly one
 *  documented place, not duplicated verbatim per mark. */
function useDaemonMarkOpen(host: HostKey): {
  open: () => boolean;
  setOpen: Setter<boolean>;
  openForHost: () => void;
} {
  const [open, setOpen] = createSignal(false);
  const openForHost = (): void => {
    const alreadyActive = sameHost(activeHost(), host);
    if (!alreadyActive) setActiveHost(host);
    setOpen((v) => (alreadyActive ? !v : true));
  };
  // The dialog's active-host-scoped rows (memory, running-daemon inventory,
  // convergence, kaval restart) ride the switch-first contract: opening SWITCHES
  // the canvas to `host`, so those rows describe it. But the active host can
  // later move OFF `host` while the panel stays open WITHOUT an outside click —
  // wire.ts's `hostReconcileTarget` auto-switches to LOCAL when `host` silently
  // departs the pool, and that path never triggers useAnchoredPopover's
  // outside-click/Escape dismiss. Left open, the panel would blend this host's
  // props-scoped status with another host's active-host rows (and restart would
  // recycle the newly-active host). Close it, so a shown panel always describes
  // the current active host — never a stale cross-host mix.
  createEffect(() => {
    if (open() && !sameHost(activeHost(), host)) setOpen(false);
  });
  return { open, setOpen, openForHost };
}

/** The Padi sub-chip for one host — icon + that host's entry-state dot.
 *  Click switches to that host, then opens the complete info panel. */
const PadiSubChip: Component<{
  host: HostKey;
  mem: ReturnType<typeof useHostProcessMemory>;
}> = (props) => {
  const { open, setOpen, openForHost } = useDaemonMarkOpen(props.host);
  let triggerEl!: HTMLButtonElement;
  const padi = useHostPadi(props.host);
  // Per-host identity (version for the tip).
  const identity = padiMap.entry(props.host).cells.identity.use({
    onError: (err: Error) => toast.error(`Padi identity error: ${err.message}`),
  });
  const padiVersion = (): string | undefined =>
    identity.value()?.surfaceVersion;
  const padiStartedAt = (): number | null => {
    const raw = identity.value()?.startedAt;
    if (raw === undefined) return null;
    return padiMap.entry(props.host).clock.toLocal(raw) ?? null;
  };
  const padiMemoryText = (): string => {
    // Gate on THIS host's entry being CONNECTED, not merely transport-live:
    // `padi.live()` is only the browser↔kolu-server transport, so a remote host
    // that failed or is warm-reconnecting keeps a retained RSS in its per-host
    // `processMemory` cell. Showing that figure next to a failed/connecting dot
    // reads stale memory as live — the Kaval readout already gates on its daemon
    // being `connected`, so mirror that here.
    if (!padi.live() || padi.entry().kind !== "connected")
      return "memory unavailable";
    return formatProcessMemoryText(props.mem.value()?.padi);
  };
  const padiTip = (): string => {
    const skew = skewPairFor(props.host);
    return joinTip(
      `padi ${padi.live() ? statusTitle(padi.entry()) : "unknown"}`,
      skew
        ? `contract skew v${skew.running} → v${skew.expected}`
        : padiVersion()
          ? `contract v${padiVersion()}`
          : undefined,
      padiMemoryText(),
      "click for details",
    );
  };

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
          <PadiMark padi={padi} />
        </button>
      </Tip>
      <Show when={open()}>
        <PadiInfoDialog
          open={open()}
          onOpenChange={setOpen}
          link={padi.link()}
          live={padi.live()}
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
const KavalSubChip: Component<{
  host: HostKey;
  mem: ReturnType<typeof useHostProcessMemory>;
}> = (props) => {
  const { open, setOpen, openForHost } = useDaemonMarkOpen(props.host);
  let triggerEl!: HTMLButtonElement;
  const clockNow = getClockNow();
  const kaval = useHostKaval(props.host);
  const padiStatus = padiMap.entry(props.host).cells.status.use({
    onError: (err: Error) => toast.error(`Kaval status error: ${err.message}`),
  });
  const kavalVersion = (): string | undefined =>
    kaval.daemon()?.contractVersion;
  const kavalStateText = (): string => {
    if (!kaval.live()) return "unknown";
    const state = kaval.daemon()?.state;
    return state ? DAEMON_STATE_PRESENTATION[state].label : "unknown";
  };
  const kavalUptimeText = (): string | undefined => {
    if (!kaval.live() || kaval.daemon()?.state !== "connected")
      return undefined;
    const startedAt = kaval.daemon()?.startedAt;
    return startedAt === undefined || startedAt <= 0
      ? undefined
      : `running ${formatUptime(clockNow() - startedAt)}`;
  };
  const kavalMemoryText = (): string => {
    // `kaval.live()` is already `channelLive(daemonTransportLive(), …)`, so a
    // separate `!daemonTransportLive()` gate here would be unreachable.
    if (!kaval.live() || kaval.daemon()?.state !== "connected")
      return "memory unavailable";
    return formatProcessMemoryText(props.mem.value()?.kaval);
  };
  // The at-a-glance staleness fact for THIS host's kaval — drives both the
  // amber update pip on the mark (glanceable, no hover) and the tooltip text.
  const kavalIsStale = (): boolean => {
    const expected = padiStatus.value()?.expectedKaval;
    const status = kaval.daemon();
    return kavalStale(
      expected?.staleKey,
      status?.identity?.staleKey,
      status?.state,
      kaval.live(),
    );
  };
  const kavalUpdateText = (): string | undefined => {
    if (!kavalIsStale()) return undefined;
    const expected = padiStatus.value()?.expectedKaval;
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
          <KavalMark kaval={kaval} stale={kavalIsStale()} />
        </button>
      </Tip>
      <Show when={open()}>
        <KavalInfoDialog
          open={open()}
          onOpenChange={setOpen}
          status={kaval.daemon()}
          live={kaval.live()}
          triggerRef={() => triggerEl}
          hostLabel={hostLabel(props.host)}
        />
      </Show>
    </>
  );
};

const PadiStaticMark: Component<{ host: HostKey }> = (props) => {
  const padi = useHostPadi(props.host);
  return (
    <span class={identityMarkStaticClass}>
      <PadiMark padi={padi} />
    </span>
  );
};

const KavalStaticMark: Component<{ host: HostKey }> = (props) => {
  const kaval = useHostKaval(props.host);
  return (
    <span class={identityMarkStaticClass}>
      <KavalMark kaval={kaval} />
    </span>
  );
};

/** The interactive fill of one host's slot: builds the SHARED per-host
 *  process-memory reader ONCE and hands it to both sub-chips (which each read a
 *  different member off the same cell), so the pair opens one `processMemory`
 *  subscription — and fires one poll-failure toast — not two. Mounts only in
 *  the slot's `"interactive"` mode, so the measuring/static rows never open it. */
const InteractiveDaemonMarks: Component<{ host: HostKey }> = (props) => {
  const mem = useHostProcessMemory(props.host);
  return (
    <>
      <PadiSubChip host={props.host} mem={mem} />
      <KavalSubChip host={props.host} mem={mem} />
    </>
  );
};

/** Fixed-width dual-daemon slot for one host chip. Its THREE reachable states
 *  are one named `mode`, never a pair of booleans (the old `measure ⊗
 *  interactive` left `measure && interactive` type-expressible yet meaningless):
 *   · `"interactive"` (default) — filled with this host's Padi/Kaval SUB-chips,
 *     each owning its info dialog (active *and* inactive hosts alike, so a red
 *     remote is obvious without switching first);
 *   · `"static"` — filled with read-only marks; the transient host switcher asks
 *     for these so it never owns a dialog that unmounts itself mid-switch;
 *   · `"measure"` — empty, so a measuring-row twin reserves width without a
 *     second live mount pair. */
export const HostDualDaemonSlot: Component<{
  host: HostKey;
  mode?: "measure" | "interactive" | "static";
}> = (props) => {
  const mode = () => props.mode ?? "interactive";
  const filled = () => mode() !== "measure";
  const interactive = () => mode() === "interactive";
  return (
    <div
      class={dualDaemonSlotClass}
      data-testid="host-dual-daemon-slot"
      data-filled={filled() ? "" : undefined}
      data-interactive={interactive() ? "" : undefined}
      aria-hidden={interactive() ? undefined : true}
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
          <InteractiveDaemonMarks host={props.host} />
        </Show>
      </Show>
    </div>
  );
};
