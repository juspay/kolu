import Dialog from "@corvu/dialog";
import { useSurfaceApp } from "@kolu/surface-app/solid";
import type { KoluBuildInfo } from "kolu-common/surface";
import type { Component, JSX } from "solid-js";
import { Show } from "solid-js";
import type { WsStatus } from "../rpc/rpc";
import Commit, { REPO_URL } from "./Commit";
import { CloseIcon, OpenIcon } from "./Icons";
import { formatMBCompact } from "./memory";
import ModalDialog from "./ModalDialog";
import { surface } from "./Surface";
import { clientStale, StaleBadge } from "./StaleBadge";
import { clientHeapUsedBytes, serverRssBytes } from "./useMemoryUsage";

const chrome = surface({ portalled: true, radius: "xl" });

const DetailRow: Component<{ label: string; children: JSX.Element }> = (
  props,
) => (
  <div class="grid grid-cols-[7rem_minmax(0,1fr)] items-baseline gap-3 text-[11px] leading-5">
    <span class="text-fg-3">{props.label}</span>
    <span class="min-w-0 truncate text-fg-2">{props.children}</span>
  </div>
);

function mbText(bytes: number | null): string {
  return bytes === null ? "unavailable" : formatMBCompact(bytes);
}

function statusLabel(status: WsStatus, live: boolean): string {
  if (status === "open" && !live) return "reconnecting";
  if (status === "open") return "connected";
  if (status === "connecting") return "connecting";
  return "disconnected";
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
  const version = () => server()?.version;

  return (
    <ModalDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      refocusOnClose
      size="sm"
    >
      <Dialog.Content
        class={`${chrome.class} relative overflow-hidden p-0`}
        style={chrome.style}
      >
        <button
          type="button"
          onClick={() => props.onOpenChange(false)}
          class="absolute right-3 top-3 rounded-md p-1 text-fg-3 transition-colors hover:bg-surface-3/60 hover:text-fg"
          aria-label="Close"
        >
          <CloseIcon class="h-4 w-4" />
        </button>

        <div class="border-b border-edge/70 px-5 py-4 pr-10">
          <Dialog.Label class="flex items-center gap-2 text-sm font-semibold text-fg">
            <img src="/favicon.svg" alt="" class="h-6 w-6" />
            <span>Kolu</span>
            <Show when={version()}>
              {(v) => (
                <span class="rounded-md border border-edge bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] font-medium text-fg-2">
                  v{v()}
                </span>
              )}
            </Show>
          </Dialog.Label>
          <Dialog.Description class="mt-1 text-xs text-fg-3">
            App server and browser client.
          </Dialog.Description>
        </div>

        <div class="space-y-4 px-5 py-4">
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
        </div>
      </Dialog.Content>
    </ModalDialog>
  );
};

export default KoluInfoDialog;
