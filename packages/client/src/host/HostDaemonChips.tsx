/** DaemonSlot — the STATIONARY Padi + Kaval status slot, mounted ONCE by
 *  `ChromeBar` right after the Kolu chip, ahead of the host chips (W4 header
 *  redesign, ITERATION 2). Iteration 1 put these sub-chips INSIDE the active
 *  host chip; that inflated whichever chip happened to be active, so a host
 *  switch reflowed every chip after it — the expansion traveled with the
 *  active host. Moving the slot OUT to a fixed position fixes that
 *  structurally: the slot's position and size never change on a switch, only
 *  its CONTENT re-keys.
 *
 *  Padi and Kaval are PER-HOST facts, so they don't sit in the
 *  host-independent `IdentityRail` (which carries the Kolu chip only) — they
 *  ride here, reading the ACTIVE host's own state through the same
 *  `padiMap.useEntry(activeHost)`-backed accessors the rail used to
 *  (`useDaemonStatus`, `useHostInventory`, `padiPresentation`), so switching
 *  the active host re-keys these sub-chips BY CONSTRUCTION — there is no host
 *  param to thread through, and no second tone/identity source to drift from
 *  the retired rail chips. The sub-chip components themselves (`PadiSubChip`,
 *  `KavalSubChip`) are unchanged from iteration 1 — only WHERE they mount
 *  moved, never HOW they read their state — so re-keying on switch still
 *  costs zero plumbing.
 *
 *  COMPACTION: resting state is icon + status dot, plus a bare version number
 *  (no "contract" word — that stays a tooltip/dialog word) shown only above the
 *  `lg` breakpoint, mirroring the width-budget rule the Kolu chip follows. Full
 *  detail (state, bound host, memory, uptime, update-pending) stays in the
 *  tooltip/aria-label and the click-through dialog, exactly as it did on the
 *  old rail chips.
 *
 *  SKEW SEAM (landed): the Padi sub-chip's version span becomes a
 *  running/expected CONTRACT PAIR ({@link SkewVersionSpan}) when the active host's
 *  entry `failed` on `contract-skew-refused` (the typed D2 pair), and the single
 *  {@link VersionSpan} otherwise — the swap the iteration-2 slot reserved, with the
 *  same reserved `min-w` so it never reflows the strip on switch. */

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

/** A version span shown only once it clears the width budget — the same
 *  `hidden lg:inline` breakpoint approximation the Kolu chip uses (a real
 *  per-chip container-width measurement is a further iteration; this is the
 *  existing chrome-wide convention for "hide until there's room", e.g.
 *  `ChromeBar`'s `toggleBtnClass`).
 *
 *  ALWAYS mounted, reserving a FIXED `min-w` regardless of whether `version`
 *  is known — this is load-bearing for the STATIONARY slot's own invariant
 *  (its size never changes on a host switch, only its content): `version` is
 *  a PER-HOST fact (padi/kaval declare it once connected; it reads
 *  `undefined` for a host that hasn't connected yet, e.g. an unreachable
 *  remote), so switching to such a host would otherwise shrink this span to
 *  nothing and drag the whole host-chip strip left behind it — the exact
 *  reflow class this redesign exists to kill, just relocated from the host
 *  chip (iteration 1) to the slot (iteration 2) instead of eliminated. A
 *  `<Show>`-removed span could not do this: removing the node removes the
 *  space it reserved. */
const VersionSpan: Component<{ version: string | undefined }> = (props) => (
  <span class="hidden min-w-[2.75rem] tabular-nums text-fg-3 lg:inline-block">
    {props.version ? `v${props.version}` : ""}
  </span>
);

/** The Skew-UX running→expected CONTRACT PAIR badge — the deferred-seam swap the
 *  module header (and iteration-2's stationary-slot doc) reserved: when the active
 *  host's padi entry `failed` with cause `contract-skew-refused`, the single
 *  {@link VersionSpan} becomes this pair so the version MISMATCH is legible at a
 *  glance (`v{running} → v{expected}`, subtle skew tone). Keeps the SAME
 *  `hidden … lg:inline-block` breakpoint and the same reserved `min-w-[2.75rem]`
 *  floor as `VersionSpan` — so a host switch that swaps a single version FOR the
 *  pair never shrinks the slot below the reserved width and never reflows the host
 *  strip. `whitespace-nowrap` keeps the pair on one line inside the fixed-height
 *  slot. */
const SkewVersionSpan: Component<SkewVersionPair> = (props) => (
  <span class="hidden min-w-[2.75rem] whitespace-nowrap tabular-nums text-warning lg:inline-block">
    {`v${props.running} → v${props.expected}`}
  </span>
);

// `PadiMemReadout`/`KavalMemReadout`/`KavalUpdateBadge` stay `<Show>`-gated
// (width NOT reserved when absent), unlike `VersionSpan` above — deliberately.
// A daemon's VERSION is a per-host STEADY fact (every connected host has
// one), so hiding it on switch is exactly the "chip inflates/deflates on
// switch" class this file exists to prevent. A memory-poll error or a
// pending-update badge is a RARE, transient anomaly — reserving fixed width
// for every combination of those across every host would spend real chrome
// space on error states nobody is in most of the time, for a case that
// hasn't been the reported/observed regression (only `VersionSpan`'s
// disappearance was — see its own doc comment).
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

const subChipClass =
  "pointer-events-auto shrink-0 relative flex h-7 items-center gap-1 px-1.5 leading-4 text-fg-2 transition-colors hover:bg-surface-3/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50";

/** The Padi sub-chip — icon + link-state dot (+ version, width permitting),
 *  click opens {@link PadiInfoDialog}. Mirrors the retired rail chip's tone
 *  and tooltip content verbatim; only the resting-state visual footprint
 *  shrank. */
const PadiSubChip: Component = () => {
  const [open, setOpen] = createSignal(false);
  const daemonLive = daemonTransportLive;
  const padiVersion = (): string | undefined =>
    activePadiIdentity()?.surfaceVersion;
  // Skew-UX: when the ACTIVE host's entry failed on `contract-skew-refused`, the
  // typed D2 version pair rides that `failed` arm (`PadiEntryStatus`). Read it
  // host-scoped (the cast is the read-site contract the type documents) and, when
  // present, render the running→expected PAIR in place of the single version span.
  const skewPair = (): SkewVersionPair | undefined => {
    const state = padiMap.entry(activeHost()).state() as PadiEntryStatus;
    if (state.kind !== "failed" || state.cause !== "contract-skew-refused")
      return undefined;
    // `PadiEntryStatus`'s `failed` arm overlaps — the D2 typed `running`/`expected`
    // ride only the member that structurally carries them, so reach them through the
    // read-site cast the type documents (the producer attaches both on this cause).
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
  const padiTip = (): string =>
    joinTip(
      `padi ${padiStateText()}`,
      padiHostSegment() ?? undefined,
      padiVersion() ? `contract v${padiVersion()}` : undefined,
      padiMemoryText(),
      "click for details",
    );

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
        <Show
          when={skewPair()}
          fallback={<VersionSpan version={padiVersion()} />}
        >
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

/** The Kaval sub-chip — icon + daemon-state dot (+ version, width permitting),
 *  click opens {@link KavalInfoDialog}. Mirrors the retired rail chip's tone
 *  and tooltip content verbatim. */
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
        <VersionSpan version={kavalVersion()} />
        <KavalMemReadout />
        <Show when={kavalUpdatePending()}>
          <KavalUpdateBadge />
        </Show>
      </button>
      <KavalInfoDialog open={open()} onOpenChange={setOpen} status={daemon()} />
    </>
  );
};

/** The stationary slot's own chrome — a rounded chip-shaped container carrying
 *  the SAME selection accent the active host chip wears (`border-accent/60` +
 *  `bg-surface-3`, the identical pair `HostSelectorStrip.tsx`'s `HostChip`
 *  toggles on for `isActive()`): the slot never moves, but its accent still
 *  visually ties it to whichever chip is active, satisfying "visual
 *  association without moving." A single divider separates the two
 *  sub-chips; the slot needs none of its own on the leading edge (unlike
 *  iteration 1's in-chip divider, which separated the host label from the
 *  daemon pair it interrupted). */
const DaemonSlot: Component = () => (
  <div
    class="pointer-events-auto flex items-stretch h-7 rounded-lg border border-accent/60 bg-surface-3 text-fg overflow-hidden shrink-0"
    data-testid="daemon-slot"
  >
    <PadiSubChip />
    <span class="w-px self-stretch bg-edge-bright/60" aria-hidden="true" />
    <KavalSubChip />
  </div>
);

export default DaemonSlot;
