/** Active-host Padi + Kaval dual marks for the host chip (host-first chrome).
 *
 *  Mounted INSIDE every `HostChip` as a FIXED-width dual-daemon slot. Fill is
 *  derived from the chip's `host` vs `activeHost()` (never a free boolean) so
 *  the content always matches the host whose facts the children read. Inactive
 *  chips leave the same outer box empty — host-switch reflow is impossible.
 *
 *  COMPACTION: resting state is icon + status dot only. Steady versions, skew
 *  pairs, mem/update detail live in tooltips and the info dialogs — never as
 *  always-on bar chrome inside the fixed slot.
 *
 *  Padi glance status is the ACTIVE host's map entry (`activeEntryState`), not
 *  kolu-server's host-independent local `padiLink`. */

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
import KavalInfoDialog, { KAVAL_LOGO_URL } from "../kaval/KavalInfoDialog";
import { kavalUpdatePending } from "../kaval/KavalUpdateBadge";
import {
  activeEntryState,
  DAEMON_STATE_PRESENTATION,
  daemonChannelLive,
  daemonTransportLive,
  formatUptime,
  kavalDot,
  localDaemonStatus,
} from "../kaval/useDaemonStatus";
import PadiInfoDialog, { PADI_LOGO_URL } from "../padi/PadiInfoDialog";
import { getClockNow } from "../time/clock";
import { IdentityMark, StatusDot } from "../ui/IdentityMark";
import { joinTip } from "../ui/joinTip";
import { formatMBCompact } from "../ui/memory";
import Tip from "../ui/Tip";
import { activePadiIdentity } from "../ui/useHostInventory";
import { kavalMemoryDisplay, padiMemoryDisplay } from "../ui/useMemoryUsage";
import { activeHost, padiMap } from "../wire";
import { dotClass, sameHost, statusTitle } from "./hostChipTone";

/** Outer dual-daemon slot — fixed on every host chip (active fill / inactive empty).
 *  No overflow-hidden: the active chip is already `bg-surface-3`, and we need the
 *  sub-chip hover wash + focus ring to paint cleanly without being clipped. */
const DUAL_DAEMON_SLOT_CLASS =
  "flex h-7 w-[3.25rem] shrink-0 items-center justify-center";

// Hover wash must contrast against the active host chip's `bg-surface-3` (the
// dual slot only ever fills on the active chip). `hover:bg-surface-3/55` was
// invisible there — use a light overlay instead, same family as other chrome.
const subChipClass =
  "pointer-events-auto shrink-0 relative flex h-7 w-[1.5rem] items-center justify-center rounded-md leading-4 text-fg-2 transition-colors hover:bg-white/10 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 cursor-pointer";

/** Map entry → dialog's legacy `PadiLink` vocabulary. Exhaustive on kind so a
 *  new entry arm is a compile error here, not a silent `default`. */
const ENTRY_AS_PADI_LINK: Record<EntryState["kind"], PadiLink | undefined> = {
  connected: "connected",
  warming: "connecting",
  failed: "degraded",
  "not-a-member": undefined,
};
function entryAsPadiLink(state: EntryState): PadiLink | undefined {
  return ENTRY_AS_PADI_LINK[state.kind];
}

/** Active-host contract skew pair, when the map entry failed that way. Tip-only. */
function activeSkewPair(): SkewVersionPair | undefined {
  const state = padiMap.entry(activeHost()).state() as PadiEntryStatus;
  if (state.kind !== "failed" || state.cause !== "contract-skew-refused")
    return undefined;
  const { running, expected } = state as SkewVersionPair;
  return { running, expected };
}

/** The Padi sub-chip — icon + active-host entry dot. */
const PadiSubChip: Component = () => {
  const [open, setOpen] = createSignal(false);
  const daemonLive = daemonTransportLive;
  const entry = activeEntryState;
  const padiVersion = (): string | undefined =>
    activePadiIdentity()?.surfaceVersion;
  const padiMemoryText = (): string =>
    match(padiMemoryDisplay())
      .with({ kind: "ok" }, (d) => `RSS ${formatMBCompact(d.rssBytes)}`)
      .with({ kind: "error" }, () => "memory poll failed")
      .with(P.nullish, () => "memory unavailable")
      .exhaustive();
  const padiTip = (): string => {
    const skew = activeSkewPair();
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
          onClick={() => setOpen(true)}
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
              class={daemonLive() ? dotClass(entry()) : "bg-fg-3/40"}
            />
          </IdentityMark>
        </button>
      </Tip>
      <PadiInfoDialog
        open={open()}
        onOpenChange={setOpen}
        link={linkForDialog()}
      />
    </>
  );
};

/** The Kaval sub-chip — icon + daemon-state dot. */
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
      <Tip label={kavalTip()}>
        <button
          type="button"
          data-testid="kaval-identity-chip"
          onClick={() => setOpen(true)}
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
      <KavalInfoDialog open={open()} onOpenChange={setOpen} status={daemon()} />
    </>
  );
};

/** Fixed-width dual-daemon slot for one host control.
 *
 *  `host` is the host this control represents. Fill is derived — never a free
 *  boolean — so content always re-keys with the same host the parent paints.
 *  `measure` forces empty (hidden measuring-row twins). */
export const HostDualDaemonSlot: Component<{
  host: HostKey;
  measure?: boolean;
}> = (props) => {
  const filled = () => !props.measure && sameHost(activeHost(), props.host);
  return (
    <div
      class={DUAL_DAEMON_SLOT_CLASS}
      data-testid="host-dual-daemon-slot"
      data-filled={filled() ? "" : undefined}
      aria-hidden={filled() ? undefined : true}
    >
      <Show when={filled()}>
        <PadiSubChip />
        <KavalSubChip />
      </Show>
    </div>
  );
};
