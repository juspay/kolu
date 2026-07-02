import { useSurfaceApp } from "@kolu/surface-app/solid";
import type { KoluBuildInfo } from "kolu-common/surface";
import type { Component } from "solid-js";
import { Show } from "solid-js";
import { match, P } from "ts-pattern";
import type { WsStatus } from "../rpc/rpc";
import Commit, { REPO_URL } from "./Commit";
import { OpenIcon } from "./Icons";
import InfoDialogShell, { DetailRow, VersionChip } from "./InfoDialog";
import { mbText } from "./memory";
import { clientStale, StaleBadge } from "./StaleBadge";
import { clientHeapUsedBytes, serverRssBytes } from "./useMemoryUsage";

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
}> = (props) => {
  const pwa = useSurfaceApp<KoluBuildInfo>();
  const server = () => pwa.server();

  return (
    <InfoDialogShell
      open={props.open}
      onOpenChange={props.onOpenChange}
      size="sm"
      logoSrc="/favicon.svg"
      name="Kolu"
      version={
        <Show when={server()?.version}>
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
          </div>
          <Show when={clientStale()}>
            <StaleBadge />
          </Show>
        </div>
      </div>

      <div class="space-y-1">
        <DetailRow label="server commit">
          <Commit sha={server()?.commit} />
        </DetailRow>
        <DetailRow label="browser commit">
          <Commit sha={pwa.clientCommit} />
        </DetailRow>
        <DetailRow label="memory">
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
