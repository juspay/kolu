/** DaemonSubChips — the Padi + Kaval status chips that live INSIDE the ACTIVE
 *  host chip (W4 header redesign — "the daemon rail moves into the active host
 *  chip"). Padi and Kaval are PER-HOST facts, so they no longer sit in the
 *  host-independent `IdentityRail` (which now carries the Kolu chip only) —
 *  they ride here, reading the ACTIVE host's own state through the same
 *  `padiMap.useEntry(activeHost)`-backed accessors the rail used to
 *  (`useDaemonStatus`, `useHostInventory`, `padiPresentation`), so switching
 *  the active host re-keys these sub-chips BY CONSTRUCTION — there is no host
 *  param to thread through, and no second tone/identity source to drift from
 *  the retired rail chips.
 *
 *  COMPACTION: resting state is icon + status dot, plus a bare version number
 *  (no "contract" word — that stays a tooltip/dialog word) shown only above the
 *  `lg` breakpoint, mirroring the width-budget rule the Kolu chip follows. Full
 *  detail (state, bound host, memory, uptime, update-pending) stays in the
 *  tooltip/aria-label and the click-through dialog, exactly as it did on the
 *  old rail chips.
 *
 *  DEFERRED SEAM: when the held Skew-UX lands, the Padi sub-chip's version
 *  span becomes a running/expected CONTRACT PAIR instead of one version number
 *  — swap the `padiVersion()` span below for that pair's render; nothing else
 *  here should need to change. */

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

/** A version span shown only once it clears the width budget — the same
 *  `hidden lg:inline` breakpoint approximation the Kolu chip uses (a real
 *  per-chip container-width measurement is a further iteration; this is the
 *  existing chrome-wide convention for "hide until there's room", e.g.
 *  `ChromeBar`'s `toggleBtnClass`). */
const VersionSpan: Component<{ text: string }> = (props) => (
  <span class="hidden tabular-nums text-fg-3 lg:inline">{props.text}</span>
);

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
        <Show when={padiVersion()}>
          {(v) => <VersionSpan text={`v${v()}`} />}
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
        <Show when={kavalVersion()}>
          {(v) => <VersionSpan text={`v${v()}`} />}
        </Show>
        <KavalMemReadout />
        <Show when={kavalUpdatePending()}>
          <KavalUpdateBadge />
        </Show>
      </button>
      <KavalInfoDialog open={open()} onOpenChange={setOpen} status={daemon()} />
    </>
  );
};

/** The pair mounted inside the active host chip — a thin divider, then the two
 *  sub-chips. */
const DaemonSubChips: Component = () => (
  <>
    <span
      class="mx-0.5 h-5 w-px self-center bg-edge-bright/60"
      aria-hidden="true"
    />
    <PadiSubChip />
    <KavalSubChip />
  </>
);

export default DaemonSubChips;
