import { activePadiTerminal } from "@kolu/padi-client/surface";
import { unenrolledStreamCall } from "@kolu/surface/client";
import { createReactiveSubscription } from "@kolu/surface/solid";
import { useSurfaceApp } from "@kolu/surface-app/solid";
import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import type {
  KoluBuildInfo,
  KoluForward,
  TerminalId,
} from "kolu-common/surface";
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  Show,
} from "solid-js";
import { Portal } from "solid-js/web";
import { toast } from "solid-sonner";
import { hostMarks } from "../attention/attentionMarks";
import CopyDiagnosticsButton from "../CopyDiagnosticsButton";
import { ForwardRows } from "../forwards/ForwardRows";
import { servingLink } from "../forwards/terminalServingPort";
import { forwardsForHost } from "../forwards/useForwards";
import { tailOf } from "../kaval/connectCanvasView";
import { failedEpisode } from "../kaval/useDaemonStatus";
import { selectFleetTerminal } from "../palette/fleetActions";
import { runAction } from "../runAction";
import { formatTimeAgo } from "../terminal/staleness";
import { containingTileOf } from "../terminal/terminalTree";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { LogTail, NO_LOG_LINES } from "@kolu/solid-logtail";
import { surface } from "../ui/Surface";
import { type AnchorSide, useAnchoredPopover } from "../ui/useAnchoredPopover";
import { useServerIdentity } from "../useServerIdentity";
import {
  activeHost,
  interpretClientError,
  padiMap,
  setActiveHost,
} from "../wire";
import { HostDualDaemonSlot } from "./HostDaemonChips";
import { hostGlance, hostLabel } from "./hostChipTone";
import { reconnectHost } from "./reconnectHost";
import { removeHost } from "./removeHost";
import HostAgentsSection from "./HostAgentsSection";
import { useHostKavalChain } from "./useHostKaval";

const POPOVER_TAIL_LINES = 4;

const popoverChrome = surface({
  radius: "lg",
  shadow: "light",
  portalled: true,
});

const PopoverRow: Component<{
  label: string;
  danger?: boolean;
  testid?: string;
  children: string | number;
}> = (props) => (
  <div
    class="flex items-center justify-between gap-4 py-0.5 text-[11px]"
    data-testid={props.testid}
  >
    <span
      classList={{
        "text-danger": props.danger,
        "text-fg-3": !props.danger,
      }}
    >
      {props.label}
    </span>
    <span
      class="min-w-0 truncate font-medium tabular-nums"
      classList={{
        "text-danger": props.danger,
        "text-fg": !props.danger,
      }}
    >
      {props.children}
    </span>
  </div>
);

function isOwnedNestedPortal(node: Node): boolean {
  const el = node instanceof Element ? node : node.parentElement;
  return el?.closest?.('[data-testid="info-popover"]') != null;
}

export const HostDiagnosticsPopover: Component<{
  host: HostKey;
  triggerRef: () => HTMLElement | undefined;
  open: () => boolean;
  onDismiss: () => void;
  anchor?: AnchorSide;
}> = (props) => {
  const state = () => padiMap.entry(props.host).state();
  const kaval = useHostKavalChain(props.host);
  const glance = () => hostGlance(state(), kaval());
  const marks = hostMarks(encodeHostKey(props.host));
  const isLocal = () => props.host.kind === "local";
  const store = useTerminalStore();
  const forwards = () => forwardsForHost(props.host);
  const [confirmRemove, setConfirmRemove] = createSignal(false);
  const { hostname } = useServerIdentity();
  const pwa = useSurfaceApp<KoluBuildInfo>();
  const label = () =>
    isLocal() ? (hostname() ?? hostLabel(props.host)) : hostLabel(props.host);

  const terminalKeys = createReactiveSubscription<HostKey, TerminalId[]>(
    () => (props.open() ? props.host : null),
    (host) =>
      unenrolledStreamCall(
        padiMap.entry(host).collections.terminals.unenrolledKeys,
        undefined,
        { label: `terminals.keys[${encodeHostKey(host)}] (popover)` },
      ),
    {
      onError: (err) =>
        interpretClientError(
          { kind: "scopedSub", label: "Terminal list error" },
          err,
          { key: props.host },
        ),
    },
  );
  const keys = createMemo(() =>
    props.open() && state().kind === "connected" ? (terminalKeys() ?? []) : [],
  );
  const terminals = padiMap
    .entry(props.host)
    .collections.terminals.use({ keys });

  const arms = createMemo(
    () =>
      new Map(
        keys().flatMap((id) => {
          const arm = activePadiTerminal(terminals.byKey(id)?.());
          return arm === undefined ? [] : [[id, arm] as const];
        }),
      ),
  );

  const servingFor = (forward: KoluForward) =>
    servingLink({
      port: forward.remotePort,
      candidates: (() => {
        const map = arms();
        return [...map].map(([id, arm]) => {
          const tile = containingTileOf(id, (x) => {
            const a = map.get(x);
            if (a === undefined) return undefined;
            return a.parentId ?? null;
          });
          return {
            id,
            parentId: tile === id ? null : tile,
            ports: arm.ports,
          };
        });
      })(),
      armOf: (id) => arms().get(id),
      activate: (id) => {
        selectFleetTerminal(
          props.host,
          id,
          activeHost(),
          setActiveHost,
          store.activate,
        );
        props.onDismiss();
      },
    });

  const terminalCount = (): string => {
    if (!props.open()) return "—";
    if (terminalKeys.error()) return "error";
    const v = terminalKeys();
    return v === undefined ? "—" : String(v.length);
  };

  const lastActivity = (): string => {
    if (!props.open() || state().kind !== "connected") return "—";
    if (terminalKeys.error()) return "error";
    const idList = terminalKeys();
    if (idList === undefined || idList.length === 0) return "—";
    let max = 0;
    for (const id of idList) {
      const meta = terminals.byKey(id)?.();
      const at = meta?.lastActivityAt;
      if (typeof at === "number" && at > max) max = at;
    }
    return max > 0 ? formatTimeAgo(max) : "—";
  };

  createEffect(() => {
    if (!props.open()) setConfirmRemove(false);
  });

  const { panelRef, panelStyle } = useAnchoredPopover({
    triggerRef: props.triggerRef,
    open: props.open,
    onDismiss: props.onDismiss,
    anchor: props.anchor ?? "bottom-start",
    panelMinWidth: 280,
    isInside: isOwnedNestedPortal,
  });

  const failure = createMemo(() => failedEpisode(state()));
  const failureLog = createMemo(() => {
    const episode = failure();
    return episode === undefined
      ? NO_LOG_LINES
      : tailOf(episode.log, POPOVER_TAIL_LINES);
  });
  const failureWholeLog = createMemo(() => failure()?.log ?? NO_LOG_LINES);

  return (
    <Show when={props.open()}>
      <Portal>
        <div
          ref={panelRef}
          role="dialog"
          aria-label={`Host diagnostics — ${label()}`}
          data-testid="host-diagnostics-popover"
          data-host={encodeHostKey(props.host)}
          class={`fixed z-50 w-[min(18rem,calc(100vw-1rem))] p-3 ${popoverChrome.class}`}
          style={{ ...panelStyle(), ...popoverChrome.style }}
        >
          <div class="mb-2 flex min-w-0 items-center gap-2 text-xs font-medium text-fg">
            <span
              class={`inline-block h-2 w-2 shrink-0 rounded-full ${glance().detailDot}`}
              aria-hidden="true"
            />
            <span class="truncate">{label()}</span>
          </div>

          <PopoverRow label="state" danger={glance().down}>
            {glance().short}
          </PopoverRow>

          <Show when={failure()?.reason}>
            {(reason) => (
              <p
                class="mt-0.5 break-words font-mono text-[10px] leading-4 text-danger/90"
                data-testid="host-diagnostics-error"
                title={reason()}
              >
                {reason()}
              </p>
            )}
          </Show>

          <Show when={failureLog().length > 0}>
            <LogTail
              testid="host-diagnostics-log"
              lines={failureLog()}
              log={failureWholeLog()}
              class="mt-1 max-h-20 overflow-y-auto px-1.5 py-1 text-[10px] leading-4"
              onCopyError={(message) =>
                toast.error(`Failed to copy the log: ${message}`)
              }
            />
          </Show>

          <div
            data-testid="host-provision-progress"
            data-ready="false"
            class="hidden"
            aria-hidden="true"
          />

          <Show when={state().kind === "failed"}>
            <button
              type="button"
              data-testid="host-diagnostics-reconnect"
              class="mt-1.5 flex w-full items-center justify-between rounded-md px-1.5 py-1 text-left text-[11px] text-fg transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 cursor-pointer"
              onClick={() =>
                runAction("reconnect host", reconnectHost(props.host))
              }
            >
              <span class="text-fg-3">retry now</span>
              <span aria-hidden="true">↻</span>
            </button>
          </Show>

          <div class="my-2 border-t border-edge/60" />

          <PopoverRow label="terminals" danger={Boolean(terminalKeys.error())}>
            {terminalCount()}
          </PopoverRow>
          <PopoverRow label="working" testid="host-diagnostics-working">
            {marks.active()}
          </PopoverRow>
          <PopoverRow label="awaiting you">{marks.asking()}</PopoverRow>

          <HostAgentsSection host={props.host} />

          <div class="my-2 border-t border-edge/60" />

          <div class="flex items-center justify-between gap-3 py-0.5 text-[11px]">
            <span class="text-fg-3">padi · kaval</span>
            <HostDualDaemonSlot host={props.host} />
          </div>

          <PopoverRow
            label="last activity"
            danger={Boolean(terminalKeys.error())}
          >
            {lastActivity()}
          </PopoverRow>

          <Show when={forwards().length > 0}>
            <div class="my-2 border-t border-edge/60" />
            <div class="py-0.5 text-[10px] uppercase tracking-wide text-fg-3">
              forwarded ports ·{" "}
              <span class="tabular-nums">{forwards().length}</span>
            </div>
            <ForwardRows forwards={forwards()} servingFor={servingFor} />
          </Show>

          <Show when={!isLocal()}>
            <div class="my-2 border-t border-edge/60" />
            <Show
              when={confirmRemove()}
              fallback={
                <button
                  type="button"
                  data-testid="host-diagnostics-remove"
                  class="flex w-full items-center justify-between gap-4 py-0.5 text-left text-[11px] text-danger transition-colors hover:text-danger/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 cursor-pointer"
                  onClick={() => setConfirmRemove(true)}
                >
                  <span>remove host…</span>
                  <span aria-hidden="true" />
                </button>
              }
            >
              <div class="flex items-center justify-between gap-2 py-0.5">
                <button
                  type="button"
                  data-testid="host-diagnostics-remove-confirm"
                  class="rounded-md bg-danger/15 px-2 py-1 text-[11px] font-medium text-danger transition-colors hover:bg-danger/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 cursor-pointer"
                  onClick={() => {
                    runAction("remove host", removeHost(props.host));
                    props.onDismiss();
                  }}
                >
                  confirm remove
                </button>
                <button
                  type="button"
                  data-testid="host-diagnostics-remove-cancel"
                  class="rounded-md px-2 py-1 text-[11px] text-fg-3 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 cursor-pointer"
                  onClick={() => setConfirmRemove(false)}
                >
                  cancel
                </button>
              </div>
            </Show>
          </Show>

          <div class="my-2 border-t border-edge/60" />
          <CopyDiagnosticsButton
            serverBuild={pwa.server()}
            class="flex w-full items-center justify-between gap-4 py-0.5 text-left text-[11px] text-fg-3 transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 cursor-pointer"
          >
            copy diagnostics
          </CopyDiagnosticsButton>

          <span class="sr-only">{glance().title}</span>
        </div>
      </Portal>
    </Show>
  );
};
