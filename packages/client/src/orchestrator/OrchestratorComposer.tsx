/** The box. It NEVER locks.
 *
 *  A conversation that refuses input while it is thinking is a conversation you
 *  cannot steer: the one moment you most want to say "not that one" is the
 *  moment a turn is running. So typing and sending are always allowed; a
 *  message that arrives mid-turn is QUEUED at the agent and its row says so, and
 *  `■ Stop` is beside Send rather than instead of it.
 *
 *  `@` completes this host's terminals and `/` completes the agent's own
 *  commands. Both are plain text in a plain textarea — see `./mentions` for why
 *  the structured mention is resolved at SEND time rather than carried as a
 *  widget. */

import type { OrchestratorState } from "@kolu/padi-client/orchestrator";
import { activeArm } from "@kolu/padi-client/surface";
import { cwdBasename } from "@kolu/terminal-vocab/terminalKey";
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { composerText, setCompletionOpen, setComposerText } from "./drafts";
import {
  completeToken,
  dropMention,
  filterMentions,
  type MentionCandidate,
  resolveMentions,
  tokenQueryAt,
} from "./mentions";
import { useOrchestrator } from "./useOrchestrator";

const OrchestratorComposer: Component<{
  state: OrchestratorState;
}> = (props) => {
  const orch = useOrchestrator();
  const store = useTerminalStore();
  const [caret, setCaret] = createSignal(0);
  let box!: HTMLTextAreaElement;

  /** Every terminal on this host, as the `@` menu offers it. The fleet is not
   *  the list: a person naming a terminal the conversation has never touched is
   *  exactly how it gets told about one. */
  const candidates = createMemo<MentionCandidate[]>(() =>
    store.terminalIds().flatMap((id) => {
      const meta = store.getMetadata(id);
      if (meta === undefined) return [];
      const info = store.getDisplayInfo(id);
      return [
        {
          terminalId: id,
          name: info?.key.label ?? cwdBasename(meta.cwd),
          intent: meta.intent?.split("\n")[0] ?? null,
          cwd: meta.cwd,
          repo: info?.key.group ?? null,
          state: activeArm(meta)?.agent?.state ?? null,
        },
      ];
    }),
  );

  const mentionToken = () => tokenQueryAt(composerText(), caret(), "@");
  const commandToken = () => tokenQueryAt(composerText(), caret(), "/");
  const mentionMatches = createMemo(() => {
    const token = mentionToken();
    return token === null ? [] : filterMentions(candidates(), token.query);
  });
  const commandMatches = createMemo(() => {
    const token = commandToken();
    if (token === null) return [];
    const needle = token.query.toLowerCase();
    return props.state.commands.filter((command) =>
      command.name.toLowerCase().startsWith(needle),
    );
  });
  // The pane's `Escape` leaves the mode and this component's closes the menu,
  // and exactly one of those may happen per press. The pane reads this fact
  // rather than waiting for an event the composer stops — see `drafts.ts`.
  createEffect(() => {
    setCompletionOpen(
      mentionMatches().length > 0 || commandMatches().length > 0,
    );
  });
  onCleanup(() => setCompletionOpen(false));
  const armed = createMemo(() => resolveMentions(composerText(), candidates()));

  const write = (text: string, position: number): void => {
    setComposerText(text);
    setCaret(position);
    box.value = text;
    box.setSelectionRange(position, position);
    box.focus();
  };

  const send = (): void => {
    const text = composerText().trim();
    if (text === "") return;
    orch.prompt(text, armed());
    write("", 0);
  };

  return (
    <div
      data-testid="orchestrator-composer"
      class="relative border-t border-edge px-3 py-2.5"
    >
      <Show when={mentionMatches().length > 0}>
        <div
          data-testid="orchestrator-mention-menu"
          class="absolute left-3 right-3 bottom-full mb-1 max-h-60 overflow-y-auto rounded-lg border border-edge-bright bg-surface-1 shadow-lg shadow-black/40 p-1.5"
        >
          <For each={mentionMatches()}>
            {(candidate) => (
              <button
                type="button"
                data-testid="orchestrator-mention-row"
                data-terminal-id={candidate.terminalId}
                class="w-full flex items-center gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-surface-2 cursor-pointer"
                onClick={() => {
                  const token = mentionToken();
                  if (token === null) return;
                  const next = completeToken(
                    composerText(),
                    token,
                    "@",
                    candidate.name,
                  );
                  write(next.text, next.caret);
                }}
              >
                <span class="font-semibold text-fg">{candidate.name}</span>
                <Show when={candidate.repo}>
                  {(repo) => (
                    <span class="font-mono text-[0.6rem] uppercase tracking-[0.1em] text-fg-3">
                      {repo()}
                    </span>
                  )}
                </Show>
                <Show when={candidate.intent}>
                  {(intent) => (
                    <span class="truncate text-fg-2">{intent()}</span>
                  )}
                </Show>
                <Show when={candidate.state}>
                  {(state) => (
                    <span class="ml-auto font-mono text-[0.62rem] text-fg-3">
                      {state()}
                    </span>
                  )}
                </Show>
              </button>
            )}
          </For>
        </div>
      </Show>
      <Show when={commandMatches().length > 0}>
        <div
          data-testid="orchestrator-command-menu"
          class="absolute left-3 right-3 bottom-full mb-1 max-h-60 overflow-y-auto rounded-lg border border-edge-bright bg-surface-1 shadow-lg shadow-black/40 p-1.5"
        >
          <For each={commandMatches()}>
            {(command) => (
              <button
                type="button"
                data-testid="orchestrator-command-row"
                data-command={command.name}
                class="w-full flex items-baseline gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-surface-2 cursor-pointer"
                onClick={() => {
                  const token = commandToken();
                  if (token === null) return;
                  const next = completeToken(
                    composerText(),
                    token,
                    "/",
                    command.name,
                  );
                  write(next.text, next.caret);
                }}
              >
                <span class="font-mono font-semibold text-fg">
                  /{command.name}
                </span>
                <Show when={command.description}>
                  {(what) => <span class="truncate text-fg-3">{what()}</span>}
                </Show>
              </button>
            )}
          </For>
        </div>
      </Show>
      <Show when={armed().length > 0}>
        <div class="mb-1.5 flex flex-wrap gap-1.5">
          <For each={armed()}>
            {(mention) => (
              <button
                type="button"
                data-testid="orchestrator-mention-chip"
                data-terminal-id={mention.terminalId}
                title={mention.intent ?? mention.cwd ?? undefined}
                class="rounded-full bg-accent/15 px-2 py-px font-mono text-[0.68rem] font-semibold text-accent cursor-pointer"
                onClick={() =>
                  write(dropMention(composerText(), mention.name), 0)
                }
              >
                @{mention.name} ×
              </button>
            )}
          </For>
        </div>
      </Show>
      <textarea
        ref={box}
        data-testid="orchestrator-input"
        rows={3}
        placeholder="Ask the orchestrator… @ for a terminal, / for a command"
        class="w-full resize-none rounded-[0.6rem] border border-edge-bright bg-surface-0 px-2.5 py-2 text-[0.82rem] text-fg outline-none focus:border-accent"
        value={composerText()}
        onInput={(event) => {
          setComposerText(event.currentTarget.value);
          setCaret(event.currentTarget.selectionStart);
        }}
        onClick={(event) => setCaret(event.currentTarget.selectionStart)}
        onKeyUp={(event) => setCaret(event.currentTarget.selectionStart)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            // Close a completion menu without leaving the mode — the chord that
            // leaves is the same key, so the menu has to claim it first.
            if (mentionMatches().length > 0 || commandMatches().length > 0) {
              event.stopPropagation();
              setCaret(-1);
            }
            return;
          }
          if (event.key !== "Enter" || event.shiftKey) return;
          event.preventDefault();
          send();
        }}
      />
      <div class="mt-2 flex items-center gap-2.5 font-mono text-[0.65rem] text-fg-3">
        <span>@ terminals</span>
        <span>·</span>
        <span>/ commands</span>
        <span>·</span>
        <span>⇧⏎ newline</span>
        <span class="flex-1" />
        <Show when={props.state.phase === "working"}>
          <button
            type="button"
            data-testid="orchestrator-stop"
            class="rounded-md border border-danger/50 px-2.5 py-1 text-danger cursor-pointer"
            onClick={() => orch.cancel()}
          >
            ■ Stop
          </button>
        </Show>
        <button
          type="button"
          data-testid="orchestrator-send"
          class="rounded-md bg-accent px-3 py-1 font-semibold text-surface-0 cursor-pointer"
          onClick={send}
        >
          Send ↵
        </button>
      </div>
    </div>
  );
};

export default OrchestratorComposer;
