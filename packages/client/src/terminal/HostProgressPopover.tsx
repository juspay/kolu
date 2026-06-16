/** A log of a remote host's dial progress (P3) — the `nix copy`/realise output
 *  and the remote watcher's stderr the server streams while dialing, so a
 *  minute-long cold dial (and any failure) is legible instead of a static amber
 *  dot. Anchored under the host chip; opened from `HostChip` when the host is
 *  mid-lifecycle (provisioning / unreachable) and has progress to show. Mirrors
 *  `PrUnavailablePopover`'s anchored-popover shape. */

import { type Component, For, Show } from "solid-js";
import { Portal } from "solid-js/web";
import {
  type ClientDaemonState,
  DAEMON_STATE_PRESENTATION,
} from "../kaval/useDaemonStatus";
import { surface } from "../ui/Surface";
import { useAnchoredPopover } from "../ui/useAnchoredPopover";

/** Drop the `[local]`/`[remote]` source tag the server prefixes — the message
 *  already reads clearly, the tag is noise for the user. */
export function stripProgressTag(line: string): string {
  return line.replace(/^\[(?:local|remote)\]\s*/, "");
}

const HostProgressPopover: Component<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef?: HTMLElement;
  hostId: string;
  state: ClientDaemonState;
  lines: string[];
}> = (props) => {
  const { panelRef, panelStyle } = useAnchoredPopover({
    triggerRef: () => props.triggerRef,
    open: () => props.open,
    onDismiss: () => props.onOpenChange(false),
    anchor: "bottom-start",
    panelMinWidth: 360,
  });

  const chrome = surface({ radius: "xl", portalled: true });

  return (
    <Show when={props.open}>
      <Portal>
        <div
          ref={panelRef}
          data-testid="terminal-host-progress"
          role="dialog"
          aria-label={`${props.hostId} connection log`}
          class={`fixed z-50 ${chrome.class} p-2.5 w-[360px] max-w-[90vw]`}
          style={{ ...panelStyle(), ...chrome.style }}
        >
          <div class="flex items-center gap-1.5 mb-1.5 text-xs">
            <span class="font-medium text-fg">{props.hostId}</span>
            <span class="text-fg-3">
              {DAEMON_STATE_PRESENTATION[props.state].label}
            </span>
          </div>
          <Show
            when={props.lines.length > 0}
            fallback={<p class="text-fg-3 text-xs">No activity yet.</p>}
          >
            <div class="font-mono text-[11px] leading-relaxed text-fg-2 max-h-56 overflow-y-auto space-y-0.5">
              <For each={props.lines}>
                {(line) => (
                  <div class="whitespace-pre-wrap break-words">
                    {stripProgressTag(line)}
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </Portal>
    </Show>
  );
};

export default HostProgressPopover;
