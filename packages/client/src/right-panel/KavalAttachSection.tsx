/** The Inspector's "drive these terminals from your shell" affordance: a short
 *  explanation for anyone who's never met kaval, then a copy-pasteable
 *  `kaval-tui <verb> <id> --socket <path>` command pair — **attach** (take the
 *  session over) and **snapshot** (dump its scrollback) — for the active tile's
 *  main terminal AND each of its splits. Every split is its own PTY in the
 *  daemon with its own id, so each gets its own pair; the tile root and its
 *  splits are labelled only when a split exists (the lone-terminal case stays
 *  label-free).
 *
 *  - **Short id, full on hover.** Each button shows and copies the 8-char short
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
import { type Component, For, Show } from "solid-js";
import { localDaemonStatus } from "../kaval/useDaemonStatus";
import { useTerminalStore } from "../terminal/useTerminalStore";
import CopyCommandButton from "../ui/CopyCommandButton";
import { CopyIcon } from "../ui/Icons";
import { kavalCmd } from "./kavalCmd";

const SHORT_ID_LEN = 8;

/** One terminal's command pair: attach over the top, snapshot under it. Both
 *  follow the same WYSIWYG contract — show/copy the short id, full id on hover. */
const TerminalCommands: Component<{
  terminalId: TerminalId;
  /** This server's kaval socket, resolved once by the section and threaded in. */
  socket: string | undefined;
  /** Shown above the pair when the tile has splits; omitted for a lone terminal. */
  label?: string;
  /** Appended to the `inspector-{verb}-command` testid (`""` for the main). */
  testIdSuffix: string;
}> = (props) => {
  const short = () => props.terminalId.slice(0, SHORT_ID_LEN);
  return (
    <div class="space-y-1">
      <Show when={props.label}>
        {(label) => (
          <p class="text-[10px] font-medium uppercase tracking-wide text-fg-3">
            {label()}
          </p>
        )}
      </Show>
      <CopyCommandButton
        command={kavalCmd("attach", short(), props.socket)}
        title={kavalCmd("attach", props.terminalId, props.socket)}
        testId={`inspector-attach-command${props.testIdSuffix}`}
        rounded="rounded-md"
        idle={<CopyIcon class="w-3 h-3" />}
      />
      <CopyCommandButton
        command={kavalCmd("snapshot", short(), props.socket)}
        title={kavalCmd("snapshot", props.terminalId, props.socket)}
        testId={`inspector-snapshot-command${props.testIdSuffix}`}
        rounded="rounded-md"
        idle={<CopyIcon class="w-3 h-3" />}
      />
    </div>
  );
};

const KavalAttachSection: Component<{ terminalId: TerminalId }> = (props) => {
  const store = useTerminalStore();
  // The tile root plus its splits, in server order. `terminalId` is the active
  // *tile* (workspace root), never a split, so its sub-terminals are exactly the
  // splits beneath it.
  const terminals = () => [
    props.terminalId,
    ...store.getSubTerminalIds(props.terminalId),
  ];
  const hasSplits = () => terminals().length > 1;
  // This server's kaval socket, resolved once and threaded to every row's
  // command builder (kavalCmd pins it after the id; see kavalCmd.ts).
  const socket = () => localDaemonStatus()?.socketPath;
  return (
    <div class="space-y-2.5">
      <p class="text-[11px] leading-relaxed text-fg-3">
        Drive these terminals from any shell with{" "}
        <span class="font-mono text-fg-2">kaval-tui</span>, kolu's terminal CLI:{" "}
        <span class="font-mono text-fg-2">attach</span> takes over the same
        session, <span class="font-mono text-fg-2">snapshot</span> dumps its
        scrollback.{" "}
        <a
          href="https://kolu.dev/kaval/"
          target="_blank"
          rel="noopener noreferrer"
          class="text-accent hover:underline"
        >
          Learn more&nbsp;↗
        </a>
      </p>
      {/* Key by the stable primitive terminal id (not a wrapper object) so a
          metadata/sub-terminal recompute that leaves the ids unchanged reuses
          the existing rows — preserving each `CopyCommandButton`'s "copied"
          flash and avoiding needless DOM churn. The role is derived from
          `<For>`'s index accessor `i()`: item 0 is the main pane, every later
          item is the 1-based Nth split. The label uses `i()` directly (so the
          first split reads "Split 1"); the testid suffix uses `i() - 1` (so it
          reads `-split-0`). Both read from that single `i`, so the main/split
          decision and the off-by-one live in one place. */}
      <For each={terminals()}>
        {(id, i) => {
          const isMain = () => i() === 0;
          return (
            <TerminalCommands
              terminalId={id}
              socket={socket()}
              label={
                isMain() ? (hasSplits() ? "Main" : undefined) : `Split ${i()}`
              }
              testIdSuffix={isMain() ? "" : `-split-${i() - 1}`}
            />
          );
        }}
      </For>
    </div>
  );
};

export default KavalAttachSection;
