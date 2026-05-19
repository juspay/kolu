/** Placeholder shown in the xterm slot while a remote terminal's PTY is
 *  still being negotiated with the SSH helper. Server-side, the entry is
 *  registered immediately with `meta.connecting: true`; once the helper
 *  hands back a real PtyHandle the flag clears and TerminalContent swaps
 *  this view out for the real `Terminal` component (which then runs its
 *  xterm onMount + attach stream against a live PTY).
 *
 *  Keeping the placeholder structurally separate from Terminal.tsx means
 *  xterm.js never instantiates against a dummy handle — no fake scrollback,
 *  no WebGL context wasted on the connecting window, no risk of double-paint
 *  on the swap. */

import type { TerminalId } from "kolu-common/surface";
import type { Component } from "solid-js";

const TerminalConnecting: Component<{
  terminalId: TerminalId;
  hostId: string;
  visible: boolean;
  isSub?: boolean;
}> = (props) => {
  return (
    <div
      class="w-full h-full flex items-center justify-center"
      classList={{ hidden: !props.visible }}
      data-terminal-id={props.terminalId}
      data-terminal-connecting=""
      data-sub-terminal={props.isSub ? "" : undefined}
    >
      <div class="flex flex-col items-center gap-2 text-fg-3">
        <div
          class="size-4 rounded-full border-2 border-fg-3/30 border-t-fg-1 animate-spin"
          aria-hidden="true"
        />
        <div class="text-xs font-mono">
          Connecting to <span class="text-fg-1">{props.hostId}</span>…
        </div>
      </div>
    </div>
  );
};

export default TerminalConnecting;
