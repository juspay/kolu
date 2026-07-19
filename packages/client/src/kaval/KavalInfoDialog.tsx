/** KavalInfoDialog - compact identity panel for a host-chip Kaval mark.
 *
 *  See `PadiInfoDialog.tsx`'s header for the shared HOST-SCOPING CLASSIFICATION TABLE
 *  (every per-host field either re-keys on `activeHost` or is host-independent with a
 *  reason). This dialog's own fields are ALL host-scoped: `props.presence` is
 *  `toKavalPresence(kaval.daemon(), kaval.live())` folded AT THE CALL SITE
 *  (`HostDaemonChips`) over the active host's RETAINED per-host `daemonStatus` (W9) and
 *  its channel liveness (`daemonChannelLive()`, `padiMap.entry(activeHost())`), and
 *  `boundHostKavals()`/`localScanKavals()` ride `useHostInventory`/`useDaemonInventory`
 *  per that same table. */

import { isCleanRef } from "@kolu/surface-app";
import type { RunningKaval } from "kolu-common/surface";
import type { Component } from "solid-js";
import { createMemo, Show } from "solid-js";
import { match, P } from "ts-pattern";
import { getClockNow } from "../time/clock";
import Commit, { REPO_URL } from "../ui/Commit";
import { OpenIcon } from "../ui/Icons";
import InfoDialogShell, { DetailRow, VersionChip } from "../ui/InfoDialog";
import { formatMBCompact } from "../ui/memory";
import RunningDaemonsSection from "../ui/RunningDaemonsSection";
import { daemonScanBoundHost, localScanKavals } from "../ui/useDaemonInventory";
import {
  boundHostInventoryLive,
  boundHostKavals,
  boundHostScan,
} from "../ui/useHostInventory";
import { kavalMemoryDisplay } from "../ui/useMemoryUsage";
import {
  formatLifetime,
  type KavalPresence,
  kavalPresencePresentation,
  offerRestartVerb,
} from "./daemonPresentation";
import { expectedKaval } from "./KavalUpdateBadge";
import type { KavalAttention } from "./kavalCurrency";
import RestartKavalButton from "./RestartKavalButton";
import UpdateKavalButton from "./UpdateKavalButton";
import { restartDaemon } from "./useDaemonRestart";
import { daemonTransportLive, formatUptime } from "./useDaemonStatus";

export const KAVAL_LOGO_URL = new URL(
  "../../../kaval/logo.svg",
  import.meta.url,
).href;

/** A "—" for an honestly-unknown value (a probe the server couldn't read), so the row
 *  never fabricates a zero/version. */
const dash = "—";

/** One row in the "Running kaval daemons" diagnostic list — a discovered kaval with
 *  its gate pid, live terminal count, contract/build, and a badge marking whether kolu
 *  actively uses it (or flagging a LEGACY port-keyed one not owned by any padi — the
 *  leak signal). */
const RunningKavalRow: Component<{ kaval: RunningKaval }> = (props) => (
  <li class="rounded-lg border border-edge bg-surface-1 px-2.5 py-2">
    <div class="flex min-w-0 flex-wrap items-center gap-1.5">
      <span class="min-w-0 flex-1 truncate text-[11px] font-medium text-fg">
        {props.kaval.label}
      </span>
      <Show when={props.kaval.held.active}>
        <span class="shrink-0 rounded-full border border-accent/40 bg-accent/10 px-1.5 text-[9px] font-medium leading-4 text-accent">
          in use by kolu
        </span>
      </Show>
      {/* A legacy `kaval-<port>/` that is NOT the held one — a genuine un-adopted
          pre-W2.2 stray. The leak signal. */}
      <Show when={!props.kaval.held.active && props.kaval.kind === "port"}>
        <span class="shrink-0 rounded-full border border-warning/40 bg-warning/10 px-1.5 text-[9px] font-medium leading-4 text-warning">
          legacy · not owned by padi
        </span>
      </Show>
    </div>
    {/* The HELD kaval still at the pre-padi legacy address — padi ADOPTED it on
        upgrade (PTYs kept). A known, converging state, NOT a leak: it's kolu's live
        kaval, just at its old socket until it next recycles. Neutral tone (not the
        warning the stray gets). */}
    <Show when={props.kaval.held.active && props.kaval.held.atLegacyAddress}>
      <p class="mt-1 text-[10px] leading-4 text-fg-3">
        pre-padi address · converges on next kaval restart or reboot
      </p>
    </Show>
    <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] tabular-nums text-fg-3">
      <span>gate pid {props.kaval.gatePid ?? dash}</span>
      <span>
        {props.kaval.terminalCount ?? dash}
        {props.kaval.terminalCount === 1 ? " terminal" : " terminals"}
      </span>
      <span>contract {props.kaval.contractVersion ?? dash}</span>
      <span class="inline-flex items-center gap-1">
        build
        <Show when={props.kaval.buildCommit} fallback={<span>{dash}</span>}>
          {(sha) => <Commit sha={sha()} />}
        </Show>
      </span>
    </div>
    <div
      class="mt-1 truncate font-mono text-[10px] text-fg-3"
      title={props.kaval.socket}
    >
      {props.kaval.socket}
    </div>
  </li>
);

const KavalInfoDialog: Component<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** THIS host's daemon presence — the dialog's SOLE daemon input. There is no raw
   *  `status` prop: a connected-era fact (contractVersion, socketPath, build commit,
   *  uptime, lifetime) can only be read off `presence`'s `connected` arm, which
   *  `toKavalPresence` (folded at the CALL SITE on this host's channel liveness) yields
   *  only over a live link. "render a fact while not live" is therefore a type error
   *  (#1793), not a review catch. */
  presence: KavalPresence;
  /** The joined attention verdict (SK5) — folded at the call site (already floored on
   *  liveness), so the update/skew banners can't be painted over a dead channel either. */
  attention: KavalAttention;
  /** Whether a kaval restart is in flight — gates the Restart button. Computed at the
   *  call site (`restartInFlight`), so the dialog needs no raw status for it. */
  restartInFlight: boolean;
  triggerRef: () => HTMLElement | undefined;
  /** Host this panel describes — shown under the title so the anchor is obvious. */
  hostLabel: string;
}> = (props) => {
  const clockNow = getClockNow();
  // The presence's dot + word + text tone, as ONE value from ONE match — a single memo
  // read at the dot span, the label span, and its text-tone class (the SolidJS
  // multi-consumer idiom), so the three facets can't drift.
  const presentation = createMemo(() =>
    kavalPresencePresentation(props.presence),
  );
  const connected = ():
    | Extract<KavalPresence, { kind: "connected" }>
    | undefined => {
    const p = props.presence;
    return p.kind === "connected" ? p : undefined;
  };
  const pending = (): boolean => props.attention.kind === "stale";
  const incompatible = () => {
    const a = props.attention;
    return a.kind === "incompatible" ? a : undefined;
  };
  // Opening a daemon icon switches the canvas to that host first, so these
  // active-host readouts keep the same information surface as master. Floored on
  // `boundHostInventoryLive()` (#1793): a dead/drained inventory cell freezes its rows
  // stale, so an unfloored read would show a converge nudge over a channel that can no
  // longer confirm it — the same class the presence fold closes for the fact rows.
  const convergePending = (): boolean =>
    boundHostInventoryLive() &&
    boundHostKavals().some((k) => k.held.active && k.held.atLegacyAddress);

  return (
    <InfoDialogShell
      open={props.open}
      onOpenChange={props.onOpenChange}
      size="md"
      logoSrc={KAVAL_LOGO_URL}
      name="Kaval"
      contextLabel={props.hostLabel}
      triggerRef={props.triggerRef}
      version={
        // The contract badge is a connected-era FACT — read off the `connected` arm only,
        // so a stale-but-truthy version can't paint over a dead channel (#1793).
        <Show when={connected()?.contractVersion}>
          {(v) => <VersionChip>contract v{v()}</VersionChip>}
        </Show>
      }
      description="PTY daemon that owns the live terminals."
    >
      <div class="space-y-2 rounded-lg border border-edge bg-surface-2 px-3 py-2.5">
        {/* Bound-host identity: name the REMOTE host prominently (remote bind only) — the
            bound kaval lives on that machine. Local bind → no line (unchanged). */}
        <Show when={daemonScanBoundHost()}>
          {(host) => (
            <div class="flex min-w-0 items-center gap-1.5 text-[11px]">
              <span class="text-fg-3">bound to</span>
              <span class="truncate rounded bg-surface-1 px-1.5 py-0.5 font-mono font-medium text-fg">
                ssh · {host()}
              </span>
            </div>
          )}
        </Show>
        {/* Dot + word + text tone are projected from `presence` (the ONE
            {@link kavalPresencePresentation}) — there is no raw `state`/`live` here.
            `unknown` (dead/half-open channel or no value) reads grey + "unknown"; uptime
            shows only for a confirmed `connected` kaval (its `startedAt`), never off a
            stale value. */}
        <div class="flex min-w-0 items-center gap-2">
          <span
            class={`inline-block h-2 w-2 rounded-full ${presentation().dot}`}
          />
          <span class={`text-xs font-medium ${presentation().textClass}`}>
            {presentation().label}
          </span>
          <Show when={connected()?.startedAt}>
            {(t) => (
              <span class="truncate text-[11px] tabular-nums text-fg-3">
                up {formatUptime(clockNow() - t())}
              </span>
            )}
          </Show>
        </div>
      </div>

      <div class="space-y-1">
        <DetailRow label="build commit">
          {/* Routed through `connected()` (P4): a confirmed-connected kaval's build
              commit is present BY CONSTRUCTION (no `??`/ternary escape hatch); a
              non-connected/not-yet-identified/channel-dead kaval passes `undefined`,
              which `<Commit>` renders as an honest "—" — never a synthesized dash
              beside a claimed-connected state. */}
          <Commit sha={connected()?.identity.navigableCommit} />
        </DetailRow>
        <DetailRow label="socket">
          {/* Local bind → the bound kaval's unix socket. Remote bind → the kaval lives on
              the ssh host, so its socketPath is a path THERE (not locally meaningful);
              name the host instead, matching PadiInfoDialog. The real remote path stays in
              the title for diagnostics. */}
          {/* The socket path is a connected-era FACT — read off the `connected` arm only,
              so a stale path can't leak over a dead channel (#1793). */}
          <Show
            when={daemonScanBoundHost()}
            fallback={
              <span title={connected()?.socketPath}>
                {connected()?.socketPath ?? "unavailable"}
              </span>
            }
          >
            {(host) => (
              <span title={connected()?.socketPath}>ssh · {host()}</span>
            )}
          </Show>
        </DetailRow>
        <DetailRow label="memory">
          {/* Same {@link kavalMemoryDisplay} source the host-chip tooltip reads,
              so the dialog and the rail tooltip can't drift: `ok` → the RSS
              figure; `error` → an honest poll-failure marker; `null` (no daemon /
              stale link) → unavailable. padi owns kaval now, so the RSS rides
              padi's readout, folded into the rail cell server-side. */}
          <span data-testid="kaval-dialog-memory">
            {match(kavalMemoryDisplay())
              .with({ kind: "ok" }, (m) => formatMBCompact(m.rssBytes))
              .with({ kind: "error" }, () => "poll failed")
              .with(P.nullish, () => "unavailable")
              .exhaustive()}
          </span>
        </DetailRow>
        <DetailRow label="lifetime">
          {/* The daemon's lifetime policy — `forever` for a durable production
              kaval; `bound to run pid N` under a test/smoke run (dies with its
              run). Routed through `connected()` (P4): a non-connected or
              pre-lifetime-field survivor kaval reads an honest "—". */}
          <span data-testid="kaval-dialog-lifetime">
            {formatLifetime(connected()?.lifetime)}
          </span>
        </DetailRow>
      </div>

      {/* Contract axis (SK5): the proven skew — down-toned, both versions from
          the TYPED status fields, mutually exclusive with the currency banner
          below by construction (a skewed kaval is never connected). */}
      <Show when={incompatible()}>
        {(skew) => (
          <div
            class="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs leading-relaxed"
            data-testid="kaval-incompatible-banner"
          >
            <p class="font-medium text-danger">Incompatible — needs update</p>
            <p class="mt-1 font-mono text-[11px] text-fg-3">
              kaval speaks {skew().daemonVersion} · kolu needs{" "}
              {skew().requiredVersion}
            </p>
          </div>
        )}
      </Show>
      <Show when={pending()}>
        <div class="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs leading-relaxed">
          <p class="font-medium text-warning">Newer Kaval build available</p>
          <p class="mt-1 flex flex-wrap items-center gap-x-1.5 font-mono text-[11px] text-fg-3">
            <span>running</span>
            {/* The running build is a connected-era fact — a stale kaval that is UPDATE-
                pending is still `connected` (live) in the fold, so this reads the confirmed
                identity, never a raw stale commit over a dead channel (#1793). */}
            <Commit sha={connected()?.identity.navigableCommit} />
            <span>expected</span>
            <Commit sha={expectedKaval()?.navigableCommit} />
          </p>
          <Show when={isCleanRef(expectedKaval()?.navigableCommit)}>
            <a
              href={`${REPO_URL}/commits/${expectedKaval()?.navigableCommit}/packages/kaval`}
              target="_blank"
              rel="noopener noreferrer"
              class="mt-1 inline-flex items-center gap-1 text-[11px] text-accent underline decoration-dotted underline-offset-2 hover:decoration-solid"
            >
              Kaval changes
              <OpenIcon class="h-3 w-3" />
            </a>
          </Show>
        </div>
      </Show>

      {/* The action slot — a total function of the presence sum (SK5, D1, #1793): a proven
          skew offers ONLY the renew (a restart provably respawns the same incompatible
          binary). Otherwise the session-preserving Restart is offered ONLY when
          {@link offerRestartVerb} allows it — a live-confirmed `connected`/`down` — never on
          `unknown` (a dead channel can't carry out the action) or `warming` (already coming
          up). Both the enabled button AND its "captures the session" promise sit inside the
          same gate, so on a dead channel NEITHER renders — the affordance is floored exactly
          like the facts. */}
      <Show
        when={incompatible()}
        fallback={
          <Show when={offerRestartVerb(props.presence)}>
            <div class="space-y-2">
              <RestartKavalButton
                inFlight={props.restartInFlight}
                tone="neutral"
                onConfirm={() => {
                  props.onOpenChange(false);
                  void restartDaemon();
                }}
              />
              <p class="text-[11px] leading-relaxed text-fg-3">
                Captures the session first, then offers restore on the fresh
                daemon.
              </p>
              <Show when={convergePending()}>
                <p class="text-[11px] leading-relaxed text-fg-3">
                  Restart converges kaval to the padi address.
                </p>
              </Show>
            </div>
          </Show>
        }
      >
        <div class="space-y-2">
          <UpdateKavalButton
            tone="neutral"
            onConfirm={() => props.onOpenChange(false)}
          />
          <p class="text-[11px] leading-relaxed text-fg-3">
            Drains the host daemon, re-provisions the current build, and starts
            a correct-version kaval — this host’s terminals restart.
          </p>
        </div>
      </Show>

      <RunningDaemonsSection
        noun="kaval"
        testidPrefix="kaval"
        boundHost={daemonScanBoundHost()}
        scan={boundHostScan()}
        boundHostRows={boundHostKavals()}
        localScanRows={localScanKavals()}
        localScanLive={daemonTransportLive()}
        renderRow={(kaval) => <RunningKavalRow kaval={kaval} />}
      />

      <div class="flex items-center justify-between gap-3 rounded-lg border border-edge bg-surface-2 px-3 py-2.5">
        <div class="min-w-0">
          <h3 class="text-xs font-medium text-fg">Kaval CLI</h3>
          <p class="mt-0.5 text-[11px] leading-relaxed text-fg-3">
            List, attach, snapshot, or create terminals from a shell.
          </p>
        </div>
        <a
          href="https://kolu.dev/kaval/"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-edge bg-surface-1 px-2.5 py-1.5 text-xs font-medium text-fg-2 transition-colors hover:bg-surface-3/60 hover:text-fg"
        >
          Docs
          <OpenIcon class="h-3.5 w-3.5" />
        </a>
      </div>
    </InfoDialogShell>
  );
};

export default KavalInfoDialog;
