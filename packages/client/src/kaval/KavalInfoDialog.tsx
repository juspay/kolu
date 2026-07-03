/** KavalInfoDialog - compact identity panel for the Kaval rail chip. */

import type { DaemonStatus } from "@kolu/padi/surface";
import { isCleanRef } from "@kolu/surface-app";
import type { Component } from "solid-js";
import { Show } from "solid-js";
import { getClockNow } from "../time/clock";
import Commit, { REPO_URL } from "../ui/Commit";
import { OpenIcon } from "../ui/Icons";
import InfoDialogShell, { DetailRow, VersionChip } from "../ui/InfoDialog";
import { expectedKaval } from "./KavalUpdateBadge";
import { kavalStale } from "./kavalCurrency";
import RestartKavalButton from "./RestartKavalButton";
import { restartDaemon } from "./useDaemonRestart";
import {
  DAEMON_STATE_PRESENTATION,
  daemonTransportLive,
  formatUptime,
  kavalDot,
} from "./useDaemonStatus";

export const KAVAL_LOGO_URL = new URL(
  "../../../kaval/logo.svg",
  import.meta.url,
).href;

const KavalInfoDialog: Component<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: DaemonStatus | undefined;
}> = (props) => {
  const clockNow = getClockNow();
  const pending = (): boolean =>
    kavalStale(
      expectedKaval()?.staleKey,
      props.status?.identity?.staleKey,
      props.status?.state,
      daemonTransportLive(),
    );

  return (
    <InfoDialogShell
      open={props.open}
      onOpenChange={props.onOpenChange}
      size="md"
      logoSrc={KAVAL_LOGO_URL}
      name="Kaval"
      version={
        <Show when={props.status?.contractVersion}>
          {(v) => <VersionChip>contract v{v()}</VersionChip>}
        </Show>
      }
      description="PTY daemon that owns the live terminals."
    >
      <div class="rounded-lg border border-edge bg-surface-2 px-3 py-2.5">
        <Show
          when={props.status}
          fallback={<span class="text-xs text-fg-3">status unavailable</span>}
        >
          {(s) => (
            <div class="flex min-w-0 items-center gap-2">
              <span
                class={`inline-block h-2 w-2 rounded-full ${kavalDot(s().state, daemonTransportLive())}`}
              />
              <Show
                when={daemonTransportLive()}
                fallback={
                  <span class="text-xs font-medium text-fg-3">unknown</span>
                }
              >
                <span class="text-xs font-medium text-fg">
                  {DAEMON_STATE_PRESENTATION[s().state].label}
                </span>
              </Show>
              <Show when={daemonTransportLive() && s().startedAt}>
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
          <Commit sha={props.status?.identity?.navigableCommit} />
        </DetailRow>
        <DetailRow label="socket">
          <span title={props.status?.socketPath}>
            {props.status?.socketPath ?? "unavailable"}
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
      </div>

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
