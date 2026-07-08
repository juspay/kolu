/** Active-host Padi + Kaval dual marks for the host chip (Proposal A / host-first).
 *
 *  Mounted INSIDE every `HostChip` as a FIXED-width dual-daemon slot. Only the
 *  ACTIVE host fills the slot with live sub-chips; inactive hosts leave the
 *  same outer box empty. That is what keeps host-switch reflow impossible:
 *  measured chip width never depends on `isActive()` — only the slot's CONTENT
 *  re-keys. Iteration 1 put the pair inside the active chip WITHOUT a reserved
 *  empty box on siblings and reflowed the strip; iteration 2 pulled the pair
 *  into a stationary ChromeBar slot. This module is iteration 3: back on the
 *  host chip, with the reserved-width invariant baked in.
 *
 *  Padi and Kaval are PER-HOST facts read through ACTIVE-host accessors
 *  (`useDaemonStatus`, `useHostInventory`, `padiPresentation`). Sub-chips mount
 *  only on the active chip, so there is no N× subscription cost and no host
 *  param to thread.
 *
 *  COMPACTION: resting state is icon + status dot only. Steady versions live in
 *  tooltips/dialogs. The sole bar exception is the contract-skew pair
 *  ({@link SkewVersionSpan}) on Padi when the active entry failed with
 *  `contract-skew-refused` — painted inside the fixed slot (overflow-hidden)
 *  so a healthy↔skew host switch still cannot grow the outer box. */

import type {
  PadiEntryStatus,
  SkewVersionPair,
} from "kolu-common/surfacesWithPadi";
import type { Component } from "solid-js";
import { createSignal, Show } from "solid-js";
import { match, P } from "ts-pattern";
import KavalInfoDialog, { KAVAL_LOGO_URL } from "../kaval/KavalInfoDialog";
import {
  KavalUpdateBadge,
  kavalUpdatePending,
} from "../kaval/KavalUpdateBadge";
import {
  DAEMON_STATE_PRESENTATION,
  daemonChannelLive,
  daemonTransportLive,
  formatUptime,
  kavalDot,
  localDaemonStatus,
  padiLinkState,
} from "../kaval/useDaemonStatus";
import PadiInfoDialog, { PADI_LOGO_URL } from "../padi/PadiInfoDialog";
import {
  PADI_LINK_PRESENTATION,
  padiBoundHostSegment,
  padiDot,
} from "../padi/padiPresentation";
import { getClockNow } from "../time/clock";
import { IdentityMark, StatusDot } from "../ui/IdentityMark";
import { joinTip } from "../ui/joinTip";
import { formatMBCompact } from "../ui/memory";
import { daemonScanBoundHost } from "../ui/useDaemonInventory";
import { activePadiIdentity } from "../ui/useHostInventory";
import { kavalMemoryDisplay, padiMemoryDisplay } from "../ui/useMemoryUsage";
import { activeHost, padiMap } from "../wire";

/**
 * Outer dual-daemon slot width — MUST match on every host chip (active fill
 * and inactive empty). Sized for two compact icon+dot marks; skew text, when
 * present, lives inside and clips rather than growing the chip.
 *
 * Keep in lockstep with `HostSelectorStrip`'s `DEFAULT_CHIP_WIDTH_ESTIMATE`
 * bump (the estimate includes this reservation).
 */
export const DUAL_DAEMON_SLOT_CLASS =
  "flex h-7 w-[3.25rem] shrink-0 items-center justify-center overflow-hidden";

const subChipClass =
  "pointer-events-auto shrink-0 relative flex h-7 items-center justify-center px-0.5 leading-4 text-fg-2 transition-colors hover:bg-surface-3/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50";

/** Contract-skew running→expected pair — only painted when the active host's
 *  padi entry failed with `contract-skew-refused`. Lives inside the fixed dual
 *  slot (may clip); full pair remains in the Padi tooltip/dialog. */
const SkewVersionSpan: Component<SkewVersionPair> = (props) => (
  <span class="max-w-[2.75rem] truncate whitespace-nowrap tabular-nums text-[9px] leading-4 text-warning">
    {`v${props.running}→v${props.expected}`}
  </span>
);

const PadiMemReadout: Component = () => (
  <Show when={padiMemoryDisplay()?.kind === "error"}>
    <span
      data-testid="padi-memory-error"
      class="rounded-full border border-warning/40 px-1 text-[9px] leading-4 text-warning"
    >
      mem ?
    </span>
  </Show>
);

const KavalMemReadout: Component = () => (
  <Show when={kavalMemoryDisplay()?.kind === "error"}>
    <span
      data-testid="kaval-memory-error"
      class="rounded-full border border-warning/40 px-1 text-[9px] leading-4 text-warning"
    >
      mem ?
    </span>
  </Show>
);

/** The Padi sub-chip — icon + link-state dot (+ skew pair when broken).
 *  Click opens {@link PadiInfoDialog}. */
const PadiSubChip: Component = () => {
  const [open, setOpen] = createSignal(false);
  const daemonLive = daemonTransportLive;
  const padiVersion = (): string | undefined =>
    activePadiIdentity()?.surfaceVersion;
  // Skew-UX: when the ACTIVE host's entry failed on `contract-skew-refused`, the
  // typed D2 version pair rides that `failed` arm (`PadiEntryStatus`).
  const skewPair = (): SkewVersionPair | undefined => {
    const state = padiMap.entry(activeHost()).state() as PadiEntryStatus;
    if (state.kind !== "failed" || state.cause !== "contract-skew-refused")
      return undefined;
    const { running, expected } = state as SkewVersionPair;
    return { running, expected };
  };
  const padiHostSegment = (): string | null =>
    padiBoundHostSegment(daemonScanBoundHost());
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
  const padiTip = (): string => {
    const skew = skewPair();
    return joinTip(
      `padi ${padiStateText()}`,
      padiHostSegment() ?? undefined,
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
      <button
        type="button"
        data-testid="padi-identity-chip"
        onClick={() => setOpen(true)}
        class={subChipClass}
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
        <Show when={skewPair()}>
          {(pair) => (
            <SkewVersionSpan
              running={pair().running}
              expected={pair().expected}
            />
          )}
        </Show>
        <PadiMemReadout />
      </button>
      <PadiInfoDialog
        open={open()}
        onOpenChange={setOpen}
        link={padiLinkState()}
      />
    </>
  );
};

/** The Kaval sub-chip — icon + daemon-state dot. Click opens {@link KavalInfoDialog}. */
const KavalSubChip: Component = () => {
  const [open, setOpen] = createSignal(false);
  const clockNow = getClockNow();
  const daemon = localDaemonStatus;
  const kavalLive = daemonChannelLive;
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
  const kavalMemoryText = (): string =>
    match(kavalMemoryDisplay())
      .with({ kind: "ok" }, (d) => `RSS ${formatMBCompact(d.rssBytes)}`)
      .with({ kind: "error" }, () => "memory poll failed")
      .with(P.nullish, () => "memory unavailable")
      .exhaustive();
  const kavalTip = (): string =>
    joinTip(
      `kaval ${kavalStateText()}`,
      kavalVersion() ? `contract v${kavalVersion()}` : undefined,
      kavalUptimeText(),
      kavalMemoryText(),
      kavalUpdatePending() ? "newer build available" : undefined,
      "click for details",
    );

  return (
    <>
      <button
        type="button"
        data-testid="kaval-identity-chip"
        onClick={() => setOpen(true)}
        class={subChipClass}
        title={kavalTip()}
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
        <KavalMemReadout />
        <Show when={kavalUpdatePending()}>
          <KavalUpdateBadge />
        </Show>
      </button>
      <KavalInfoDialog open={open()} onOpenChange={setOpen} status={daemon()} />
    </>
  );
};

/** Fixed-width dual-daemon slot for one host chip.
 *
 *  `filled` is true only for the active host. Outer classes NEVER branch on
 *  fill — only children do — so measured width is identical for every chip. */
export const HostDualDaemonSlot: Component<{ filled: boolean }> = (props) => (
  <div
    class={DUAL_DAEMON_SLOT_CLASS}
    data-testid="host-dual-daemon-slot"
    data-filled={props.filled ? "" : undefined}
    aria-hidden={props.filled ? undefined : true}
  >
    <Show when={props.filled}>
      <PadiSubChip />
      <KavalSubChip />
    </Show>
  </div>
);
