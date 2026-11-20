import { runAction } from "../runAction";
import { isCleanRef } from "@kolu/surface-app";
import type { RunningKaval } from "kolu-common/surface";
import type { Component } from "solid-js";
import { createMemo, Show } from "solid-js";
import { match, P } from "ts-pattern";
import { getClockNow } from "../time/clock";
import Commit, { REPO_URL } from "../ui/Commit";
import { docUrl } from "../ui/DocLink";
import { OpenIcon } from "../ui/Icons";
import InfoDialogShell, { DetailRow, VersionChip } from "../ui/InfoDialog";
import { formatMiB } from "@kolu/byte-units";
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

const dash = "—";

type ConnectedKaval = Extract<KavalPresence, { kind: "connected" }>;

const ConnectedFacts: Component<{
  kaval: ConnectedKaval | undefined;
  boundHost: string | null;
}> = (props) => (
  <div class="space-y-1">
    <DetailRow label="build commit">
      <Commit sha={props.kaval?.identity.navigableCommit} />
    </DetailRow>
    <DetailRow label="socket">
      <Show
        when={props.boundHost}
        fallback={
          <span title={props.kaval?.socketPath}>
            {props.kaval?.socketPath ?? "unavailable"}
          </span>
        }
      >
        {(host) => <span title={props.kaval?.socketPath}>ssh · {host()}</span>}
      </Show>
    </DetailRow>
    <DetailRow label="memory">
      <span data-testid="kaval-dialog-memory">
        {match(kavalMemoryDisplay())
          .with({ kind: "ok" }, (m) => formatMiB(m.rssBytes, 0))
          .with({ kind: "error" }, () => "poll failed")
          .with(P.nullish, () => "unavailable")
          .exhaustive()}
      </span>
    </DetailRow>
    <DetailRow label="lifetime">
      <span data-testid="kaval-dialog-lifetime">
        {formatLifetime(props.kaval?.lifetime)}
      </span>
    </DetailRow>
  </div>
);

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
      <Show when={!props.kaval.held.active && props.kaval.kind === "port"}>
        <span class="shrink-0 rounded-full border border-warning/40 bg-warning/10 px-1.5 text-[9px] font-medium leading-4 text-warning">
          legacy · not owned by padi
        </span>
      </Show>
    </div>
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
  presence: KavalPresence;
  attention: KavalAttention;
  restartInFlight: boolean;
  triggerRef: () => HTMLElement | undefined;
  hostLabel: string;
}> = (props) => {
  const clockNow = getClockNow();
  const presentation = createMemo(() =>
    kavalPresencePresentation(props.presence),
  );
  const connected = (): ConnectedKaval | undefined => {
    const p = props.presence;
    return p.kind === "connected" ? p : undefined;
  };
  const pending = (): boolean => props.attention.kind === "stale";
  const incompatible = () => {
    const a = props.attention;
    return a.kind === "incompatible" ? a : undefined;
  };
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
        <Show when={connected()?.contractVersion}>
          {(v) => <VersionChip>contract v{v()}</VersionChip>}
        </Show>
      }
      description="PTY daemon that owns the live terminals."
    >
      <div class="space-y-2 rounded-lg border border-edge bg-surface-2 px-3 py-2.5">
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

      <ConnectedFacts kaval={connected()} boundHost={daemonScanBoundHost()} />

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
                  runAction("restart kaval", restartDaemon());
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
          href={docUrl("kaval")}
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
