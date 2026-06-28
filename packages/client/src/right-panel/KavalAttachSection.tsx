/** The Inspector's "drive these terminals from your shell" affordance. Three
 *  layers, top to bottom:
 *
 *  1. **Per-terminal cards** — one card per live PTY (the active tile's main
 *     terminal AND each split, since every split is its own PTY in the daemon).
 *     Each card heads with its short id (copyable to the full uuid) and offers
 *     the three id-targeted commands as copy-paste buttons: `attach` (take the
 *     session over), `snapshot` (dump its scrollback), and `send` (type a prompt
 *     into it — the verb that lets one agent drive another). The tile root and
 *     its splits are labelled Main / Split N when a split exists; a lone
 *     terminal heads its card with a plain `Terminal` label.
 *  2. **Command reference** — the rest of the `kaval-tui` surface (list, create,
 *     kill) plus its awareness sibling `pulam-tui` (status, watch, wait), as a
 *     compact cheatsheet so the section covers the whole CLI, not just the three
 *     commands a card can pin to an id.
 *  3. **Drive an agent** — the `kaval-tui send` + `pulam-tui wait` + `snapshot`
 *     loop that lets one agent supervise another, pointing at the `/kolu` skill
 *     and the `llm-debate` worked example.
 *
 *  - **Short id, full on hover.** Each command shows and copies the 8-char short
 *    id (the same form `kaval-tui list` prints; kaval-tui resolves any unique
 *    prefix back to the full uuid); the `title` reveals the full id. The card's
 *    own id chip is the exception — it shows the short id but copies the FULL
 *    uuid, the unambiguous form for pasting into any other tool.
 *  - **--socket is pinned.** The inspector belongs to ONE kolu server, which
 *    runs its own port-namespaced kaval daemon — auto-discovery only works when
 *    exactly one daemon is live on the box, so we name THIS server's socket to
 *    make the pasted command unambiguous regardless of what else is running. It
 *    goes after the id so the long path truncates off the visible end rather
 *    than hiding the id; before the daemon status (and its socketPath) has
 *    loaded, the bare command is shown and auto-discovery covers the gap. The
 *    socket is also surfaced once at the foot — as a ready-to-append `--socket
 *    <path>` argument — so the *kaval-tui* reference commands (list/create/kill,
 *    which take no id) can target this server too. It is kaval's pty-host
 *    socket, NOT pulam's: the `pulam-tui` reference rows dial their own
 *    awareness socket (default `$XDG_RUNTIME_DIR/pulam/awareness.sock`), so this
 *    one is deliberately scoped to kaval-tui and never offered for pulam-tui.
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
import { kavalCmd, kavalSocketArg } from "./kavalCmd";

const SHORT_ID_LEN = 8;

/** The `kaval-tui` surface beyond the id-targeted card commands, plus the
 *  awareness sibling `pulam-tui` — a reference cheatsheet so the section
 *  documents the whole CLI. (attach/snapshot/send live in the cards above.) */
const KAVAL_REFERENCE: ReadonlyArray<readonly [string, string]> = [
  ["list", "your live terminals"],
  ["create", "spawn a new terminal"],
  ["kill", "end a terminal the daemon owns"],
];
const PULAM_REFERENCE: ReadonlyArray<readonly [string, string]> = [
  ["status", "snapshot every terminal"],
  ["watch", "follow awareness live"],
  ["wait", "block until an agent's turn ends"],
];

/** One terminal's card: a short-id chip header (copies the full uuid) over the
 *  three id-targeted commands. The commands follow the WYSIWYG contract —
 *  show/copy the short id, full id on hover. */
const TerminalCard: Component<{
  terminalId: TerminalId;
  /** This server's kaval socket, resolved once by the section and threaded in. */
  socket: string | undefined;
  /** Header text for this card — the parent owns the full string. */
  label: string;
  /** Appended to the `inspector-{verb}-command` testid (`""` for the main). */
  testIdSuffix: string;
}> = (props) => {
  const short = () => props.terminalId.slice(0, SHORT_ID_LEN);
  return (
    <div class="rounded-lg border border-edge bg-surface-1/30 p-2 space-y-1.5">
      <div class="flex items-center justify-between gap-2">
        <span class="text-[10px] font-medium uppercase tracking-wide text-fg-3">
          {props.label}
        </span>
        {/* The raw id, copyable — shows the short id (full on hover) but copies
            the FULL uuid so it's unambiguous outside kaval's prefix resolution;
            same value the "Copy terminal ID" palette command copies. */}
        <CopyCommandButton
          command={short()}
          copyText={props.terminalId}
          title={props.terminalId}
          testId={`inspector-id-command${props.testIdSuffix}`}
          rounded="rounded"
          widthClass="w-auto"
          idle={<CopyIcon class="w-3 h-3" />}
        />
      </div>
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
      {/* Unlike attach/snapshot, `send` is a TEMPLATE, not a runnable line: it
          carries a `'<prompt>'` placeholder (kavalCmd) where your text goes,
          because `send` refuses an empty payload. Copying it is the starting
          point for driving an agent in this terminal from a script. */}
      <CopyCommandButton
        command={kavalCmd("send", short(), props.socket)}
        title={kavalCmd("send", props.terminalId, props.socket)}
        testId={`inspector-send-command${props.testIdSuffix}`}
        rounded="rounded-md"
        idle={<CopyIcon class="w-3 h-3" />}
      />
    </div>
  );
};

/** One CLI's reference rows — a verb in mono beside its one-line gloss. */
const ReferenceGroup: Component<{
  cli: string;
  rows: ReadonlyArray<readonly [string, string]>;
}> = (props) => (
  <div class="space-y-1">
    <p class="font-mono text-[10px] text-fg-3/80">{props.cli}</p>
    <div class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
      <For each={props.rows}>
        {([verb, gloss]) => (
          <>
            <span class="font-mono text-[11px] text-fg-2">{verb}</span>
            <span class="text-[11px] text-fg-3 leading-snug">{gloss}</span>
          </>
        )}
      </For>
    </div>
  </div>
);

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
  // This server's kaval socket, resolved once and threaded to every card's
  // command builder (kavalCmd pins it after the id; see kavalCmd.ts).
  const socket = () => localDaemonStatus()?.socketPath;
  return (
    <div class="space-y-3">
      <p class="text-[11px] leading-relaxed text-fg-3">
        Reach these terminals from any shell with{" "}
        <span class="font-mono text-fg-2">kaval-tui</span>, kolu's terminal CLI
        — attach to one, dump its scrollback, or send a prompt to an agent
        inside it.{" "}
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
          the existing cards — preserving each `CopyCommandButton`'s "copied"
          flash and avoiding needless DOM churn. The role is derived from
          `<For>`'s index accessor `i()`: item 0 is the main pane, every later
          item is the 1-based Nth split. The label uses `i()` directly (so the
          first split reads "Split 1"); the testid suffix uses `i() - 1` (so it
          reads `-split-0`). Both read from that single `i`, so the main/split
          decision and the off-by-one live in one place. */}
      <div class="space-y-2">
        <For each={terminals()}>
          {(id, i) => {
            const isMain = () => i() === 0;
            return (
              <TerminalCard
                terminalId={id}
                socket={socket()}
                label={
                  isMain()
                    ? hasSplits()
                      ? "Main"
                      : "Terminal"
                    : `Split ${i()}`
                }
                testIdSuffix={isMain() ? "" : `-split-${i() - 1}`}
              />
            );
          }}
        </For>
      </div>

      {/* The rest of the CLI surface, as reference — so the section covers every
          command, not just the three a card pins to an id. */}
      <div class="space-y-2 border-t border-edge pt-2.5">
        <ReferenceGroup cli="kaval-tui" rows={KAVAL_REFERENCE} />
        <ReferenceGroup cli="pulam-tui · awareness" rows={PULAM_REFERENCE} />
      </div>

      {/* Drive-an-agent callout — the send → wait → snapshot loop, with the
          /kolu skill and llm-debate as the worked example. */}
      <div class="rounded-lg border border-accent/30 bg-accent/10 p-2.5 space-y-1">
        <p class="text-[11px] font-medium text-fg-2">
          Drive one agent from another
        </p>
        <p class="text-[11px] leading-relaxed text-fg-3">
          <span class="font-mono text-fg-2">send</span> it a prompt,{" "}
          <span class="font-mono text-fg-2">wait</span> for its turn to end,{" "}
          <span class="font-mono text-fg-2">snapshot</span> the reply, and
          prompt again. The <span class="font-mono text-fg-2">/kolu</span> skill
          wires this loop —{" "}
          <a
            href="https://github.com/srid/llm-debate"
            target="_blank"
            rel="noopener noreferrer"
            class="text-accent hover:underline"
          >
            llm-debate
          </a>{" "}
          is a worked example.
        </p>
      </div>

      {/* The kaval socket, surfaced once as a ready-to-append `--socket <path>`
          argument — the kaval-tui reference commands take no id, so this is how
          they target THIS server's kaval rather than whatever auto-discovery
          would pick. Scoped to kaval-tui on purpose: pulam-tui dials its own
          awareness socket, so this one is NOT for its status/watch/wait rows. */}
      <Show when={socket()}>
        {(s) => (
          <div class="space-y-1 border-t border-edge pt-2.5">
            <p class="text-[10px] text-fg-3/80">
              This kolu's kaval socket — append it to a{" "}
              <span class="font-mono text-fg-2">kaval-tui</span> reference
              command (list / create / kill) to target this server.
            </p>
            <CopyCommandButton
              command={kavalSocketArg(s())}
              testId="inspector-socket"
              rounded="rounded-md"
              idle={<CopyIcon class="w-3 h-3" />}
            />
          </div>
        )}
      </Show>
    </div>
  );
};

export default KavalAttachSection;
