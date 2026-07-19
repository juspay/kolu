import { useSurfaceApp } from "@kolu/surface-app/solid";
import type { KoluBuildInfo } from "kolu-common/surface";
import type { Component } from "solid-js";
import { Show } from "solid-js";
import { match, P } from "ts-pattern";
import { formatUptime } from "../kaval/daemonPresentation";
import type { WsStatus } from "../rpc/rpc";
import { getClockNow } from "../time/clock";
import Commit, { REPO_URL } from "./Commit";
import { OpenIcon } from "./Icons";
import InfoDialogShell, { DetailRow, VersionChip } from "./InfoDialog";
import { mbText } from "./memory";
import { clientStale, StaleBadge } from "./StaleBadge";
import { clientHeapUsedBytes, serverRssBytes } from "./useMemoryUsage";
import { serverStartedAt } from "./useProcessUptime";

function statusLabel(status: WsStatus, live: boolean): string {
  return match<[WsStatus, boolean], string>([status, live])
    .with(["open", true], () => "connected")
    .with(["open", false], () => "reconnecting")
    .with(["connecting", P._], () => "connecting")
    .with(["closed", P._], () => "disconnected")
    .exhaustive();
}

const KoluInfoDialog: Component<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: WsStatus;
  live: boolean;
  dotClass: string;
  triggerRef: () => HTMLElement | undefined;
}> = (props) => {
  const pwa = useSurfaceApp<KoluBuildInfo>();
  const server = () => pwa.server();
  const clockNow = getClockNow();

  return (
    <InfoDialogShell
      open={props.open}
      onOpenChange={props.onOpenChange}
      size="sm"
      logoSrc="/favicon.svg"
      name="Kolu"
      triggerRef={props.triggerRef}
      version={
        // The server version is a connected-era fact off `pwa.server()` — gate on
        // `props.live` like the uptime row below (#1793), so a dead/half-open transport
        // never asserts a definite "v5.2" beside a "disconnected" status pill.
        <Show when={props.live && server()?.version}>
          {(v) => <VersionChip>v{v()}</VersionChip>}
        </Show>
      }
      description="App server and browser client."
    >
      <div class="rounded-lg border border-edge bg-surface-2 px-3 py-2.5">
        <div class="flex items-center justify-between gap-3">
          <div class="flex min-w-0 items-center gap-2">
            <span
              class={`inline-block h-2 w-2 rounded-full ${props.dotClass}`}
            />
            <span class="text-xs font-medium text-fg">
              {statusLabel(props.status, props.live)}
            </span>
            {/* kolu-server's uptime, mirroring the Kaval dialog: `now − startedAt`,
                shown only over a LIVE transport with a known boot time — a dead/half-
                open link can't confirm the server is still up, so show nothing rather
                than an age climbing off the local clock (the `0` seed reads null). */}
            <Show when={props.live && serverStartedAt()}>
              {(t) => (
                <span class="truncate text-[11px] tabular-nums text-fg-3">
                  up {formatUptime(clockNow() - t())}
                </span>
              )}
            </Show>
          </div>
          <Show when={clientStale()}>
            <StaleBadge />
          </Show>
        </div>
      </div>

      <div class="space-y-1">
        <DetailRow label="server commit">
          {/* The server commit is a connected-era fact — gate on `props.live` (#1793), so a
              dead transport reads an honest "—" rather than a stale SHA. The BROWSER commit
              below is a local build constant (not delivered over the transport), so it stays
              ungated. */}
          <Commit sha={props.live ? server()?.commit : undefined} />
        </DetailRow>
        <DetailRow label="browser commit">
          <Commit sha={pwa.clientCommit} />
        </DetailRow>
        <DetailRow label="memory">
          {/* kolu-server's RSS and this browser's JS heap — the two processes this
              dialog names. padi and kaval have their own host-chip marks +
              dialogs, so their RSS reads out there rather than being folded in here. */}
          <span>
            server {mbText(serverRssBytes())}
            <span class="text-fg-3"> / </span>
            browser {mbText(clientHeapUsedBytes())}
          </span>
        </DetailRow>
      </div>

      <a
        href={REPO_URL}
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex items-center gap-1.5 rounded-md border border-edge bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-fg-2 transition-colors hover:bg-surface-3/60 hover:text-fg"
      >
        GitHub
        <OpenIcon class="h-3.5 w-3.5" />
      </a>
    </InfoDialogShell>
  );
};

export default KoluInfoDialog;
