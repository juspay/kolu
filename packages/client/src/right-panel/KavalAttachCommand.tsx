/** The Inspector's "drive this terminal from your shell" affordance: a short
 *  explanation for anyone who's never met kaval, then a copy-pasteable
 *  `kaval-tui attach <id> --socket <path>` command for the active terminal.
 *
 *  - **Short id, full on hover.** The button shows and copies the 8-char short
 *    id (the same form `kaval-tui list` prints; kaval-tui resolves any unique
 *    prefix back to the full uuid); the `title` reveals the full id.
 *  - **--socket is pinned.** The inspector belongs to ONE kolu server, which
 *    runs its own port-namespaced kaval daemon — auto-discovery only works when
 *    exactly one daemon is live on the box, so we name THIS server's socket to
 *    make the pasted command unambiguous regardless of what else is running. It
 *    goes after the id so the long path truncates off the visible end rather
 *    than hiding the id; before the daemon status (and its socketPath) has
 *    loaded, the bare command is shown and auto-discovery covers the gap.
 *
 *  Composes the shared `CopyCommandButton`, which uses `writeTextToClipboard`
 *  so copy survives the plain-HTTP / Tailscale contexts kolu is often reached
 *  over. */

import type { TerminalId } from "kolu-common/surface";
import type { Component } from "solid-js";
import { localDaemonStatus } from "../kaval/useDaemonStatus";
import CopyCommandButton from "../ui/CopyCommandButton";
import { CopyIcon } from "../ui/Icons";

const SHORT_ID_LEN = 8;

const KavalAttachCommand: Component<{ terminalId: TerminalId }> = (props) => {
  const cmd = (id: string) => {
    const socket = localDaemonStatus()?.socketPath;
    const base = `kaval-tui attach ${id}`;
    return socket ? `${base} --socket ${socket}` : base;
  };

  return (
    <div class="space-y-1.5">
      <p class="text-[11px] leading-relaxed text-fg-3">
        Drive this terminal from any shell with{" "}
        <span class="font-mono text-fg-2">kaval-tui</span>, kolu's terminal CLI
        — it takes over the very same session.{" "}
        <a
          href="https://kolu.dev/kaval/"
          target="_blank"
          rel="noopener noreferrer"
          class="text-accent hover:underline"
        >
          Learn more&nbsp;↗
        </a>
      </p>
      <CopyCommandButton
        command={cmd(props.terminalId.slice(0, SHORT_ID_LEN))}
        title={cmd(props.terminalId)}
        testId="inspector-attach-command"
        rounded="rounded-md"
        idle={<CopyIcon class="w-3 h-3" />}
      />
    </div>
  );
};

export default KavalAttachCommand;
