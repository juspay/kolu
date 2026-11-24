/** The box. It NEVER locks.
 *
 *  A conversation that refuses input while it is thinking is a conversation you
 *  cannot steer: the one moment you most want to say "not that one" is the
 *  moment a turn is running. So typing and sending are always allowed; a
 *  message that arrives mid-turn is QUEUED at the agent and its row says so, and
 *  `■ Stop` is beside Send rather than instead of it.
 *
 *  `@` completes EVERY host's terminals — one conversation reaches the whole
 *  fleet — and `/` completes the agent's own commands. Both are plain text in a
 *  plain textarea — see `./mentions` for why the structured mention is resolved
 *  at SEND time rather than carried as a widget.
 *
 *  ONE ROW, and it grows. The box is a single line at rest in every layout,
 *  with `■ Stop` and `Send` beside it; the four-item hints row that stood
 *  under it on a desktop is gone, and the two hints worth keeping are in the
 *  placeholder. The steer chord's hint is in the status line directly above,
 *  where the running turn it belongs to is reported (`ConductorStatus`). */

import { formatBytes } from "@kolu/byte-units";
import { decodeHostKey } from "kolu-common/hostKey";
import type {
  ConductorMention,
  ConductorState,
  ConductorTerminalMention,
  ConductorWorkMention,
} from "kolu-common/conductor";
import type { WorkId } from "kolu-work";
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  Show,
} from "solid-js";
import { toast } from "solid-sonner";
import { hostLabel } from "../host/hostChipTone";
import { CONTEXTUAL_TIPS } from "../settings/tips";
import { useTips } from "../settings/useTips";
import { isDesktop } from "../useMobile";
import { useFleetTerminalIndex } from "../palette/fleetTerminals";
import {
  fleetMentionCandidates,
  workMentionCandidates,
} from "./mentionCandidates";
import { attachPastedFiles, reattachComposerFiles } from "./attachFiles";
import {
  completionIntent,
  completionQuestion,
  createCompletionHighlight,
} from "./completion";
import { useShown } from "../ui/shown";
import {
  clearComposerAttachments,
  composerAttachments,
  composerText,
  dropComposerAttachment,
  sendableAttachments,
  setCompletionOpen,
  setComposerText,
  welcomeAsk,
} from "./drafts";
import {
  armedMentions,
  completeToken,
  dropMention,
  filterMentions,
  type MentionCandidate,
  type TerminalCandidate,
  type TokenQuery,
  tokenQueryAt,
  withScopeMention,
  type WorkCandidate,
} from "./mentions";
import { chatScope, showAllChat } from "./chatScope";
import WorkChip from "./WorkChip";
import WorkChipFace from "./WorkChipFace";
import { useMembership, useNeedsYou, useWorkMap, useWorks } from "./useWorks";
import { sendsAsSteer, steerOnOffer } from "./steer";
import { thumbnailOf } from "./thumbnails";
import { pinTranscript } from "./transcriptScroll";
import { useConductor } from "./useConductor";

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

/** The two arms of a mention, as `<Show>` takes them — the one it is, or
 *  nothing. A work chip and a terminal chip are different drawings of
 *  different facts, and this is what narrows one union to each. */
const asWork = (mention: ConductorMention): ConductorWorkMention | undefined =>
  mention.kind === "work" ? mention : undefined;
const asTerminal = (
  mention: ConductorMention,
): ConductorTerminalMention | undefined =>
  mention.kind === "terminal" ? mention : undefined;

const ConductorComposer: Component<{
  state: ConductorState;
}> = (props) => {
  const orch = useConductor();
  const fleet = useFleetTerminalIndex();
  const works = useWorks();
  const needs = useNeedsYou();
  const workMap = useWorkMap();
  const membership = useMembership();
  const [caret, setCaret] = createSignal(0);
  let box!: HTMLTextAreaElement;

  /** EVERY PIECE OF WORK, then every terminal on EVERY host, as the `@` menu
   *  offers them. The conversation's own fleet is not the list: a person
   *  naming a terminal it has never touched is exactly how it gets told about
   *  one, and the terminal they mean is as often on the host they are not
   *  looking at.
   *
   *  TWO MEMOS AND A CONCAT, because the two halves move at different rates:
   *  the fleet index notifies on any metadata change on any host, and
   *  re-reading every work's standing on each of those ticks would fold the
   *  whole waterfall for a keystroke in a terminal nobody is looking at. */
  const terminalCandidates = createMemo<TerminalCandidate[]>(() =>
    fleetMentionCandidates(fleet(), membership()),
  );
  /** The terminals' words, which a work's word must not be — a set that
   *  moves only when a name does, so the works are not re-read on every
   *  fleet tick. */
  const terminalNames = createMemo<ReadonlySet<string>>(
    () => new Set(terminalCandidates().map((one) => one.name)),
    new Set(),
    {
      equals: (a, b) => a.size === b.size && [...a].every((one) => b.has(one)),
    },
  );
  const workCandidates = createMemo<WorkCandidate[]>(() =>
    workMentionCandidates(works(), needs(), terminalNames()),
  );
  const candidates = createMemo<MentionCandidate[]>(() => [
    ...workCandidates(),
    ...terminalCandidates(),
  ]);

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
  const armed = createMemo(() => armedMentions(composerText(), candidates()));

  /** THE WORK THE CHAT IS POINTED AT: the chip over the box is its face, and
   *  a message sent while it is on carries it whether or not the words named
   *  it. */
  const scope = createMemo(chatScope);
  const scopeMention = (): ConductorWorkMention | null => {
    const at = scope();
    return at === null
      ? null
      : { kind: "work", work: at.id, title: at.record.title };
  };
  /** The menu's two groups, out of the one ranked list. `filterMentions` puts
   *  every work ahead of every terminal, so a terminal's index in the FLAT
   *  list — the one the keyboard moves through — is its own plus the number
   *  of works above it. */
  const workMatches = createMemo(() =>
    mentionMatches().filter((one): one is WorkCandidate => one.kind === "work"),
  );
  const terminalMatches = createMemo(() =>
    mentionMatches().filter(
      (one): one is TerminalCandidate => one.kind === "terminal",
    ),
  );

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

  // THE WELCOME'S EXAMPLE — its request is answered HERE, where the box and
  // its caret live: `write` sets the draft, the caret and the focus together,
  // so the caret cannot be left stale by a caller that only knew the text.
  createEffect(
    on(welcomeAsk, (ask) => {
      if (ask === null) return;
      write(ask.text, ask.text.length);
    }),
  );

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

  /** Steering is ON OFFER — what Alt+Enter does here, and what the status
   *  line above draws its `↯` hint from. */
  const offered = createMemo(() => steerOnOffer(props.state));
  const { showTipOnce } = useTips();
  const shown = useShown();
  // The first conversation that OFFERS steering is the moment the chord is
  // worth announcing — and the only moment it is true. `showTipOnce` keeps it
  // to once per browser, and `shown()` keeps that one announcement from being
  // spent as a toast over a terminal: the pane is retained behind the host
  // tabs, so "it is offering now" can become true while nobody is reading it.
  createEffect(() => {
    if (shown() && offered()) showTipOnce(CONTEXTUAL_TIPS.conductorSteer);
  });

  /** Send what is in the box. `alt` is the chord that was held: it steers only
   *  where the offer stands, and is an ordinary send everywhere else — a
   *  person who learned the chord never loses a message by using it on a
   *  conversation that cannot steer. */
  const send = (alt = false): void => {
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
    const steer = sendsAsSteer(alt, offered());
    orch.prompt(
      text,
      // WHAT THE CHAT IS ABOUT RIDES ALONG: a message sent while the chat is
      // pointed at a work is about that work, typed or not.
      withScopeMention(
        armed().map((one) => one.mention),
        scopeMention(),
      ),
      files,
      steer,
      (accepted) => {
        setSending(false);
        if (!accepted) {
          // kolu-server deletes every file a refused prompt named, so the
          // chips still on screen are chips with nothing behind them. Their
          // bytes go back up now, under the same ids, or the NEXT Send would
          // be refused for something the person can neither see nor fix.
          reattachComposerFiles();
          return;
        }
        // SENDING IS ASKING TO WATCH. Whatever the reader had scrolled up to
        // read, they have just spoken — so the answer, which starts arriving
        // in the next frames, must be the thing on screen.
        pinTranscript();
        clearComposerAttachments();
        write("", 0);
      },
    );
  };

  /** A touch layout. The SHAPE is now the same in both — a growing one-line
   *  box with its buttons beside it — so this is only what the words differ
   *  by: a shorter placeholder and a `Send` with no `↵` on it, because there
   *  is no Enter key to name. */
  const phone = () => !isDesktop();
  // GROWS WITH THE TEXT, in every layout: one line at rest, as tall as what
  // was typed up to its `max-height`, then it scrolls. It was a three-row box
  // on a desktop — two rows of nothing above whatever you were writing, on
  // every conversation — and the phone's growing one-liner is the shape that
  // was right all along. Re-measured on every edit, including a programmatic
  // one (a send clearing it, a completion). An EMPTY box is left at its one
  // row: a browser counts a wrapping placeholder in `scrollHeight`, and the
  // box at rest is one line by definition.
  //
  // NOT MEASURED WHILE THE PANE IS HIDDEN. The pane is retained behind the
  // host tabs and a hidden subtree has no layout at all, so `scrollHeight`
  // there is 0 — a height written from it would pin the box shut, and it
  // would stay shut until the next keystroke. `shown()` is a dependency
  // rather than a guard, so coming back re-measures with real boxes.
  createEffect(() => {
    const text = composerText();
    if (!shown()) return;
    if (text === "") {
      box.style.height = "";
      return;
    }
    box.style.height = "auto";
    // `scrollHeight` is the CONTENT's height — padding in, border out — while
    // the height written here is a border-box height (Tailwind's preflight
    // sets `box-sizing: border-box`). Written bare, the box came up 2px short
    // of its own one-line text and the browser drew a scrollbar with up/down
    // arrows beside "lkjhn". The border the measurement left out is
    // `offsetHeight - clientHeight`; adding it makes the box exactly its
    // content's height, and `max-height` still turns a long message into a
    // scroller once the content passes it.
    box.style.height = `${box.scrollHeight + (box.offsetHeight - box.clientHeight)}px`;
  });

  const stopButton = () => (
    <button
      type="button"
      data-testid="conductor-stop"
      class="shrink-0 whitespace-nowrap rounded-md border border-danger/50 px-2.5 py-1 font-mono text-[0.65rem] text-danger cursor-pointer"
      onClick={() => orch.cancel()}
    >
      ■ Stop
    </button>
  );
  const sendButton = () => (
    <button
      type="button"
      data-testid="conductor-send"
      class={[
        "shrink-0 whitespace-nowrap rounded-md bg-accent px-3 font-mono text-[0.65rem] font-semibold text-surface-0 cursor-pointer",
        { "py-1": !phone(), "py-2": phone() },
      ]}
      // Alt-CLICK steers too, for the same reason Alt+Enter does: the chord is
      // a decision about the message, and a person who holds Alt means it
      // whichever way they then send.
      onClick={(event) => send(event.altKey)}
    >
      {phone() ? "Send" : "Send ↵"}
    </button>
  );

  return (
    <div
      data-testid="conductor-composer"
      // `px-5` — the reading column's own gutter, the same two edges the
      // transcript and the status line are struck from.
      class="relative border-t border-edge px-5 py-2.5"
    >
      <Show when={mentionMatches().length > 0}>
        <div
          data-testid="conductor-mention-menu"
          class="absolute left-5 right-5 bottom-full mb-1 max-h-60 overflow-y-auto rounded-lg border border-edge-bright bg-surface-1 shadow-lg shadow-black/40 p-1.5"
        >
          {/* WORKS FIRST, under their own heading — the thing a person is
              steering comes before the terminals that are how it gets done.
              The two groups are one list to the keyboard: the flat index the
              highlight moves through runs the works and then the terminals,
              which is the order `filterMentions` ranked them in. */}
          <Show when={workMatches().length > 0}>
            <div
              data-testid="conductor-mention-heading"
              class="px-2 pb-0.5 pt-1 font-mono text-[0.6rem] uppercase tracking-[0.12em] text-fg-3"
            >
              Works
            </div>
            <For each={workMatches()} keyed={(candidate) => candidate.work}>
              {(candidate, index) => (
                <button
                  ref={(el) =>
                    revealWhenSelected(el, () => index() === selected())
                  }
                  type="button"
                  data-testid="conductor-mention-row"
                  data-kind="work"
                  data-work={candidate().work}
                  data-selected={index() === selected() ? "" : undefined}
                  class={[
                    "w-full min-w-0 flex items-center gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-surface-2 cursor-pointer",
                    { "bg-surface-2": index() === selected() },
                  ]}
                  onPointerEnter={() => setSelected(index())}
                  onClick={() => accept(index())}
                >
                  {/* THE CHIP'S OWN FACE, drawn by the one component every
                      chip of a work is drawn by — a face only: this row is
                      the control. */}
                  <WorkChipFace work={candidate().record} />
                  <span
                    data-testid="conductor-mention-detail"
                    data-kind="work"
                    class="min-w-0 truncate text-fg-2"
                  >
                    {candidate().standing}
                  </span>
                </button>
              )}
            </For>
          </Show>
          <Show when={terminalMatches().length > 0}>
            <div
              data-testid="conductor-mention-heading"
              class="px-2 pb-0.5 pt-1 font-mono text-[0.6rem] uppercase tracking-[0.12em] text-fg-3"
            >
              Terminals
            </div>
            {/* KEYED, never a plain `<For>`. `candidates` mints fresh objects
                on every fleet notification and the fleet index notifies on ANY
                metadata change on ANY host, so a reference-keyed list rebuilds
                every row of this menu when a terminal nobody is looking at, on
                a machine nobody is looking at, retitles itself — dropping the
                hovered row mid-choice. The identity is the FLEET reference and
                not the bare id: two hosts may carry one terminal id, and a
                bare id would let one host's row adopt the other host's node,
                keeping the wrong row's state under the pointer. */}
            <For
              each={terminalMatches()}
              keyed={(candidate) => `${candidate.host}/${candidate.terminalId}`}
            >
              {(candidate, index) => {
                /** Where this row sits in the FLAT list the keyboard moves
                 *  through: the works are above it. */
                const at = () => workMatches().length + index();
                return (
                  <button
                    ref={(el) =>
                      revealWhenSelected(el, () => at() === selected())
                    }
                    type="button"
                    data-testid="conductor-mention-row"
                    data-kind="terminal"
                    data-terminal-id={candidate().terminalId}
                    data-host={candidate().host}
                    data-selected={at() === selected() ? "" : undefined}
                    class={[
                      "w-full min-w-0 flex items-center gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-surface-2 cursor-pointer",
                      { "bg-surface-2": at() === selected() },
                    ]}
                    // Hover moves the highlight so the mouse and the keyboard
                    // never disagree about which row Enter would take.
                    onPointerEnter={() => setSelected(at())}
                    onClick={() => accept(at())}
                  >
                    <span class="max-w-[45%] shrink-0 truncate font-semibold text-fg">
                      {candidate().name}
                    </span>
                    {/* WHICH MACHINE. Two hosts can both carry a `main`, and
                        the name alone would offer a person a choice they
                        cannot read. It leads the quiet columns because it is
                        the thing that tells otherwise identical rows apart. */}
                    <span
                      data-testid="conductor-mention-host"
                      class="shrink-0 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-accent"
                    >
                      {hostLabel(decodeHostKey(candidate().host))}
                    </span>
                    <Show when={candidate().repo}>
                      {(repo) => (
                        <span class="shrink-0 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-fg-3">
                          {repo()}
                        </span>
                      )}
                    </Show>
                    {/* WHAT DIFFERS. A member of a piece of work says which
                        work and in what role; otherwise same-named terminals
                        are ordinary — one repo, several branches — so each row
                        carries the one thing that tells it from its neighbours
                        (`mentionDetail`). A directory is cut from the LEFT:
                        two worktrees of one repo differ at the end of the
                        path, which a right-hand cut would hide. */}
                    <Show when={candidate().detail}>
                      {(detail) => (
                        <span
                          data-testid="conductor-mention-detail"
                          data-kind={detail().kind}
                          class={[
                            "min-w-0 truncate text-fg-2",
                            {
                              "[direction:rtl] text-left font-mono text-[0.62rem]":
                                detail().kind === "directory",
                            },
                          ]}
                        >
                          <bdi>{detail().text}</bdi>
                        </span>
                      )}
                    </Show>
                  </button>
                );
              }}
            </For>
          </Show>
        </div>
      </Show>
      <Show when={commandMatches().length > 0}>
        <div
          data-testid="conductor-command-menu"
          class="absolute left-5 right-5 bottom-full mb-1 max-h-60 overflow-y-auto rounded-lg border border-edge-bright bg-surface-1 shadow-lg shadow-black/40 p-1.5"
        >
          <For each={commandMatches()}>
            {(command, index) => (
              <button
                ref={(el) =>
                  revealWhenSelected(el, () => index() === selected())
                }
                type="button"
                data-testid="conductor-command-row"
                data-command={command.name}
                data-selected={index() === selected() ? "" : undefined}
                class={[
                  "w-full flex items-baseline gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-surface-2 cursor-pointer",
                  { "bg-surface-2": index() === selected() },
                ]}
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
      {/* WHAT THE CHAT IS POINTED AT, over the box. It is not a word in the
          text — nobody typed it — so it is a chip of its own: pressing its
          name goes to the work, and its × alone hands the whole conversation
          back (`showAllChat`). The message still carries the work: pointing
          the chat at it is what said so. */}
      <Show when={scope()}>
        {(at) => (
          <div class="mb-1.5 flex flex-wrap items-center gap-1.5">
            <span
              data-testid="conductor-scope-chip"
              data-work={at().id}
              class="flex min-w-0 items-center gap-1"
            >
              <WorkChip id={at().id} work={at().record} />
              <button
                type="button"
                data-testid="conductor-scope-chip-remove"
                aria-label={`Show the whole chat, not only ${at().record.title}`}
                class="cursor-pointer rounded-sm px-0.5 font-mono text-[0.68rem] text-fg-3 hover:text-fg"
                onClick={() => showAllChat()}
              >
                ×
              </button>
            </span>
          </div>
        )}
      </Show>
      <Show when={armed().length > 0}>
        <div class="mb-1.5 flex flex-wrap items-center gap-1.5">
          {/* KEYED for the same reason as the menu: `armed()` re-resolves
              against freshly minted candidates on every fleet tick, and a
              rebuilt chip is a chip whose press target moved under the finger.
              The TOKEN is the identity — `armedMentions` emits each one once,
              and the token is what the × drops from the text. */}
          <For each={armed()} keyed={(armedOne) => armedOne.token}>
            {(armedOne) => (
              <>
                <Show when={asWork(armedOne().mention)}>
                  {(work) => (
                    <span
                      data-testid="conductor-mention-chip"
                      data-kind="work"
                      data-work={work().work}
                      title={work().title}
                      class="flex min-w-0 items-center gap-1"
                    >
                      {/* The work's own chip, as every other chip of it is
                          drawn: its name goes to the work. A work the mirror
                          has stopped listing keeps its title: the words were
                          true when they were typed. */}
                      <Show
                        when={workMap().get(work().work as WorkId)}
                        fallback={
                          <span class="text-[0.72rem] font-medium text-fg">
                            {work().title}
                          </span>
                        }
                      >
                        {(record) => (
                          <WorkChip
                            id={work().work as WorkId}
                            work={record()}
                          />
                        )}
                      </Show>
                      <button
                        type="button"
                        data-testid="conductor-mention-chip-remove"
                        aria-label={`Take out the mention of ${work().title}`}
                        class="cursor-pointer rounded-sm px-0.5 font-mono text-[0.68rem] text-fg-3 hover:text-fg"
                        onClick={() =>
                          write(
                            dropMention(composerText(), armedOne().token),
                            0,
                          )
                        }
                      >
                        ×
                      </button>
                    </span>
                  )}
                </Show>
                <Show when={asTerminal(armedOne().mention)}>
                  {(one) => (
                    <button
                      type="button"
                      data-testid="conductor-mention-chip"
                      data-kind="terminal"
                      data-terminal-id={one().terminalId}
                      data-host={one().host}
                      title={one().intent ?? one().cwd ?? undefined}
                      class="rounded-full bg-accent/15 px-2 py-px font-mono text-[0.68rem] font-semibold text-accent cursor-pointer"
                      onClick={() =>
                        write(dropMention(composerText(), armedOne().token), 0)
                      }
                    >
                      {/* The host rides ON the chip — what is sent is
                          `host/id`, and a chip that showed only the name would
                          hide which of two machines the question is about. */}
                      @{one().name}
                      <span class="font-normal text-accent/70">
                        {" "}
                        · {hostLabel(decodeHostKey(one().host))}
                      </span>{" "}
                      ×
                    </button>
                  )}
                </Show>
              </>
            )}
          </For>
        </div>
      </Show>
      <Show when={composerAttachments().length > 0}>
        <div
          data-testid="conductor-attachments"
          class="mb-1.5 flex flex-wrap gap-1.5"
        >
          <For each={composerAttachments()}>
            {(attachment) => (
              <div
                data-testid="conductor-attachment-chip"
                data-attachment-id={attachment.id}
                data-mime={attachment.mimeType}
                // The bytes are still going up. The chip says so in its own
                // words AND in an attribute, because a person needs the
                // sentence and a test needs the fact.
                data-uploading={attachment.path === null ? "" : undefined}
                aria-busy={attachment.path === null ? "true" : undefined}
                title={attachment.name}
                class={[
                  "flex max-w-[12rem] items-center gap-1.5 rounded-md border border-edge-bright bg-surface-1 px-1.5 py-1",
                  { "opacity-60": attachment.path === null },
                ]}
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
                      data-testid="conductor-attachment-thumb"
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
                    data-testid="conductor-attachment-uploading"
                    class="shrink-0 font-mono text-[0.62rem] text-fg-3"
                  >
                    uploading…
                  </span>
                </Show>
                <button
                  type="button"
                  data-testid="conductor-attachment-remove"
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
      <div class="flex items-end gap-2">
        <textarea
          ref={box}
          data-testid="conductor-input"
          // ONE LINE AT REST, in every layout. The box used to stand three
          // rows tall on a desktop whatever was in it, which is two rows of
          // nothing between the conversation and the thing you came to type.
          // It grows with what is typed instead (the effect above), to its
          // `max-height`, and then it scrolls.
          rows={1}
          // WHAT THE HINT ROW UNDER HERE USED TO SAY. Four pieces of
          // keyboard-and-mouse advice stood below the box on every desktop
          // conversation; the two that are about what you type live in the
          // placeholder, where they are read at the moment they apply and
          // disappear the moment there is text to read instead.
          // A CHAT POINTED AT A WORK says so here too: the box is about that
          // work, and the hints about what `@` and `/` open are advice for a
          // conversation that is about everything.
          placeholder={
            scope() !== null
              ? "Ask about this work…"
              : phone()
                ? "Ask… @ work or terminal, / command"
                : "Ask the conductor… @ for a work or a terminal, / for a command, ⇧⏎ for a newline"
          }
          // `text-chat` — the pane's body size, so what you type is the size
          // of what you are reading rather than a size of its own.
          class="max-h-[40dvh] min-w-0 flex-1 resize-none overflow-y-auto rounded-[0.6rem] border border-edge-bright bg-surface-0 px-2.5 py-2 text-chat text-fg outline-none focus:border-accent"
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
            // ALT+ENTER SENDS, and it outranks the completion menu. The chord
            // is a decision about the MESSAGE — put these words into the turn
            // that is running — and a person who holds Alt while a half-typed
            // `@term` has the menu open meant to send, not to complete. Plain
            // Enter still completes, which is the key the menu is about.
            // Not fenced by `prohibitedKeybinds.ts`: that list is the chords a
            // terminal's agent owns, and this one never reaches a pty — it is
            // handled on the conductor's own textarea. No app ACTION binds
            // Alt+Enter either (`actions.ts`), so nothing else loses a key.
            if (event.key === "Enter" && event.altKey) {
              event.preventDefault();
              send(true);
              return;
            }
            const intent = completionIntent(
              event.key,
              event.shiftKey,
              menuCount(),
              selected(),
            );
            switch (intent.kind) {
              case "move":
                // The arrows belong to the menu while it is open — without the
                // preventDefault they would also drag the caret through the
                // text under it.
                event.preventDefault();
                setSelected(intent.index);
                return;
              case "accept":
                // Tab must not move focus out of the box, and Enter must not
                // send: the key completed a token, and that is the whole of
                // what it did.
                event.preventDefault();
                accept(intent.index);
                return;
              case "close":
                // Close the menu without leaving the mode — the chord that
                // leaves is the same key, so the menu claims it first. A caret
                // of -1 is outside every token, which is what closes it.
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
        {/* THE BUTTONS SIT BESIDE THE BOX, in every layout. They used to be
            the right-hand end of a hints row on a desktop, which is how four
            pieces of advice came to live under every conversation all day;
            with the row gone they stand where the phone has always had them.
            `items-end` on the row keeps them on the box's last line as it
            grows. */}
        <Show when={props.state.phase === "working"}>{stopButton()}</Show>
        {sendButton()}
      </div>
    </div>
  );
};

export default ConductorComposer;
