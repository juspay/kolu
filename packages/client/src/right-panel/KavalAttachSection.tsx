/** The Inspector's "drive these terminals from your shell" affordance.
 *
 *  Every id-targeted kaval command is `kaval-tui <verb> <id> --socket <same
 *  path>` — so the section renders exactly that shape ONCE: a terminal picker
 *  (Main / Split N, shown only when the tile has splits) × a verb picker
 *  (attach / snapshot / send) driving a single copyable command line, with the
 *  selected terminal's id chip beside them. Six near-identical command boxes
 *  (three verbs × every pane, the socket path repeated in each) collapse to
 *  one row that answers the same questions. Below it:
 *
 *  1. **Drive an agent** — the `kaval-tui send` + `padi-tui wait` + `snapshot`
 *     loop that lets one agent supervise another, pointing at the `/kolu` skill
 *     and the `llm-debate` worked example.
 *  2. **CLI reference** (folded) — the rest of the `kaval-tui` surface (list,
 *     create, kill) plus its workspace sibling `padi-tui` (status, watch, wait,
 *     create), with the ready-to-append `--socket` argument those id-less
 *     commands need to target THIS server.
 *
 *  Contracts carried over from the per-card design (the e2e steps assert them):
 *  - **Short id, full on hover.** The command shows and copies the 8-char short
 *    id (the same form `kaval-tui list` prints; kaval-tui resolves any unique
 *    prefix back to the full uuid); the `title` reveals the full-uuid command.
 *    The id chip is the exception — it shows the short id but copies the FULL
 *    uuid, the unambiguous form for pasting into any other tool.
 *  - **--socket is pinned.** The inspector belongs to ONE kolu server, which
 *    runs its own port-namespaced kaval daemon — auto-discovery only works when
 *    exactly one daemon is live on the box, so we name THIS server's socket to
 *    make the pasted command unambiguous regardless of what else is running. It
 *    goes after the id so the long path truncates off the visible end rather
 *    than hiding the id; before the daemon status (and its socketPath) has
 *    loaded, the bare command is shown and auto-discovery covers the gap. The
 *    reference's standalone `--socket <path>` line is kaval's pty-host socket,
 *    NOT padi's: `padi-tui` dials padi's own socket (inside a kolu terminal
 *    `$PADI_SOCKET` makes padi-tui flagless), so it is deliberately scoped to
 *    kaval-tui and never offered for padi-tui.
 *  - **Testid naming.** The command line carries `inspector-{verb}-command`
 *    for the main pane and `inspector-{verb}-command-split-N` for the Nth
 *    split — the same names the per-card layout used, now one at a time.
 *
 *  Composes the shared `CopyCommandButton`, which uses `writeTextToClipboard`
 *  so copy survives the plain-HTTP / Tailscale contexts kolu is often reached
 *  over. */

import type { TerminalId } from "kolu-common/surface";
import { type Component, createMemo, createSignal, For, Show } from "solid-js";
import { localDaemonStatus } from "../kaval/useDaemonStatus";
import { useTerminalStore } from "../terminal/useTerminalStore";
import CopyCommandButton from "../ui/CopyCommandButton";
import Disclosure from "../ui/Disclosure";
import DocLink from "../ui/DocLink";
import { CopyIcon } from "../ui/Icons";
import { kavalCmd, kavalSocketArg } from "./kavalCmd";

const SHORT_ID_LEN = 8;

const VERBS = ["attach", "snapshot", "send"] as const;
type Verb = (typeof VERBS)[number];

/** The `kaval-tui` surface beyond the id-targeted picker verbs, plus the
 *  workspace sibling `padi-tui` — a reference cheatsheet so the section
 *  documents the whole CLI. (attach/snapshot/send live in the picker above.) */
const KAVAL_REFERENCE: ReadonlyArray<readonly [string, string]> = [
  ["list", "your live terminals"],
  ["create", "spawn a new terminal"],
  ["kill", "end a terminal the daemon owns"],
];
const PADI_REFERENCE: ReadonlyArray<readonly [string, string]> = [
  ["status", "snapshot every terminal"],
  ["watch", "follow the workspace live"],
  ["wait", "block until an agent's turn ends"],
  ["create", "spawn a terminal / split / worktree'd agent"],
];

/** One segment of a picker — pressed state painted via `classList` (not an
 *  `aria-pressed:` variant) so the ARIA fact and the paint share one source. */
const SegButton: Component<{
  pressed: boolean;
  onClick: () => void;
  testId?: string;
  title?: string;
  children: string;
}> = (props) => (
  <button
    type="button"
    aria-pressed={props.pressed}
    data-testid={props.testId}
    title={props.title}
    onClick={props.onClick}
    class="cursor-pointer rounded px-2 py-0.5 font-mono text-[10px] transition-colors"
    classList={{
      "bg-surface-0 text-fg shadow-sm": props.pressed,
      "text-fg-3 hover:text-fg": !props.pressed,
    }}
  >
    {props.children}
  </button>
);

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
  // The tile's panes — `terminalId` is the active *tile* (workspace root), never a
  // split. The store owns what that means (see `getTilePaneIds`).
  const terminals = () => store.getTilePaneIds(props.terminalId);
  const hasSplits = () => terminals().length > 1;
  // This server's kaval socket, resolved once and threaded to the command
  // builder (kavalCmd pins it after the id; see kavalCmd.ts). A memo, not a
  // plain accessor: the command line AND the reference footer read it, so the
  // single store read fans out to every consumer (per the SolidJS convention).
  const socket = createMemo(() => localDaemonStatus()?.socketPath);

  // The selection is a pane ID, not an index into the pane list: an id stays
  // meaningful when the list changes under it, so a split closing while
  // selected needs no clamp — `selectedId` simply stops recognizing it and the
  // command falls back to the tile's own main pane rather than pointing at a
  // terminal that no longer exists.
  const [wantedPane, setWantedPane] = createSignal<TerminalId | null>(null);
  const [verb, setVerb] = createSignal<Verb>("attach");
  /** The pane the command targets. `props.terminalId` IS the tile's main pane
   *  (`getTilePaneIds` is `[tileId, ...splits]`), so it is both the default
   *  selection and the answer when a selected split has since closed. */
  const selectedId = (): TerminalId => {
    const wanted = wantedPane();
    return wanted !== null && terminals().includes(wanted)
      ? wanted
      : props.terminalId;
  };
  const short = () => selectedId().slice(0, SHORT_ID_LEN);
  /** `""` for the main pane, `-split-N` for the (1-based) Nth split — the
   *  testid naming the per-card layout established. */
  const testIdSuffix = () => {
    const i = terminals().indexOf(selectedId());
    return i <= 0 ? "" : `-split-${i - 1}`;
  };
  const paneLabel = (i: number) =>
    i === 0 ? (hasSplits() ? "Main" : "Terminal") : `Split ${i}`;

  return (
    <div class="space-y-3">
      <p class="text-[11px] leading-relaxed text-fg-3">
        Reach these terminals from any shell with{" "}
        <span class="font-mono text-fg-2">kaval-tui</span> — attach, dump
        scrollback, or send a prompt to the agent inside.{" "}
        <DocLink slug="kaval">Learn more&nbsp;↗</DocLink>
      </p>

      <div class="space-y-1.5">
        <div class="flex flex-wrap items-center gap-2">
          <Show when={hasSplits()}>
            <span class="inline-flex gap-0.5 rounded-md border border-edge bg-surface-2 p-0.5">
              <For each={terminals()}>
                {(id, i) => (
                  <SegButton
                    pressed={selectedId() === id}
                    onClick={() => setWantedPane(id)}
                    testId={`inspector-attach-term-${i()}`}
                    title={id}
                  >
                    {paneLabel(i())}
                  </SegButton>
                )}
              </For>
            </span>
          </Show>
          <span class="inline-flex gap-0.5 rounded-md border border-edge bg-surface-2 p-0.5">
            <For each={VERBS}>
              {(v) => (
                <SegButton
                  pressed={verb() === v}
                  onClick={() => setVerb(v)}
                  testId={`inspector-attach-verb-${v}`}
                >
                  {v}
                </SegButton>
              )}
            </For>
          </span>
          {/* The raw id, copyable — shows the short id (full on hover) but
              copies the FULL uuid so it's unambiguous outside kaval's prefix
              resolution; same value the "Copy terminal ID" palette command
              copies. */}
          <span class="ml-auto">
            <CopyCommandButton
              command={short()}
              copyText={selectedId()}
              title={selectedId()}
              testId={`inspector-id-command${testIdSuffix()}`}
              rounded="rounded"
              widthClass="w-auto"
              idle={<CopyIcon class="w-3 h-3" />}
            />
          </span>
        </div>

        <CopyCommandButton
          command={kavalCmd(verb(), short(), socket())}
          title={kavalCmd(verb(), selectedId(), socket())}
          testId={`inspector-${verb()}-command${testIdSuffix()}`}
          rounded="rounded-md"
          idle={<CopyIcon class="w-3 h-3" />}
        />

        {/* Unlike attach/snapshot, `send` is a TEMPLATE, not a runnable line:
            it carries a `'<prompt>'` placeholder (kavalCmd) where your text
            goes, because `send` refuses an empty payload. */}
        <Show when={verb() === "send"}>
          <p class="text-[10px] leading-snug text-fg-3/70">
            Replace <span class="font-mono">'&lt;prompt&gt;'</span> with your
            text — <span class="font-mono">send</span> refuses an empty payload.
          </p>
        </Show>
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
        <p class="text-[11px] leading-relaxed text-fg-3">
          For a hooked agent, wait in <em>two phases</em>:{" "}
          <span class="font-mono text-fg-2">
            padi-tui wait "$id" --until working
          </span>{" "}
          to catch it start, THEN{" "}
          <span class="font-mono text-fg-2">--until awaiting,waiting</span> for
          it to hand back — otherwise a stale{" "}
          <span class="font-mono">awaiting</span> from the previous turn reads
          as done before it even begins.
        </p>
      </div>

      {/* The rest of the CLI surface — reference tier, folded until asked
          for. The kaval socket is surfaced once here, as a ready-to-append
          `--socket <path>` argument, because the kaval-tui reference commands
          take no id and would otherwise fall back to auto-discovery. */}
      <Disclosure summary="kaval-tui · padi-tui reference">
        <div class="space-y-2.5 pt-1">
          <ReferenceGroup cli="kaval-tui" rows={KAVAL_REFERENCE} />
          <ReferenceGroup cli="padi-tui · workspace" rows={PADI_REFERENCE} />
          <Show when={socket()}>
            {(s) => (
              <div class="space-y-1">
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
      </Disclosure>
    </div>
  );
};

export default KavalAttachSection;
