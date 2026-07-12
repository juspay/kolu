/** KavalInfoDialog - compact identity panel for a host-chip Kaval mark.
 *
 *  See `PadiInfoDialog.tsx`'s header for the shared HOST-SCOPING CLASSIFICATION TABLE
 *  (every per-host field either re-keys on `activeHost` or is host-independent with a
 *  reason). This dialog's own fields are ALL host-scoped: `props.status` rides
 *  `localDaemonStatus()` (the active host's RETAINED per-host
 *  `activeScope().wire.daemonStatus`, W9),
 *  `daemonChannelLive()` reads `padiMap.entry(activeHost())` directly, and
 *  `boundHostKavals()`/`localScanKavals()` ride `useHostInventory`/`useDaemonInventory`
 *  per that same table. */

import type { DaemonStatus } from "@kolu/padi/surface";
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
} from "../ui/useHostInventory";
import { kavalMemoryDisplay } from "../ui/useMemoryUsage";
import {
  formatLifetime,
  type KavalPresence,
  toKavalPresence,
} from "./daemonPresentation";
import { expectedKaval } from "./KavalUpdateBadge";
import { kavalStale } from "./kavalCurrency";
import RestartKavalButton from "./RestartKavalButton";
import { restartDaemon } from "./useDaemonRestart";
import {
  DAEMON_STATE_PRESENTATION,
  formatUptime,
  kavalDot,
} from "./useDaemonStatus";

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
  status: DaemonStatus | undefined;
  triggerRef: () => HTMLElement | undefined;
  /** Host this panel describes — shown under the title so the anchor is obvious. */
  hostLabel: string;
  /** Channel liveness for THIS host's status (not necessarily the canvas active host). */
  live: boolean;
}> = (props) => {
  const clockNow = getClockNow();
  // Floored on props.live (this host's channel), not the canvas active host's
  // daemonChannelLive — so a panel opened on an inactive host still paints that
  // host honestly without switching the canvas.
  const presence = createMemo<KavalPresence>(() =>
    toKavalPresence(props.status, props.live),
  );
  const connected = ():
    | Extract<KavalPresence, { kind: "connected" }>
    | undefined => {
    const p = presence();
    return p.kind === "connected" ? p : undefined;
  };
  const pending = (): boolean =>
    kavalStale(
      expectedKaval()?.staleKey,
      props.status?.identity?.staleKey,
      props.status?.state,
      props.live,
    );
  // Opening a daemon icon switches the canvas to that host first, so these
  // active-host readouts keep the same information surface as master.
  const convergePending = (): boolean =>
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
        <Show when={props.status?.contractVersion}>
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
        <Show
          when={props.status}
          fallback={<span class="text-xs text-fg-3">status unavailable</span>}
        >
          {(s) => (
            <div class="flex min-w-0 items-center gap-2">
              <span
                class={`inline-block h-2 w-2 rounded-full ${kavalDot(s().state, props.live)}`}
              />
              <Show
                when={props.live}
                fallback={
                  <span class="text-xs font-medium text-fg-3">unknown</span>
                }
              >
                <span class="text-xs font-medium text-fg">
                  {DAEMON_STATE_PRESENTATION[s().state].label}
                </span>
              </Show>
              <Show when={props.live && s().startedAt}>
                {(t) => (
                  <span class="truncate text-[11px] tabular-nums text-fg-3">
                    up {formatUptime(clockNow() - t())}
                  </span>
                )}
              </Show>
            </div>
          )}
        </Show>
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
          <Show
            when={daemonScanBoundHost()}
            fallback={
              <span title={props.status?.socketPath}>
                {props.status?.socketPath ?? "unavailable"}
              </span>
            }
          >
            {(host) => (
              <span title={props.status?.socketPath}>ssh · {host()}</span>
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

      <Show when={pending()}>
        <div class="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs leading-relaxed">
          <p class="font-medium text-warning">Newer Kaval build available</p>
          <p class="mt-1 flex flex-wrap items-center gap-x-1.5 font-mono text-[11px] text-fg-3">
            <span>running</span>
            <Commit sha={props.status?.identity?.navigableCommit} />
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

      <div class="space-y-2">
        <RestartKavalButton
          status={props.status}
          tone="neutral"
          onConfirm={() => {
            props.onOpenChange(false);
            void restartDaemon();
          }}
        />
        <p class="text-[11px] leading-relaxed text-fg-3">
          Captures the session first, then offers restore on the fresh daemon.
        </p>
        <Show when={convergePending()}>
          <p class="text-[11px] leading-relaxed text-fg-3">
            Restart converges kaval to the padi address.
          </p>
        </Show>
      </div>

      <RunningDaemonsSection
        noun="kaval"
        testidPrefix="kaval"
        boundHost={daemonScanBoundHost()}
        live={boundHostInventoryLive()}
        boundHostRows={boundHostKavals()}
        localScanRows={localScanKavals()}
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
