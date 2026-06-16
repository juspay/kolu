/** A log of a remote host's dial progress (P3) — the `nix copy`/realise output
 *  and the remote watcher's stderr the server streams while dialing, so a
 *  minute-long cold dial (and any failure) is legible instead of a static amber
 *  dot. Anchored under the host chip; toggled by `HostProgressButton` (this
 *  file) when the host is mid-lifecycle (provisioning / unreachable) and has
 *  progress to show. Mirrors `PrUnavailablePopover`/`PrUnavailableButton`'s
 *  anchored-popover + trigger shape. */

import {
  type Component,
  createEffect,
  createSignal,
  For,
  Show,
} from "solid-js";
import { Portal } from "solid-js/web";
import {
  type ClientDaemonState,
  DAEMON_STATE_PRESENTATION,
  type HostProgress,
  toneDot,
} from "../kaval/useDaemonStatus";
import { surface } from "../ui/Surface";
import { useAnchoredPopover } from "../ui/useAnchoredPopover";

const HostProgressPopover: Component<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef?: HTMLElement;
  /** The host's prepared progress shape — the header reads `id`/`label` from the
   *  SAME object the button tooltip composes from, and `lines` (already
   *  source-tag-stripped by `useHostProgress`) are rendered verbatim. */
  progress: HostProgress;
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
          aria-label={`${props.progress.id} connection log`}
          class={`fixed z-50 ${chrome.class} p-2.5 w-[360px] max-w-[90vw]`}
          style={{ ...panelStyle(), ...chrome.style }}
        >
          <div class="flex items-center gap-1.5 mb-1.5 text-xs">
            <span class="font-medium text-fg">{props.progress.id}</span>
            <span class="text-fg-3">{props.progress.label}</span>
          </div>
          <Show
            when={props.progress.lines.length > 0}
            fallback={<p class="text-fg-3 text-xs">No activity yet.</p>}
          >
            <div class="font-mono text-[11px] leading-relaxed text-fg-2 max-h-56 overflow-y-auto space-y-0.5">
              <For each={props.progress.lines}>
                {(line) => (
                  <div class="whitespace-pre-wrap break-words">{line}</div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </Portal>
    </Show>
  );
};

/** The host chip's health-dot + name button and its anchored progress log, one
 *  component per render site. Owns its own open-state signal and trigger ref —
 *  mirroring `PrUnavailableButton`, so "a chip that toggles an anchored log
 *  popover" is expressed once. The button is the trigger (the dot is colored
 *  from the host's tone); clicking toggles the log only while the host is
 *  mid-lifecycle (warming/failed) with lines to show — a connected host drops
 *  the trigger so its retained dial log can't be reopened as if current. The
 *  sibling inline progress hint stays in `HostChip`. */
export const HostProgressButton: Component<{
  state: ClientDaemonState;
  /** The host's prepared progress — `id`/`label` compose the tooltip (the SAME
   *  object the popover header reads), `lines` feed the popover, `latest` the
   *  tooltip's last line, and the gates decide whether the tooltip surfaces it. */
  progress: HostProgress;
}> = (props) => {
  const tone = () => DAEMON_STATE_PRESENTATION[props.state].tone;
  // The log is offered ONLY mid-lifecycle (provisioning / unreachable) and only
  // when there's something to show. A `connected` host keeps its dial log in the
  // published status (`markConnected` doesn't clear it), but the chip drops the
  // trigger so the stale provisioning output can't be reopened as if current —
  // the same warming/failed gate the inline hints in `HostChip` use, so the dot,
  // the hint, and the popover trigger can't disagree about "still in lifecycle".
  const canOpen = () =>
    (props.progress.warming || props.progress.failed) &&
    props.progress.lines.length > 0;
  const showLatest = () =>
    (props.progress.warming || props.progress.failed) && props.progress.latest;
  const [open, setOpen] = createSignal(false);
  const [triggerEl, setTriggerEl] = createSignal<HTMLElement>();
  // Close (and keep closed) the moment the host leaves the show-progress
  // lifecycle — e.g. a dial that completes while the popover is open mustn't
  // strand the old log on screen over a now-connected host.
  createEffect(() => {
    if (!canOpen()) setOpen(false);
  });
  return (
    <>
      <button
        ref={setTriggerEl}
        type="button"
        data-testid="terminal-host-chip"
        data-host-state={props.state}
        // When there's no log to open the chip is a pure status indicator, not a
        // control: drop it from the tab order and mark it `aria-disabled` so
        // keyboard/AT users aren't handed a focusable no-op (the `<button>`
        // element stays for the e2e contract + the dot's a11y label).
        tabindex={canOpen() ? 0 : -1}
        aria-disabled={!canOpen()}
        class="shrink-0 inline-flex items-center gap-1 rounded-full border border-border bg-transparent px-1.5 text-[9px] leading-4 text-fg-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        classList={{
          "cursor-pointer hover:border-fg-3": canOpen(),
          "cursor-default": !canOpen(),
        }}
        title={`Runs on ${props.progress.id} — ${props.progress.label}${
          showLatest() ? `\n${props.progress.latest}` : ""
        }`}
        onClick={(e) => {
          e.stopPropagation();
          if (canOpen()) setOpen((v) => !v);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onDblClick={(e) => e.stopPropagation()}
      >
        <span class={`h-[7px] w-[7px] rounded-full ${toneDot[tone()]}`} />
        {props.progress.id}
      </button>
      <HostProgressPopover
        open={open()}
        onOpenChange={setOpen}
        triggerRef={triggerEl()}
        progress={props.progress}
      />
    </>
  );
};

export default HostProgressPopover;
