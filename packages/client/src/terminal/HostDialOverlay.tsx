/** HostDialOverlay — the connecting screen painted over a remote terminal's
 *  blank xterm while it dials (P3).
 *
 *  A cold ssh dial provisions the remote agent from source — up to a minute of
 *  `nix copy`/realise plus the remote watcher's boot — during which the xterm is
 *  mounted but NOT yet attached: an empty black rectangle. Without this the user
 *  stares at what looks like a hung terminal for ~a minute. This overlays the
 *  host's live dial-progress ring — the SAME `useHostProgress` the title-bar
 *  chip reads — as a full, untruncated, auto-scrolling log right where the gaze
 *  is locked, and removes itself the instant the host leaves its dial lifecycle
 *  (`inLifecycle` false → connected): the now-live terminal shows straight
 *  through.
 *
 *  Lives in the tile BODY (rendered by `Terminal.tsx`), not the title bar,
 *  because (a) that's where the user looks during a connection and (b) the body
 *  renders on mobile, where the title-bar host chip does NOT — so this is the
 *  only dial feedback a phone user gets. No new server plumbing: the ring
 *  already rides `daemonStatus.progress`.
 *
 *  Stacking: an explicit `z-20` clears xterm's internal canvas layers (z-index
 *  up to 11 in xterm.css) and the search/scroll FABs (z-10), so the screen
 *  actually covers the terminal; Terminal's wrapper is `isolate`d so that
 *  z-index can't escape to the resize-handle's context (ui/stackLayers.ts). The
 *  overlay is `pointer-events-none` — it's purely visual (header + log, nothing
 *  to click), so input always reaches the xterm and there is no window where it
 *  swallows a keystroke as the dial completes and the `<Show>` tears it down
 *  asynchronously. */

import type { TerminalId } from "kolu-common/surface";
import { type Component, createEffect, createMemo, For, Show } from "solid-js";
import {
  type HostProgress,
  toneDot,
  useHostProgress,
} from "../kaval/useDaemonStatus";
import { useTerminalStore } from "./useTerminalStore";

const HostDialOverlay: Component<{ terminalId: TerminalId }> = (props) => {
  const store = useTerminalStore();
  // A terminal is remote when its metadata carries a host location; local
  // terminals (no hostId) render nothing. Reactive via the metadata store.
  const hostId = () => store.getMetadata(props.terminalId)?.location?.hostId;
  return <Show when={hostId()}>{(hid) => <DialScreen hostId={hid()} />}</Show>;
};

/** Resolves the host's prepared progress and gates on the dial lifecycle. The
 *  body+autoscroll live in `DialBody`, which mounts only under the `<Show>` so
 *  its log ref is bound before its effect first runs (and unmounts on connect). */
const DialScreen: Component<{ hostId: string }> = (props) => {
  const progress = createMemo(() => useHostProgress(props.hostId));
  return (
    <Show when={progress().inLifecycle}>
      <DialBody progress={progress()} />
    </Show>
  );
};

const DialBody: Component<{ progress: HostProgress }> = (props) => {
  let logRef: HTMLDivElement | undefined;
  // Pin the newest line in view as the ring grows over the ~minute dial.
  // DialBody mounts only while dialing, so `logRef` is bound by the time this
  // effect first runs (and the For has appended before the effect re-runs).
  createEffect(() => {
    props.progress.lines.length;
    if (logRef) logRef.scrollTop = logRef.scrollHeight;
  });
  return (
    <div
      data-testid="host-dial-overlay"
      data-host-state={props.progress.state}
      class="pointer-events-none absolute inset-0 z-20 flex flex-col gap-3 overflow-hidden bg-surface p-4 sm:p-6"
    >
      <div class="flex items-center gap-2">
        <span
          class={`h-2.5 w-2.5 shrink-0 rounded-full ${toneDot[props.progress.tone]}`}
        />
        <span class="text-sm font-medium text-fg">
          {props.progress.failed
            ? `Couldn't reach ${props.progress.id}`
            : `Connecting to ${props.progress.id}…`}
        </span>
        <span class="text-xs text-fg-3">{props.progress.label}</span>
      </div>
      <div
        ref={logRef}
        class="min-h-0 flex-1 space-y-0.5 overflow-y-auto rounded-md border border-border p-2 font-mono text-[11px] leading-relaxed text-fg-3"
      >
        <For
          each={props.progress.lines}
          fallback={
            <span class="text-fg-3 italic">Starting the remote agent…</span>
          }
        >
          {(line, i) => (
            <div
              class="whitespace-pre-wrap break-words"
              classList={{
                "text-fg-2": i() === props.progress.lines.length - 1,
              }}
            >
              {line}
            </div>
          )}
        </For>
      </div>
    </div>
  );
};

export default HostDialOverlay;
