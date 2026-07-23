/** Per-host diagnostics popover — the detail that used to crowd every chip.
 *
 *  The strip is exception-based (healthy = silent). Hover/click a chip to open
 *  this panel: connection state (with the real error + reconnect when
 *  unreachable), terminal + awaiting counts, the padi·kaval dual-daemon pair
 *  (diagnostics-on-demand), and remove-with-confirm for guest hosts.
 *
 *  Provisioning progress (#1962) is a deliberate seam: when the entry is
 *  warming we reserve a row so a MiB counter + bar can drop in once that
 *  plumbing lands — this file does NOT invent its own progress plumbing.
 */

import { unenrolledStreamCall } from "@kolu/surface/client";
import { createReactiveSubscription } from "@kolu/surface/solid";
import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
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
import { resetBootDeadline } from "../kaval/bootDeadline";
import { formatTimeAgo } from "../terminal/staleness";
import { surface } from "../ui/Surface";
import { type AnchorSide, useAnchoredPopover } from "../ui/useAnchoredPopover";
import { client, padiMap } from "../wire";
import { HostDualDaemonSlot } from "./HostDaemonChips";
import {
  dotClass,
  hostLabel,
  isHostDown,
  statusLabelShort,
  statusTitle,
} from "./hostChipTone";

const popoverChrome = surface({
  radius: "lg",
  shadow: "light",
  portalled: true,
});

const removeHost = (host: HostKey): void => {
  client.hosts
    .remove({ host })
    .catch((err: Error) =>
      toast.error(`Couldn't remove ${hostLabel(host)}: ${err.message}`),
    );
};

/** Force-cycle this host's connector into a fresh dial — same recovery verb
 *  the host-down canvas uses, but keyed on the SPECIFIC host (the canvas
 *  factory always reconnects the active host). */
const reconnectHost = (host: HostKey): void => {
  client.hosts
    .reconnect({ host })
    .then(() => resetBootDeadline(encodeHostKey(host)))
    .catch((err: Error) =>
      toast.error(`Couldn't reconnect ${hostLabel(host)}: ${err.message}`),
    );
};

const PopoverRow: Component<{
  label: string;
  danger?: boolean;
  children: string | number;
}> = (props) => (
  <div class="flex items-center justify-between gap-4 py-0.5 text-[11px]">
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

export const HostDiagnosticsPopover: Component<{
  host: HostKey;
  triggerRef: () => HTMLElement | undefined;
  open: () => boolean;
  onDismiss: () => void;
  anchor?: AnchorSide;
}> = (props) => {
  const state = () => padiMap.entry(props.host).state();
  const marks = hostMarks(encodeHostKey(props.host));
  const isLocal = () => props.host.kind === "local";
  const [confirmRemove, setConfirmRemove] = createSignal(false);

  // Lightweight keys stream only while the panel is open (`null` input tears
  // it down). Floors to undefined (render "—") until the first frame lands —
  // never a fake 0.
  const terminalKeys = createReactiveSubscription<HostKey, TerminalId[]>(
    () => (props.open() ? props.host : null),
    (host, signal) =>
      unenrolledStreamCall(
        padiMap.entry(host).collections.terminals.unenrolledKeys,
        undefined,
        { signal },
      ),
  );
  const keys = createMemo(() =>
    props.open() && state().kind === "connected" ? (terminalKeys() ?? []) : [],
  );
  // Collection opened at component top level (Solid rule) with empty keys when
  // closed / not connected — so we never hold a live inventory for a closed panel.
  const terminals = padiMap
    .entry(props.host)
    .collections.terminals.use({ keys });

  const terminalCount = (): string => {
    if (!props.open()) return "—";
    const v = terminalKeys();
    return v === undefined ? "—" : String(v.length);
  };

  const lastActivity = (): string => {
    if (!props.open() || state().kind !== "connected") return "—";
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

  // Reset the two-step remove arm whenever the panel closes.
  createEffect(() => {
    if (!props.open()) setConfirmRemove(false);
  });

  const { panelRef, panelStyle } = useAnchoredPopover({
    triggerRef: props.triggerRef,
    open: props.open,
    onDismiss: props.onDismiss,
    anchor: props.anchor ?? "bottom-start",
    panelMinWidth: 280,
  });

  const failureReason = (): string | undefined => {
    const s = state();
    return s.kind === "failed" ? s.failure.reason : undefined;
  };

  return (
    <Show when={props.open()}>
      <Portal>
        <div
          ref={panelRef}
          data-testid="host-diagnostics-popover"
          data-host={encodeHostKey(props.host)}
          class={`fixed z-50 w-[min(18rem,calc(100vw-1rem))] p-3 ${popoverChrome.class}`}
          style={{ ...panelStyle(), ...popoverChrome.style }}
        >
          <div class="mb-2 flex min-w-0 items-center gap-2 text-xs font-medium text-fg">
            <span
              class={`inline-block h-2 w-2 shrink-0 rounded-full ${dotClass(state())}`}
              aria-hidden="true"
            />
            <span class="truncate">{hostLabel(props.host)}</span>
          </div>

          <PopoverRow label="state" danger={isHostDown(state())}>
            {statusLabelShort(state())}
          </PopoverRow>

          <Show when={failureReason()}>
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

          {/* #1962 seam — reserve structure for copy progress; no fake plumbing. */}
          <Show when={state().kind === "warming"}>
            <div
              class="mt-1 rounded-md border border-dashed border-edge/70 px-2 py-1.5"
              data-testid="host-provision-progress"
            >
              <div class="flex items-center justify-between gap-3 text-[10px] text-fg-3">
                <span>provisioning</span>
                <span class="tabular-nums">…</span>
              </div>
              <div class="mt-1 h-1 overflow-hidden rounded-full bg-surface-2">
                <div class="h-full w-0 bg-amber-400/80" />
              </div>
            </div>
          </Show>

          <Show when={state().kind === "failed"}>
            <button
              type="button"
              data-testid="host-diagnostics-reconnect"
              class="mt-1.5 flex w-full items-center justify-between rounded-md px-1.5 py-1 text-left text-[11px] text-fg transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 cursor-pointer"
              onClick={() => reconnectHost(props.host)}
            >
              <span class="text-fg-3">retry now</span>
              <span aria-hidden="true">↻</span>
            </button>
          </Show>

          <div class="my-2 border-t border-edge/60" />

          <PopoverRow label="terminals">{terminalCount()}</PopoverRow>
          <PopoverRow label="awaiting you">{marks.asking()}</PopoverRow>

          <div class="my-2 border-t border-edge/60" />

          <div class="flex items-center justify-between gap-3 py-0.5 text-[11px]">
            <span class="text-fg-3">padi · kaval</span>
            <HostDualDaemonSlot host={props.host} mode="interactive" />
          </div>

          <PopoverRow label="last activity">{lastActivity()}</PopoverRow>

          <Show when={!isLocal()}>
            <div class="my-2 border-t border-edge/60" />
            <Show
              when={confirmRemove()}
              fallback={
                <button
                  type="button"
                  data-testid="host-diagnostics-remove"
                  class="flex w-full items-center rounded-md px-1.5 py-1 text-left text-[11px] text-danger transition-colors hover:bg-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 cursor-pointer"
                  onClick={() => setConfirmRemove(true)}
                >
                  remove host…
                </button>
              }
            >
              <div class="flex items-center gap-2">
                <button
                  type="button"
                  data-testid="host-diagnostics-remove-confirm"
                  class="flex-1 rounded-md bg-danger/15 px-2 py-1 text-[11px] font-medium text-danger transition-colors hover:bg-danger/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 cursor-pointer"
                  onClick={() => {
                    removeHost(props.host);
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

          <span class="sr-only">{statusTitle(state())}</span>
        </div>
      </Portal>
    </Show>
  );
};
