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

import { formatBytes } from "@kolu/byte-units";
import { decodeHostKey } from "kolu-common/hostKey";
import type { OrchestratorState } from "kolu-common/orchestrator";
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js";
import { toast } from "solid-sonner";
import { hostLabel } from "../host/hostChipTone";
import { useFleetTerminalIndex } from "../palette/fleetTerminals";
import { fleetMentionCandidates } from "./mentionCandidates";
import { attachPastedFiles, reattachComposerFiles } from "./attachFiles";
import {
  completionIntent,
  completionQuestion,
  createCompletionHighlight,
} from "./completion";
import {
  clearComposerAttachments,
  composerAttachments,
  composerText,
  dropComposerAttachment,
  sendableAttachments,
  setCompletionOpen,
  setComposerText,
} from "./drafts";
import {
  completeToken,
  dropMention,
  filterMentions,
  type MentionCandidate,
  resolveMentions,
  type TokenQuery,
  tokenQueryAt,
} from "./mentions";
import { thumbnailOf } from "./thumbnails";
import { useOrchestrator } from "./useOrchestrator";

/** A menu is OPEN when its trigger has a token under the caret and rows to
 *  offer. One shape for both menus, so the composer's precedence rule — the
 *  `@` menu wins — is one `??` rather than a branch per reader. */
const openMenu = (
  trigger: "@" | "/",
  token: TokenQuery | null,
  rows: readonly { readonly name: string }[],
) =>
  token === null || rows.length === 0
    ? null
    : { trigger, token, words: rows.map((row) => row.name) };

const OrchestratorComposer: Component<{
  state: OrchestratorState;
}> = (props) => {
  const orch = useOrchestrator();
  const fleet = useFleetTerminalIndex();
  const [caret, setCaret] = createSignal(0);
  let box!: HTMLTextAreaElement;

  /** Every terminal on EVERY host, as the `@` menu offers it. The
   *  conversation's own fleet is not the list: a person naming a terminal it
   *  has never touched is exactly how it gets told about one, and the terminal
   *  they mean is as often on the host they are not looking at. */
  const candidates = createMemo<MentionCandidate[]>(() =>
    fleetMentionCandidates(fleet()),
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

  /** THE OPEN MENU — read by the count the keyboard folds against and by the
   *  row a click takes, so the two can neither disagree about which menu is
   *  open nor re-derive the precedence between them. */
  const menu = createMemo(
    () =>
      openMenu("@", mentionToken(), mentionMatches()) ??
      openMenu("/", commandToken(), commandMatches()),
  );
  /** The highlighted row. One index serves whichever menu is open; it returns
   *  to the top when the QUESTION changes and at no other time, and
   *  `createCompletionHighlight` carries the argument for why the match list
   *  is not allowed to move it. */
  const [selected, setSelected] = createCompletionHighlight(() =>
    completionQuestion(mentionToken(), commandToken()),
  );
  const menuCount = () => menu()?.words.length ?? 0;

  const write = (text: string, position: number): void => {
    setComposerText(text);
    setCaret(position);
    box.value = text;
    box.setSelectionRange(position, position);
    box.focus();
  };

  /** Complete the token under the caret from one row of whichever menu is
   *  open. The mouse and the keyboard land here together, so a click and a Tab
   *  cannot drift apart. */
  const accept = (index: number): void => {
    const open = menu();
    const word = open?.words[index];
    if (open === null || word === undefined) return;
    const next = completeToken(composerText(), open.token, open.trigger, word);
    write(next.text, next.caret);
  };

  /** Keep the highlighted row on screen — the menu scrolls at six or so rows,
   *  and a selection you cannot see is a selection you cannot trust. */
  const revealWhenSelected = (el: HTMLElement, mine: () => boolean): void => {
    createEffect(() => {
      if (mine()) el.scrollIntoView({ block: "nearest" });
    });
  };

  /** A send already on the wire. The box never locks — you may keep typing —
   *  but a second Enter while the first prompt is still unanswered would send
   *  the same words twice, which is what clearing-on-press used to prevent for
   *  free. Now that nothing is cleared until the send is accepted, this is
   *  what prevents it. */
  const [sending, setSending] = createSignal(false);

  const send = (): void => {
    if (sending()) return;
    const text = composerText().trim();
    // An attachment with no words is still a message — "look at this" is the
    // commonest thing a pasted screenshot means. Only a box with neither is
    // nothing to send.
    if (text === "" && composerAttachments().length === 0) return;
    const files = sendableAttachments();
    if (files === null) {
      toast.error(
        "One of those files is still uploading — give it a moment and send again.",
      );
      return;
    }
    setSending(true);
    // NOTHING IS CLEARED UNTIL THE SEND IS ACCEPTED. An attachment this agent
    // cannot be sent, or a message over the cap, is refused before any row
    // exists — so a composer that had already emptied itself would have thrown
    // the message away with nothing on screen left holding it.
    orch.prompt(text, armed(), files, (accepted) => {
      setSending(false);
      if (!accepted) {
        // padi deletes every file a refused prompt named, so the chips still
        // on screen are chips with nothing behind them. Their bytes go back up
        // now, under the same ids, or the NEXT Send would be refused for
        // something the person can neither see nor fix.
        reattachComposerFiles();
        return;
      }
      clearComposerAttachments();
      write("", 0);
    });
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
            {(candidate, index) => (
              <button
                ref={(el) =>
                  revealWhenSelected(el, () => index() === selected())
                }
                type="button"
                data-testid="orchestrator-mention-row"
                data-terminal-id={candidate.terminalId}
                data-host={candidate.host}
                data-selected={index() === selected() ? "" : undefined}
                class="w-full flex items-center gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-surface-2 cursor-pointer"
                classList={{ "bg-surface-2": index() === selected() }}
                // Hover moves the highlight so the mouse and the keyboard never
                // disagree about which row Enter would take.
                onPointerEnter={() => setSelected(index())}
                onClick={() => accept(index())}
              >
                <span class="font-semibold text-fg">{candidate.name}</span>
                {/* WHICH MACHINE. Two hosts can both carry a `main`, and the
                    name alone would offer a person a choice they cannot read.
                    It leads the quiet columns because it is the thing that
                    tells otherwise identical rows apart. */}
                <span
                  data-testid="orchestrator-mention-host"
                  class="font-mono text-[0.6rem] uppercase tracking-[0.1em] text-accent"
                >
                  {hostLabel(decodeHostKey(candidate.host))}
                </span>
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
            {(command, index) => (
              <button
                ref={(el) =>
                  revealWhenSelected(el, () => index() === selected())
                }
                type="button"
                data-testid="orchestrator-command-row"
                data-command={command.name}
                data-selected={index() === selected() ? "" : undefined}
                class="w-full flex items-baseline gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-surface-2 cursor-pointer"
                classList={{ "bg-surface-2": index() === selected() }}
                onPointerEnter={() => setSelected(index())}
                onClick={() => accept(index())}
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
                data-host={mention.host}
                title={mention.intent ?? mention.cwd ?? undefined}
                class="rounded-full bg-accent/15 px-2 py-px font-mono text-[0.68rem] font-semibold text-accent cursor-pointer"
                onClick={() =>
                  write(dropMention(composerText(), mention.name), 0)
                }
              >
                {/* The host rides ON the chip — what is sent is `host/id`, and
                    a chip that showed only the name would hide which of two
                    machines the question is about. */}
                @{mention.name}
                <span class="font-normal text-accent/70">
                  {" "}
                  · {hostLabel(decodeHostKey(mention.host))}
                </span>{" "}
                ×
              </button>
            )}
          </For>
        </div>
      </Show>
      <Show when={composerAttachments().length > 0}>
        <div
          data-testid="orchestrator-attachments"
          class="mb-1.5 flex flex-wrap gap-1.5"
        >
          <For each={composerAttachments()}>
            {(attachment) => (
              <div
                data-testid="orchestrator-attachment-chip"
                data-attachment-id={attachment.id}
                data-mime={attachment.mimeType}
                // The bytes are still going up. The chip says so in its own
                // words AND in an attribute, because a person needs the
                // sentence and a test needs the fact.
                data-uploading={attachment.path === null ? "" : undefined}
                aria-busy={attachment.path === null ? "true" : undefined}
                title={attachment.name}
                class="flex max-w-[12rem] items-center gap-1.5 rounded-md border border-edge-bright bg-surface-1 px-1.5 py-1"
                classList={{ "opacity-60": attachment.path === null }}
              >
                <Show
                  when={thumbnailOf(attachment)}
                  fallback={
                    <span class="truncate text-[0.68rem] text-fg">
                      {attachment.name}
                    </span>
                  }
                >
                  {(src) => (
                    <img
                      data-testid="orchestrator-attachment-thumb"
                      src={src()}
                      alt={attachment.name}
                      class="h-8 w-8 shrink-0 rounded object-cover"
                    />
                  )}
                </Show>
                <Show
                  when={attachment.path === null}
                  fallback={
                    <span class="shrink-0 font-mono text-[0.62rem] text-fg-3">
                      {formatBytes(attachment.bytes)}
                    </span>
                  }
                >
                  <span
                    data-testid="orchestrator-attachment-uploading"
                    class="shrink-0 font-mono text-[0.62rem] text-fg-3"
                  >
                    uploading…
                  </span>
                </Show>
                <button
                  type="button"
                  data-testid="orchestrator-attachment-remove"
                  aria-label={`Remove ${attachment.name}`}
                  class="shrink-0 text-fg-3 hover:text-fg cursor-pointer"
                  onClick={() => dropComposerAttachment(attachment.id)}
                >
                  ×
                </button>
              </div>
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
        onPaste={(event) => {
          // A clipboard carrying files is a paste ABOUT those files — take it
          // over so the browser does not also drop a path (or nothing at all)
          // into the box. A text paste is left entirely alone.
          if (attachPastedFiles(event.clipboardData)) event.preventDefault();
        }}
        onClick={(event) => setCaret(event.currentTarget.selectionStart)}
        onKeyUp={(event) => setCaret(event.currentTarget.selectionStart)}
        onKeyDown={(event) => {
          const intent = completionIntent(
            event.key,
            event.shiftKey,
            menuCount(),
            selected(),
          );
          switch (intent.kind) {
            case "move":
              // The arrows belong to the menu while it is open — without the
              // preventDefault they would also drag the caret through the text
              // under it.
              event.preventDefault();
              setSelected(intent.index);
              return;
            case "accept":
              // Tab must not move focus out of the box, and Enter must not
              // send: the key completed a token, and that is the whole of what
              // it did.
              event.preventDefault();
              accept(intent.index);
              return;
            case "close":
              // Close the menu without leaving the mode — the chord that leaves
              // is the same key, so the menu claims it first. A caret of -1 is
              // outside every token, which is what closes it.
              event.stopPropagation();
              setCaret(-1);
              return;
            case "send":
              event.preventDefault();
              send();
              return;
            case "pass":
              return;
          }
        }}
      />
      <div class="mt-2 flex items-center gap-2.5 font-mono text-[0.65rem] text-fg-3">
        <span>@ terminals</span>
        <span>·</span>
        <span>/ commands</span>
        <span>·</span>
        <span>⇧⏎ newline</span>
        <span>·</span>
        <span>paste or drop a file</span>
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
