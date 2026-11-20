import type { EntryState } from "@kolu/surface-map";
import { type HostKey, hostKeysEqual as sameHost } from "kolu-common/hostKey";
import type { PadiLink, ProcessRss } from "kolu-common/surface";
import type { SkewVersionPair } from "kolu-common/surfacesWithPadi";
import type { Component, Setter } from "solid-js";
import { createEffect, createMemo, createSignal, Show } from "solid-js";
import { match, P } from "ts-pattern";
import {
  DAEMON_UNKNOWN_LABEL,
  type KavalPresence,
  kavalPresencePresentation,
  presenceState,
  toKavalPresence,
} from "../kaval/daemonPresentation";
import KavalInfoDialog, { KAVAL_LOGO_URL } from "../kaval/KavalInfoDialog";
import { type KavalAttention, kavalAttention } from "../kaval/kavalCurrency";
import { restartInFlight } from "../kaval/useDaemonRestart";
import {
  daemonTransportLive,
  formatUptime,
  type PadiEntry,
} from "../kaval/useDaemonStatus";
import PadiInfoDialog, { PADI_LOGO_URL } from "../padi/PadiInfoDialog";
import {
  type PadiPresence,
  padiPresencePresentation,
  presenceLink,
  toPadiPresence,
} from "../padi/padiPresentation";
import { getClockNow } from "../time/clock";
import {
  dualDaemonSlotClass,
  IdentityMark,
  identityMarkBtnClass,
  StatusDot,
} from "../ui/IdentityMark";
import { joinTip } from "../ui/joinTip";
import { formatMiB } from "@kolu/byte-units";
import Tip from "../ui/Tip";
import { activeHost, padiMap, setActiveHost } from "../wire";
import { hostGlance, hostLabel, KAVAL_CHAIN_UNKNOWN } from "./hostChipTone";
import { useHostKaval } from "./useHostKaval";

const ENTRY_AS_PADI_LINK: Record<EntryState["kind"], PadiLink | undefined> = {
  connected: "connected",
  warming: "connecting",
  failed: "degraded",
  unobservable: undefined,
  "not-a-member": undefined,
};
function entryAsPadiLink(state: EntryState): PadiLink | undefined {
  return ENTRY_AS_PADI_LINK[state.kind];
}

function skewPairFor(host: HostKey): SkewVersionPair | undefined {
  const state = padiMap.entry(host).state();
  if (
    state.kind !== "failed" ||
    state.failure.cause !== "contract-skew-refused"
  )
    return undefined;
  const { running, expected } = state.failure;
  return { running, expected };
}

function useHostPadi(host: HostKey): {
  live: () => boolean;
  entry: () => PadiEntry;
  link: () => PadiLink | undefined;
} {
  const live = daemonTransportLive;
  const entry = (): PadiEntry => padiMap.entry(host).state();
  const link = (): PadiLink | undefined =>
    live() ? entryAsPadiLink(entry()) : undefined;
  return { live, entry, link };
}

function useHostProcessMemory(host: HostKey) {
  return padiMap.entry(host).cells.processMemory.use();
}

function formatProcessMemoryText(m: ProcessRss | undefined): string {
  return match(m)
    .with({ status: "ok" }, (d) => `RSS ${formatMiB(d.rssBytes, 0)}`)
    .with({ status: "error" }, () => "memory poll failed")
    .with({ status: "absent" }, () => "memory unavailable")
    .with(P.nullish, () => "memory unavailable")
    .exhaustive();
}

const PadiMark: Component<{ presence: PadiPresence }> = (props) => (
  <IdentityMark logoSrc={PADI_LOGO_URL} imgClass="host-daemon-logo">
    <StatusDot
      data-padi-link={presenceLink(props.presence)}
      class={padiPresencePresentation(props.presence).dot}
    />
  </IdentityMark>
);

const KavalMark: Component<{
  presence: KavalPresence;
  attention?: KavalAttention["kind"];
}> = (props) => (
  <IdentityMark logoSrc={KAVAL_LOGO_URL} imgClass="host-daemon-logo">
    <StatusDot
      data-daemon-state={presenceState(props.presence)}
      class={kavalPresencePresentation(props.presence).dot}
    />
    <Show
      when={props.attention === "stale" || props.attention === "incompatible"}
    >
      <span
        data-testid="kaval-update-pip"
        data-attention={props.attention}
        class={`absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full border border-surface-2 ${props.attention === "incompatible" ? "bg-danger" : "bg-amber-500"}`}
        aria-hidden="true"
      />
    </Show>
  </IdentityMark>
);

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
  const closeWhenActiveHostMovesAway = (): void => {
    if (open() && !sameHost(activeHost(), host)) setOpen(false);
  };
  createEffect(closeWhenActiveHostMovesAway);
  return { open, setOpen, openForHost };
}

const PadiSubChip: Component<{
  host: HostKey;
  mem: ReturnType<typeof useHostProcessMemory>;
}> = (props) => {
  const { open, setOpen, openForHost } = useDaemonMarkOpen(props.host);
  let triggerEl!: HTMLButtonElement;
  const padi = useHostPadi(props.host);
  const identity = padiMap.entry(props.host).cells.identity.use();
  const presence = createMemo(() =>
    toPadiPresence(padi.link(), padi.live(), identity.value()),
  );
  const padiVersion = (): string | undefined => {
    const p = presence();
    return p.kind === "connected" ? p.identity.surfaceVersion : undefined;
  };
  const padiStartedAt = (): number | null => {
    const raw = identity.value()?.startedAt;
    if (raw === undefined) return null;
    return padiMap.entry(props.host).clock.toLocal(raw) ?? null;
  };
  const padiMemoryText = (): string => {
    if (!padi.live() || padi.entry().kind !== "connected")
      return "memory unavailable";
    return formatProcessMemoryText(props.mem.value()?.padi);
  };
  const padiTip = (): string => {
    const skew = skewPairFor(props.host);
    return joinTip(
      `padi ${padi.live() ? hostGlance(padi.entry(), KAVAL_CHAIN_UNKNOWN).title : DAEMON_UNKNOWN_LABEL}`,
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
          <PadiMark presence={presence()} />
        </button>
      </Tip>
      <Show when={open()}>
        <PadiInfoDialog
          open={open()}
          onOpenChange={setOpen}
          presence={presence()}
          startedAt={padiStartedAt()}
          triggerRef={() => triggerEl}
          hostLabel={hostLabel(props.host)}
        />
      </Show>
    </>
  );
};

const KavalSubChip: Component<{
  host: HostKey;
  mem: ReturnType<typeof useHostProcessMemory>;
}> = (props) => {
  const { open, setOpen, openForHost } = useDaemonMarkOpen(props.host);
  let triggerEl!: HTMLButtonElement;
  const clockNow = getClockNow();
  const kaval = useHostKaval(props.host);
  const padiStatus = padiMap.entry(props.host).cells.status.use();
  const presence = createMemo(() =>
    toKavalPresence(kaval.daemon(), kaval.live()),
  );
  const kavalVersion = (): string | undefined => {
    const p = presence();
    return p.kind === "connected" ? p.contractVersion : undefined;
  };
  const kavalStateText = (): string =>
    kavalPresencePresentation(presence()).label;
  const kavalUptimeText = (): string | undefined => {
    if (!kaval.live() || kaval.daemon()?.state !== "connected")
      return undefined;
    const startedAt = kaval.daemon()?.startedAt;
    return startedAt === undefined || startedAt <= 0
      ? undefined
      : `running ${formatUptime(clockNow() - startedAt)}`;
  };
  const kavalMemoryText = (): string => {
    if (!kaval.live() || kaval.daemon()?.state !== "connected")
      return "memory unavailable";
    return formatProcessMemoryText(props.mem.value()?.kaval);
  };
  const attention = (): KavalAttention =>
    kavalAttention(
      padiStatus.value()?.expectedKaval?.staleKey,
      kaval.daemon(),
      kaval.live(),
    );
  const kavalUpdateText = (): string | undefined => {
    const a = attention();
    if (a.kind === "incompatible")
      return `incompatible — speaks ${a.daemonVersion}, kolu needs ${a.requiredVersion}; update needed`;
    if (a.kind === "stale") {
      const expected = padiStatus.value()?.expectedKaval;
      return expected?.navigableCommit
        ? `newer build ${expected.navigableCommit.slice(0, 7)} available`
        : "newer build available";
    }
    return undefined;
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
          <KavalMark presence={presence()} attention={attention().kind} />
        </button>
      </Tip>
      <Show when={open()}>
        <KavalInfoDialog
          open={open()}
          onOpenChange={setOpen}
          presence={presence()}
          attention={attention()}
          restartInFlight={restartInFlight(kaval.daemon())}
          triggerRef={() => triggerEl}
          hostLabel={hostLabel(props.host)}
        />
      </Show>
    </>
  );
};

const InteractiveDaemonMarks: Component<{ host: HostKey }> = (props) => {
  const mem = useHostProcessMemory(props.host);
  return (
    <>
      <PadiSubChip host={props.host} mem={mem} />
      <KavalSubChip host={props.host} mem={mem} />
    </>
  );
};

export const HostDualDaemonSlot: Component<{ host: HostKey }> = (props) => (
  <div
    class={dualDaemonSlotClass}
    data-testid="host-dual-daemon-slot"
    data-filled=""
    data-interactive=""
  >
    <InteractiveDaemonMarks host={props.host} />
  </div>
);
