/** The conversation itself.
 *
 *  One row per kind, and the kinds are not interchangeable: what a person typed
 *  is QUOTED and never rendered as markdown (a prompt containing `#` is not a
 *  heading, and a prompt containing a script is not something to interpret),
 *  while the agent's prose IS markdown, at chat scale. A plan is a card because
 *  it is replaced wholesale on every update; a tool call is a card because it
 *  has a status that moves.
 *
 *  Scroll follows the conversation only while the reader is FOLLOWING it, and
 *  that is a fact about the reader — held in `transcriptScroll.ts`, decided by
 *  their own scrolling — never a measurement taken off the container after new
 *  rows have been drawn into it. Once somebody scrolls up to read something, a
 *  streaming turn must not yank them back (the one behaviour that makes a live
 *  transcript unusable); the way back is OFFERED, as the terminal's own
 *  `ScrollToBottom` pill. The same fact decides where a fresh mount lands,
 *  which is why it cannot live here: this component is re-created on every
 *  activation of the entry.
 *
 *  The settled tool calls between two boundaries — prose, a message of yours,
 *  a divider — are folded into one closed "Details" as they settle
 *  (`foldToolRuns`), so the conversation reads as its sentences even while the
 *  Conductor works; what a reader would lose by folding — a running call, a
 *  failure, the line about an agent — stays in the flow. The same failure in a
 *  row is said once, with its count (`foldFailureRuns`), and the call that
 *  asked a question draws nothing at all — the ask row below it IS the
 *  question, so its card said the same words twice (`transcript.ts`). */

import { formatBytes } from "@kolu/byte-units";
import type {
  ConductorRow,
  ConductorToolRow,
  ConductorWorkAskRow,
} from "kolu-common/conductor";
import type { WorkId } from "kolu-work";
import {
  type Component,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  onSettled,
  Show,
  Switch,
  untrack,
  useContext,
} from "solid-js";
import ScrollToBottom from "../terminal/ScrollToBottom";
import ConductorAsk from "./ConductorAsk";
import CompactionLine from "./CompactionLine";
import MemoryProposalCard from "./memory/MemoryProposalCard";
import ConductorProse from "./ConductorProse";
import ConductorToolCard from "./ConductorToolCard";
import { useShown } from "../ui/shown";
import { thumbnailOf } from "./thumbnails";
import {
  foldFailureRuns,
  foldNoticeRuns,
  foldToolRuns,
  type TranscriptItem,
} from "./transcript";
import {
  applyTranscriptScroll,
  pinTranscript,
  rememberTranscriptScroll,
  showTranscriptDocument,
  transcriptPinned,
  transcriptPlace,
  unpinTranscript,
  WHOLE_TRANSCRIPT,
} from "./transcriptScroll";
import type { FileHolders } from "./namedFiles";
import { chatScope } from "./chatScope";
import { quietChat, type QuietTurn } from "./quietChat";
import type { Turn } from "./turnWorks";
import { useConductor } from "./useConductor";
import { wakeHeadline, wakeWhen } from "./wake";
import { useAgentNotes, useFileHolders, useWorkMap } from "./useWorks";
import WorkChip from "./WorkChip";
import WorkChipFace from "./WorkChipFace";
import WorkQuestion from "./WorkQuestion";

const NO_WORKS: ReadonlyArray<WorkId> = [];

/** WHAT EVERY ROW READS ABOUT ITS TURN — the turn (`./turnWorks.ts`: the row
 *  that starts it, and the works it is about), and which works hold which
 *  files, for the prose's file links. A context rather than a prop, because
 *  the rows folded under a Details are drawn by the same row component. It
 *  has no default: a row drawn outside a transcript is a mistake to see, not
 *  a row that quietly shows no works. */
interface Turns {
  readonly turnOf: (rowId: string) => Turn;
  readonly holders: () => FileHolders;
}
const TurnsContext = createContext<Turns>();

// `TurnsContext` has no default, so a row drawn outside its transcript throws
// (`ContextNotFoundError`).

/** The same works, in the same order: what keeps a row's chips from being
 *  redrawn on every streamed chunk of its turn. */
const sameWorks = (
  a: ReadonlyArray<WorkId>,
  b: ReadonlyArray<WorkId>,
): boolean => a.length === b.length && a.every((one, i) => one === b[i]);

/** A TURN'S WORKS, AS CHIPS, on a line of their own — the ones this browser
 *  has the record of. */
const TurnChips: Component<{ works: ReadonlyArray<WorkId> }> = (props) => {
  const map = useWorkMap();
  return (
    <div
      data-testid="conductor-turn-works"
      class="flex min-w-0 flex-wrap items-center gap-1.5"
    >
      <For each={props.works}>
        {(id) => (
          <Show when={map().get(id)}>
            {(work) => <WorkChip id={id} work={work()} />}
          </Show>
        )}
      </For>
    </div>
  );
};

/** THE WORKS OF A TURN WITH NO PROMPT ROW to carry them — rows before the
 *  first message — drawn above the item that holds the turn's first row,
 *  whether that is a row, a fold or a run of failures. A turn that starts
 *  with your message or a wake-up draws them there instead. */
const TurnHead: Component<{ rows: ReadonlyArray<ConductorRow> }> = (props) => {
  const turns = useContext(TurnsContext);
  const works = createMemo(
    () => {
      const first = props.rows[0];
      if (first === undefined || first.kind === "user" || first.kind === "wake")
        return NO_WORKS;
      const turn = turns.turnOf(first.id);
      return turn.head === first.id ? turn.works : NO_WORKS;
    },
    { equals: sameWorks },
  );
  return (
    <Show when={works().length > 0}>
      <TurnChips works={works()} />
    </Show>
  );
};

/** WHICH FOLDED LINES SOMEBODY HAS PRESSED, by the id of the row that starts
 *  the turn — an OVERRIDE of the default (`quietChat`'s `open`), not a copy
 *  of it, so a turn nobody has touched keeps following the rule as newer
 *  replies arrive and the newest one moves on without a press.
 *
 *  Module-level, like the composer's draft: the conversation is re-created on
 *  every visit to the entry, and a line a person opened must still be open
 *  when they come back from a host tab. It is DRAWING and nothing else —
 *  never persisted, never sent. */
const [pressed, setPressed] = createSignal<Readonly<Record<string, boolean>>>(
  {},
);

/** THE ONE LINE A FOLDED TURN IS — when it rang, which works it is about, and
 *  the first sentence of what kolu said about them.
 *
 *  A `<button>` rather than a `<details>`: the chips inside it are the work's
 *  own face (no button of their own) and the line must stay one tab stop,
 *  while the rows it opens are the transcript's own — they stay where they
 *  are in the column and are only HIDDEN, so opening a line is never a
 *  subtree being built again.
 *
 *  ON A PHONE it is two lines — the chips over the sentence — because a work's
 *  title and a sentence cannot share 390px without one of them becoming three
 *  words and an ellipsis. */
const FoldLine: Component<{
  turn: QuietTurn;
  works: ReadonlyArray<WorkId>;
  open: boolean;
}> = (props) => {
  const map = useWorkMap();
  const when = createMemo(() => wakeWhen(props.turn.since));
  const toggle = () =>
    setPressed((was) => ({ ...was, [props.turn.head]: !props.open }));
  return (
    <button
      type="button"
      data-testid="conductor-fold-line"
      data-turn={props.turn.head}
      data-open={props.open ? "" : undefined}
      data-quiet={props.turn.says.kind === "prose" ? undefined : ""}
      aria-expanded={props.open ? "true" : "false"}
      onClick={toggle}
      // A RUN OF FOLDED LINES IS A LIST, packed at the column's own gap; an
      // open turn keeps the clear gap between turns.
      class={[
        "flex w-full min-w-0 cursor-pointer flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-sm text-left",
        { "mt-4": props.open },
      ]}
    >
      {/* WHEN, AND WHICH WORKS — on a line of its own when there are several,
          so the sentence is never squeezed to nothing beside them. Open, the
          chips are the wake row's own (pressable, under it), so the line
          keeps only its clock. */}
      <span
        class={[
          "flex min-w-0 max-w-full items-center gap-1.5",
          { "basis-full": !props.open && props.works.length > 1 },
        ]}
      >
        <span aria-hidden="true" class="w-2 shrink-0 text-fg-3">
          {props.open ? "▾" : "▸"}
        </span>
        <Show when={when()}>
          {(clock) => (
            <span class="shrink-0 font-mono text-[0.68rem] text-fg-3 tabular-nums">
              {clock()}
            </span>
          )}
        </Show>
        <Show when={!props.open}>
          <For each={props.works}>
            {(id) => (
              <Show when={map().get(id)}>
                {(work) => (
                  <span class="inline-flex min-w-0 max-w-[15ch] shrink">
                    <WorkChipFace work={work()} />
                  </span>
                )}
              </Show>
            )}
          </For>
        </Show>
      </span>
      {/* THE NEWS ITSELF, one line that gives way with an ellipsis — and
          wraps under the chips, never shrinks to nothing beside them. Open,
          a reply's sentence is the first line of the reply drawn under it,
          so it is not said twice; a note or a silence is still said here. */}
      <Show when={!(props.open && props.turn.says.kind === "prose")}>
        <span
          data-testid="conductor-fold-says"
          class={[
            "min-w-[16rem] flex-1 basis-0 truncate text-[0.8rem]",
            {
              "text-fg-2": props.turn.says.kind === "prose",
              "text-fg-3": props.turn.says.kind !== "prose",
            },
          ]}
        >
          <Show when={props.turn.says.kind === "noted"}>
            <span class="font-mono text-[0.68rem]">noted · </span>
          </Show>
          {props.turn.says.kind === "prose"
            ? props.turn.says.headline
            : props.turn.says.kind === "noted"
              ? props.turn.says.text
              : "no reply"}
        </span>
      </Show>
    </button>
  );
};

/** A QUESTION KOLU ASKED ABOUT A PIECE OF WORK, where it was asked.
 *
 *  The row is the conversation's log that the question went out; the WORK is
 *  what a person answers, so this looks the work up and hands the decision
 *  itself to the one component every face draws. A work this browser has not
 *  got (it ended and was swept, or the frame has not arrived) draws nothing
 *  rather than an empty form: the row above it still says what was asked. */
const ChatWorkQuestion: Component<{ row: ConductorWorkAskRow }> = (props) => {
  const works = useWorkMap();
  const work = createMemo(() => works().get(props.row.work));
  return (
    <Show when={work()}>
      {(one) => (
        <WorkQuestion
          work={one()}
          id={props.row.work}
          ask={props.row.id}
          from="chat"
        />
      )}
    </Show>
  );
};

const ConductorTranscript: Component<{
  rows: readonly ConductorRow[];
  /** Each row's turn (`./turnWorks.ts`) — read ONCE by the pane, over these
   *  same rows, for the transcript and the scope bar over it. */
  turns: ReadonlyMap<string, Turn>;
  pending: boolean;
  error: Error | undefined;
  containerRef: (el: HTMLDivElement) => void;
}> = (props) => {
  let scroller!: HTMLDivElement;
  /** Has the restore landed on a column that actually has height? A mount
   *  whose rows arrive one frame later measures zero, and `scrollTop` clamps
   *  to 0 against it — which is the top, i.e. the defect. So the restore is
   *  re-applied until there is something to scroll. */
  let placed = false;
  /** What is DRAWN: a run of identical notices is one row carrying its count
   *  (`foldNoticeRuns`), never eight copies of one fact; the settled tool
   *  calls of a run are one closed "Details" (`foldToolRuns`); and the same
   *  failure in a row is one line with its count (`foldFailureRuns`). */
  const items = createMemo(() =>
    foldFailureRuns(foldToolRuns(foldNoticeRuns(props.rows))),
  );
  /** The works themselves, as the re-place trigger below reads them: rows
   *  arriving for a work are a reason to put the scroller back where it was. */
  const workMap = useWorkMap();
  /** Which work holds which file — what the prose's file links read. The
   *  app's one index ({@link useFileHolders}), built work by work. The turns
   *  are the pane's (`props.turns`). */
  const holders = useFileHolders();
  const turns = () => props.turns;
  const turnsContext: Turns = {
    // Every row of `props.rows` has a turn, and every row drawn is one of
    // them: both lists are read off the same rows in the same tick.
    turnOf: (rowId) => {
      const turn = turns().get(rowId);
      if (turn === undefined)
        throw new Error(`transcript row ${rowId} has no turn`);
      return turn;
    },
    holders,
  };

  /** THE FOLD: which turns are one line, what the line says, which one is
   *  open before anybody presses, and how many replies have landed since the
   *  last thing a person typed. The notes are the app's one reading
   *  ({@link useAgentNotes}), taken work by work — never per streamed chunk
   *  of the chat. */
  const notes = useAgentNotes();
  const quiet = createMemo(() => quietChat(props.rows, notes()));
  /** Is this turn open — what somebody pressed, or the rule. */
  const opened = (turn: QuietTurn): boolean =>
    pressed()[turn.head] ?? turn.open;
  /** Does this row belong to the work the chat is pointed at? The SAME
   *  `turnWorks` reading the chips are drawn from, so a turn whose chip says
   *  a work and a turn the scope keeps are the same turns by construction. */
  const inScope = (rowId: string): boolean => {
    const id = chatScope()?.id;
    return (
      id === undefined || (turns().get(rowId)?.works.includes(id) ?? false)
    );
  };

  /** The document the scroller's place belongs to: a scoped chat's own, or
   *  the whole conversation under its own name. */
  const shownDoc = (): string => chatScope()?.id ?? WHOLE_TRANSCRIPT;

  // The mount's own restore, once the first stable render has put the rows in
  // the column. The follow effect below places the container too — on its
  // first run, which is what a conversation that mounts with rows already in
  // hand goes through — and both land on the same remembered place, so the
  // two are idempotent with each other.
  onSettled(() => {
    applyTranscriptScroll(scroller, transcriptPlace(shownDoc()));
  });

  /** New rows arrived while the reader was away from the end — what makes the
   *  pill's ring, so it says "there is something new down there" rather than
   *  only "you are not at the bottom". */
  const [unseen, setUnseen] = createSignal(false);

  /** What a frame may change: how many rows there are and how much prose
   *  they hold. The prose matters as much as the count — a streaming
   *  paragraph grows one row for a whole turn, and following only new rows
   *  would leave the view a paragraph behind. EVERY reply's, not the last
   *  row's: a message sent while a reply is still being written is drawn
   *  last, and that reply goes on growing above it. PROSE only: a notice or a
   *  call's title changing far above a reader who scrolled up is not news. */
  const signature = createMemo(() => {
    const rows = props.rows;
    let prose = 0;
    for (const row of rows) if (row.kind === "agent") prose += row.text.length;
    return `${rows.length}:${prose}`;
  });

  /** How many times a row's prose DOM was rewritten. It matters for the one
   *  rewrite no text change announces — a diagram landing, which grows the
   *  row a second after its fence closed — and is harmless for the others (a
   *  re-pin is idempotent). Its own dep of the follow effect below, and
   *  deliberately NOT part of `signature`: the pill's "something new down
   *  there" ring compares `signature`, and a diagram replacing its own source
   *  is not new. Opening a folded list writes no HTML and never bumps it, so a
   *  press does not start re-pinning the view. */
  const [redraws, setRedraws] = createSignal(0);
  const noteRedrawn = () => setRedraws((n) => n + 1);

  const shown = useShown();

  /** WHICH DOCUMENT THE SCROLLER SHOWS — written here, above the follow
   *  effect, and NOT behind that effect's `visible` guard: the pane showing a
   *  work's chat is true whether or not anybody is looking at it, and the
   *  scroller's place belongs to that document from the moment it is the one
   *  shown. The write lands for the next run of everything that reads it;
   *  the follow effect puts the container at a place by the key its own run
   *  computed, so it never depends on this write being visible yet. */
  createEffect(shownDoc, (doc) => {
    showTranscriptDocument(doc);
  });

  /** The document the container was last put at the place of. `undefined`
   *  until the first run, so the mount's restore is not repeated. */
  let atDocument: string | undefined;

  createEffect(
    // THE COMPUTE HOLDS EVERY READ, so the effect's reads of the ELEMENT are
    // not dependencies and the deps are exactly these: what was drawn, a row
    // redrawn in place, the works, whether the reader is following, whether
    // the conversation is the view being read, and which document it shows.
    // The pin is a dep because the pill and a sent message re-pin with no row
    // arriving, and the view must move then too; a redraw is one because a
    // diagram landing grows its row with no text arriving.
    //
    // THE WORKS are one because a work's record reaches this page on its own
    // stream, often after the rows that name it, and the column grows when it
    // lands: the work's question card under its ask row (`ChatWorkQuestion`
    // draws nothing until then) and the chips of the turns about it.
    //
    // SHOWN is a dep rather than a guard that returns early for a reason: a
    // hidden pane has no layout at all (`content-visibility: hidden` skips the
    // subtree), so a scroll written there would land on a column of height 0
    // and clamp to the top — the reader's position, thrown away by the very
    // mechanism meant to preserve it. Rows that arrive while away leave the
    // remembered offset alone, and coming back re-runs this with the column
    // laid out again.
    () => {
      const doc = shownDoc();
      return [
        signature(),
        redraws(),
        workMap(),
        transcriptPinned(),
        shown(),
        doc,
        // READ ONCE, not depended on: the reader's pixel is what this run
        // puts the container at, and a scroll that only moves that pixel
        // must not re-run the effect that would then move the view again.
        untrack(() => transcriptPlace(doc)),
      ] as const;
    },
    ([drawn, , , pinned, visible, doc, place], prev) => {
      if (!visible) return;
      // A DOCUMENT CHANGE IS PUT AT ITS OWN PLACE, and then the run is over:
      // `applyTranscriptScroll` opens a follower at the end and a reader who
      // had scrolled up at their own pixel. The first run does the same for
      // the document the transcript mounted with. Nothing else moves the
      // view for a scope change. The rows the document shows are already
      // revealed when this runs: the class bindings that hide and show them
      // are render effects, which Solid runs before this one.
      if (!placed || doc !== atDocument) {
        atDocument = doc;
        applyTranscriptScroll(scroller, place);
        placed = scroller.scrollHeight > scroller.clientHeight;
        return;
      }
      // NOT `atEnd(scroller)`. The rows are already in the column by now, so
      // that measurement answers about the chunk that just landed, not about
      // the reader — which is precisely how the transcript stopped following.
      if (pinned) {
        applyTranscriptScroll(scroller, place);
        setUnseen(false);
        return;
      }
      if (prev !== undefined && prev[0] !== drawn) setUnseen(true);
    },
  );

  return (
    // The scroller's POSITIONED parent, and that is all it is for: the pill is
    // `absolute`, and anchored to the scroller itself it would scroll away with
    // the conversation, while anchored to the pane it would sit over the
    // composer.
    <div class="relative flex-1 min-h-0 min-w-0 flex flex-col">
      <div
        data-testid="conductor-transcript"
        ref={(el) => {
          scroller = el;
          props.containerRef(el);
        }}
        // Every way the view can move ends here — wheel, drag, keyboard, and
        // the pin above — so there is no path that leaves the remembered
        // position behind. Recording on unmount instead would read a detached
        // element, whose scrollTop browsers are free to have already reset.
        onScroll={(event) => rememberTranscriptScroll(event.currentTarget)}
        // A wheel notch UP, read before the browser has moved anything. The
        // `scroll` above is dispatched a frame later, by which time a chunk
        // may have re-pinned the view — and that event would then measure the
        // end and call the reader "following", so the reader fights the
        // transcript and loses. This decides the intent; `scroll` still
        // corrects the pixel.
        onWheel={(event) => {
          if (event.deltaY < 0) unpinTranscript(event.currentTarget);
        }}
        // `min-w-0` + `overflow-x-hidden`: this column is a flex child of the
        // pane, and a flex child floors at its CONTENT unless told otherwise —
        // one card holding an unbroken line would make the column, and then
        // the document, as wide as that line. The hidden axis is the backstop:
        // a row that overflows anyway is clipped here instead of reaching the
        // page.
        //
        // `gap-2` is the gap INSIDE one turn — a reply, the cards it made and
        // the plan it wrote belong together. The clear gap BETWEEN turns is
        // the margin a turn's first row carries (`TranscriptRow`), so the two
        // distances are a pair rather than one spacing used twice. `px-5` is
        // the reading column's gutter, shared with the status line and the
        // composer below.
        class="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden flex flex-col gap-2 px-5 py-3"
      >
        <Show when={props.error}>
          {(err) => (
            <p
              data-testid="conductor-transcript-error"
              class="text-danger text-xs"
            >
              The transcript stopped: {err().message}
            </p>
          )}
        </Show>
        <Show when={props.pending && props.rows.length === 0}>
          <p class="text-fg-3 text-xs">Opening the conversation…</p>
        </Show>
        {/* KEYED, and that is the difference between a live conversation and
            an unusable one. The reducer replaces a row OBJECT on every chunk
            and every tool update, so a reference-keyed list rebuilds the
            `Markdown` subtree per chunk and the card per update — which
            collapses an open `<details>`, loses `ConductorDiffs`' expansion and
            throws away the caret inside a half-filled ask. A row's key is its
            id; a fold's is the id of the boundary that opens its run. Both are
            stable for the thing's life, and an item never changes kind under
            its key. */}
        <TurnsContext value={turnsContext}>
          <For each={items()} keyed={(item) => item.key}>
            {(item) => {
              /** The row this item starts at — which turn it belongs to, and
               *  whether it is that turn's head, where the one line goes. */
              const first = createMemo(() => rowsOf(item())[0] as ConductorRow);
              const turn = createMemo(() => {
                const one = quiet().of.get(first().id);
                if (one === undefined)
                  throw new Error(`transcript row ${first().id} has no turn`);
                return one;
              });
              const works = createMemo(
                () => turns().get(first().id)?.works ?? NO_WORKS,
                { equals: sameWorks },
              );
              /** A QUESTION IS NEVER FOLDED AWAY: it is the one thing in the
               *  conversation that waits on a person. Nor is a proposal to
               *  remember, nor a compaction. */
              const kept = createMemo(
                () =>
                  turn().asks.has(first().id) ||
                  first().kind === "compaction" ||
                  first().kind === "memory-proposal",
              );
              const drawn = createMemo(
                () =>
                  inScope(first().id) &&
                  (!turn().folds || opened(turn()) || kept()),
              );
              return (
                <>
                  {/* THE HEADING OVER THE RUN OF UNASKED REPLIES — only in
                    the whole conversation: a chat pointed at one work is
                    not a run of anything. */}
                  <Show
                    when={
                      chatScope() === null &&
                      quiet().since?.from === first().id &&
                      quiet().since
                    }
                  >
                    {(run) => (
                      <p
                        data-testid="conductor-since-heading"
                        data-count={run().count}
                        class="mt-5 font-mono text-[0.62rem] uppercase tracking-[0.12em] text-fg-3"
                      >
                        Since your last message · {run().count}{" "}
                        {run().count === 1 ? "update" : "updates"}
                      </p>
                    )}
                  </Show>
                  <Show
                    when={
                      turn().folds &&
                      turn().head === first().id &&
                      inScope(first().id)
                    }
                  >
                    <FoldLine
                      turn={turn()}
                      works={works()}
                      open={opened(turn())}
                    />
                  </Show>
                  {/* HIDDEN, NEVER UNMOUNTED. `display: contents` leaves the
                    item exactly where it was in the column — its own flex
                    child, with the column's gaps — so a line that opens and
                    closes is a class changing, not a `Markdown` subtree,
                    an open `<details>` and a half-filled ask being built
                    again. */}
                  <div class={{ contents: drawn(), hidden: !drawn() }}>
                    <TurnHead rows={rowsOf(item())} />
                    <Switch>
                      <Match when={foldRowsOf(item())}>
                        {(rows) => <TranscriptFold rows={rows()} />}
                      </Match>
                      <Match when={failuresOf(item())}>
                        {(run) => (
                          <TranscriptFailures
                            tool={run().tool}
                            reason={run().reason}
                            rows={run().rows}
                          />
                        )}
                      </Match>
                      <Match when={entryOf(item())}>
                        {(entry) => (
                          <TranscriptRow
                            row={entry().row}
                            repeat={entry().repeat}
                            onRedrawn={noteRedrawn}
                          />
                        )}
                      </Match>
                    </Switch>
                  </div>
                </>
              );
            }}
          </For>
        </TurnsContext>
      </div>
      {/* THE TERMINAL'S OWN PILL, not a second one that looks like it: the
          affordance for "you are not following, here is the way back" already
          exists and a reader meets it in both places. The press writes the ONE
          fact and nothing else — the effect above moves the view, exactly as it
          does for an arriving row, so there is no second path to the end that
          could disagree with the first. */}
      <ScrollToBottom
        visible={!transcriptPinned()}
        active={unseen()}
        onClick={pinTranscript}
      />
    </div>
  );
};

/** The arms of an item, narrowed — what lets each `<Match>` hand its child a
 *  typed accessor instead of re-checking the kind inside it. */
const foldRowsOf = (item: TranscriptItem) =>
  item.kind === "fold" ? item.rows : undefined;
const failuresOf = (item: TranscriptItem) =>
  item.kind === "failures" ? item : undefined;
const entryOf = (item: TranscriptItem) =>
  item.kind === "entry" ? item.entry : undefined;
/** The rows an item draws, in order — what its turn's head is read from. */
const rowsOf = (item: TranscriptItem): ReadonlyArray<ConductorRow> =>
  item.kind === "entry" ? [item.entry.row] : item.rows;

/** A run of the Conductor's tool calls, folded. A plain `<details>`, CLOSED
 *  until somebody opens it, and owned by the DOM: the list keys it by the
 *  boundary that opens its run, so the element — and whether it is open —
 *  survives every call that joins it and the prose that later closes it. The
 *  strip's reveal opens it from outside, as the row's `<details>` ancestor
 *  (`revealTranscriptRow`). */
function TranscriptFold(props: { rows: readonly ConductorToolRow[] }) {
  const count = () => props.rows.length;
  return (
    <details
      data-testid="conductor-fold"
      data-count={count()}
      class="group min-w-0"
    >
      <summary class="w-fit cursor-pointer list-none font-mono text-[0.68rem] text-fg-3 hover:text-fg-2 [&::-webkit-details-marker]:hidden">
        Details · {count()} {count() === 1 ? "tool call" : "tool calls"}
        <span class="ml-1 group-open:hidden">›</span>
        <span class="ml-1 hidden group-open:inline">⌄</span>
      </summary>
      <div class="mt-2 flex min-w-0 flex-col gap-2.5 border-l-2 border-edge pl-2.5">
        <For each={props.rows} keyed={(row) => row.id}>
          {(row) => <TranscriptRow row={row()} repeat={1} />}
        </For>
      </div>
    </details>
  );
}

/** The same failure several times in a row, said ONCE: "screen_text failed
 *  6 times: …", in the danger colour and in the flow — a failure is news, so
 *  unlike the Details fold this line is the news itself. It opens to the
 *  individual cards. Keyed by its first failure, so a seventh joining it keeps
 *  the element, and whether it is open. */
function TranscriptFailures(props: {
  tool: string;
  reason: string;
  rows: readonly ConductorToolRow[];
}) {
  return (
    <details
      data-testid="conductor-failures"
      data-count={props.rows.length}
      class="group/failures min-w-0"
    >
      <summary class="min-w-0 cursor-pointer list-none font-mono text-[0.68rem] text-danger wrap-anywhere [&::-webkit-details-marker]:hidden">
        <span class="group-open/failures:hidden">▸</span>
        <span class="hidden group-open/failures:inline">▾</span> {props.tool}{" "}
        failed {props.rows.length} times: {props.reason}
      </summary>
      <div class="mt-2 flex min-w-0 flex-col gap-2.5 border-l-2 border-danger/40 pl-2.5">
        <For each={props.rows} keyed={(row) => row.id}>
          {(row) => <TranscriptRow row={row()} repeat={1} />}
        </For>
      </div>
    </details>
  );
}

/** One row. `onRedrawn` reaches the agent row's prose (see `redraws` in the
 *  transcript); a row inside a tool fold is never prose, so those omit it. */
function TranscriptRow(props: {
  row: ConductorRow;
  repeat: number;
  onRedrawn?: () => void;
}) {
  const turns = useContext(TurnsContext);
  /** The works this row's turn is about — the same list, by value, until the
   *  turn names another. */
  const works = createMemo(() => turns.turnOf(props.row.id).works, {
    equals: sameWorks,
  });
  return (
    <>
      <div
        data-testid="conductor-row"
        data-row-kind={props.row.kind}
        data-row-id={props.row.id}
        // A row is a flex item of the column above, so it needs the same floor
        // released — without it the row passes its card's content width straight
        // up and the `min-w-0` above has nothing to do.
        //
        // THE GAP BETWEEN TURNS, as a margin on the row that STARTS one: a
        // person's message is the top of a new exchange. Everything else in a
        // turn keeps the column's smaller `gap-2`, so the page reads as a few
        // blocks rather than one evenly-spaced list — which is how a reply and
        // the message it answers came to look equally far apart from
        // everything around them. A TURN KOLU WOKE carries that gap on its
        // fold line instead (`FoldLine`), which is above the wake row and is
        // there whether the turn is open or closed.
        class={[
          "min-w-0",
          { "self-end max-w-[86%] mt-4": props.row.kind === "user" },
        ]}
      >
        <Switch>
          <Match when={props.row.kind === "user" && props.row}>
            {(row) => <UserRow row={row()} />}
          </Match>
          <Match when={props.row.kind === "agent" && props.row}>
            {(row) => (
              <div class="text-fg">
                <ConductorProse
                  rowId={row().id}
                  text={row().text}
                  works={works()}
                  holders={turns.holders()}
                  onRedrawn={props.onRedrawn}
                />
              </div>
            )}
          </Match>
          <Match when={props.row.kind === "plan" && props.row}>
            {(row) => (
              <ul class="list-none m-0 pl-2.5 border-l-2 border-edge-bright font-mono text-[0.72rem] text-fg-3">
                <For each={row().steps}>
                  {(step) => (
                    <li
                      data-testid="conductor-plan-step"
                      data-status={step.status}
                      class={{ "text-fg": step.status === "in_progress" }}
                    >
                      {step.status === "completed"
                        ? "● "
                        : step.status === "in_progress"
                          ? "◐ "
                          : "○ "}
                      {step.content}
                    </li>
                  )}
                </For>
              </ul>
            )}
          </Match>
          <Match when={props.row.kind === "tool" && props.row}>
            {(row) => <ConductorToolCard row={row()} />}
          </Match>
          {/* A QUESTION ABOUT A PIECE OF WORK is drawn off the WORK, not off
            this row: the row says it was asked here (and goes when the chat
            goes), while the decision behind it is the thing a person
            answers — here, on the card, or in the reader. */}
          <Match when={props.row.kind === "work-ask" && props.row}>
            {(row) => <ChatWorkQuestion row={row()} />}
          </Match>
          <Match when={props.row.kind === "ask" && props.row}>
            {(row) => <ConductorAsk row={row()} />}
          </Match>
          <Match when={props.row.kind === "notice" && props.row}>
            {(row) => (
              <p class="font-mono text-[0.68rem] text-fg-3">
                {row().text}
                {/* The count is the whole point of folding the run: ONE row, and
                  it still says how many times the thing happened. */}
                <Show when={props.repeat > 1}>
                  <span
                    data-testid="conductor-notice-repeat"
                    class="ml-1.5 rounded-sm bg-fg-3/15 px-1 tabular-nums"
                  >
                    ×{props.repeat}
                  </span>
                </Show>
              </p>
            )}
          </Match>
          <Match when={props.row.kind === "wake" && props.row}>
            {(row) => <WakeRow row={row()} works={works()} />}
          </Match>
          <Match when={props.row.kind === "compaction" && props.row}>
            {(row) => <CompactionLine row={row()} />}
          </Match>
          <Match when={props.row.kind === "memory-proposal" && props.row}>
            {(row) => <MemoryProposalCard shown={row()} />}
          </Match>
          <Match when={props.row.kind === "divider" && props.row}>
            {(row) => (
              <div class="flex items-center gap-2 text-fg-3 font-mono text-[0.62rem] uppercase tracking-[0.12em]">
                <span class="flex-1 border-t border-edge" />
                <span>{row().text}</span>
                <span class="flex-1 border-t border-edge" />
              </div>
            )}
          </Match>
        </Switch>
      </div>
      {/* THE WORKS YOUR MESSAGE'S TURN IS ABOUT, at the head of the reply — on
        the reply's side of the column, not inside your bubble. A wake-up
        carries its own under its line. */}
      <Show when={props.row.kind === "user" && works().length > 0}>
        <TurnChips works={works()} />
      </Show>
    </>
  );
}

/** THE MACHINE'S LINE — kolu itself starting a turn, because a watched
 *  terminal stopped, asked, or died.
 *
 *  FULL WIDTH ON THE LEFT, never the human's right-hand bubble: a person
 *  scrolling back must be able to tell at a glance which lines they wrote and
 *  which kolu did, and the side of the column is the fastest such signal there
 *  is. For the same reason there is no *send again*: this row is not a message
 *  that can be re-sent — what it says is how something STOOD when it rang, and
 *  the thing that rang rings again.
 *
 *  ONE LINE, which OPENS. The account handed to the agent is several
 *  paragraphs about each terminal; the headline is derived from the events
 *  (`wakeHeadline`) because the account's own first line is the briefing's
 *  opening, not the news. A plain `<details>`, owned by the DOM like the tool
 *  fold above — the list is keyed by row id, so an open disclosure survives
 *  every refinement of the row around it.
 *
 *  The `queued` / `delivery` marks are the user row's, minus the retry: a turn
 *  kolu started can wait behind one, be refused, or go unanswered exactly as a
 *  typed message can. */
function WakeRow(props: {
  row: Extract<ConductorRow, { kind: "wake" }>;
  /** The works this wake-up's turn is about, drawn under its line. */
  works: ReadonlyArray<WorkId>;
}) {
  const mark = (): "queued" | "refused" | "unanswered" | undefined =>
    props.row.queued === true ? "queued" : props.row.delivery;
  const when = createMemo(() => wakeWhen(props.row.since));

  return (
    /* `data-levels` is the row's news as DATA — the levels of its events, in
       event order — so a test can assert that a `ready` wake was drawn without
       pinning the wording of the headline above it. */
    <div
      data-testid="conductor-wake"
      data-levels={props.row.events.map((event) => event.level).join(" ")}
      class="min-w-0"
    >
      <details class="min-w-0 rounded-md border border-edge bg-surface-1/60 px-2 py-1">
        <summary
          data-testid="conductor-wake-toggle"
          class="flex min-w-0 cursor-pointer list-none items-baseline gap-1.5 font-mono text-[0.68rem] text-fg-2 marker:content-none [&::-webkit-details-marker]:hidden"
        >
          <span aria-hidden="true" class="shrink-0 text-fg-3">
            ▸
          </span>
          <span class="shrink-0 font-semibold text-busy">{props.row.from}</span>
          <Show when={when()}>
            {(clock) => (
              <span class="shrink-0 text-fg-3 tabular-nums">· {clock()}</span>
            )}
          </Show>
          {/* The news gives way first at a phone's width — the speaker and the
              clock are two short words and the headline is as long as the
              names of the terminals that rang. */}
          <span
            data-testid="conductor-wake-headline"
            class="min-w-0 flex-1 truncate text-fg"
          >
            · {wakeHeadline(props.row.events)}
          </span>
        </summary>
        <p
          data-testid="conductor-wake-text"
          class="mt-1 whitespace-pre-wrap break-words text-[0.75rem] text-fg-2"
        >
          {props.row.text}
        </p>
      </details>
      {/* THE WORKS IT IS ABOUT, as chips on a line of their own under the
          wake-up — which piece of work rang is the first thing a person
          needs from it, and a chip is a button, which a summary must not
          hold. */}
      <Show when={props.works.length > 0}>
        <div data-testid="conductor-wake-works" class="mt-1 font-sans">
          <TurnChips works={props.works} />
        </div>
      </Show>
      <Show when={mark()}>
        {(what) => (
          <div class="mt-1 font-mono text-[0.62rem] text-fg-3">
            <span data-testid="conductor-wake-mark" data-mark={what()}>
              {what() === "queued"
                ? "queued"
                : what() === "refused"
                  ? "not sent"
                  : "no answer"}
            </span>
          </div>
        )}
      </Show>
    </div>
  );
}

function UserRow(props: { row: Extract<ConductorRow, { kind: "user" }> }) {
  const orch = useConductor();
  /** The mark a message wears when it did not simply go.
   *
   *  `refused` means nothing took it, so *send again* sends it for the FIRST
   *  time and the retry is honest. `unanswered` means it went out and nothing
   *  came back — an agent that took it and went silent looks identical to one
   *  that never took it, so no retry is offered rather than one that might
   *  double the message. */
  const mark = (): "queued" | "refused" | "unanswered" | undefined =>
    props.row.queued === true ? "queued" : props.row.delivery;
  // Always an array on the decoded row — the schema defaults it — so there is
  // no second spelling of "none" to read.
  const attachments = () => props.row.attachments;

  return (
    <>
      {/* A pasted image with no words is a whole message — the quote would be
          an empty bubble above it. */}
      <Show when={props.row.text !== ""}>
        {/* NO SIZE OF ITS OWN — the pane's `text-chat` body size, like the
            replies it sits among: a bubble a point smaller than the answer to
            it reads as a footnote to the conversation rather than half of it.
            It is aligned by `self-end` on the row, which is the READING
            COLUMN's right edge now, not the window's. */}
        <blockquote class="rounded-[0.75rem_0.75rem_0.2rem_0.75rem] border border-accent/30 bg-accent/15 px-3 py-2 whitespace-pre-wrap m-0">
          {props.row.text}
        </blockquote>
      </Show>
      <Show when={attachments().length > 0}>
        <div
          data-testid="conductor-row-attachments"
          class="mt-1 flex flex-wrap justify-end gap-1.5"
        >
          <For each={attachments()}>
            {(attachment) => (
              <div
                data-testid="conductor-row-attachment"
                data-attachment-id={attachment.id}
                data-mime={attachment.mimeType}
                title={attachment.name}
                class="flex max-w-[12rem] items-center gap-1.5 rounded-md border border-edge bg-surface-1 px-1.5 py-1"
              >
                <Show
                  when={thumbnailOf(attachment)}
                  fallback={
                    <span class="truncate text-[0.68rem] text-fg-2">
                      {attachment.name}
                    </span>
                  }
                >
                  {(src) => (
                    <img
                      src={src()}
                      alt={attachment.name}
                      class="h-10 w-10 shrink-0 rounded object-cover"
                    />
                  )}
                </Show>
                <span class="shrink-0 font-mono text-[0.62rem] text-fg-3">
                  {formatBytes(attachment.bytes)}
                </span>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={mark()}>
        {(what) => (
          <div class="mt-1 flex items-center justify-end gap-2 font-mono text-[0.62rem] text-fg-3">
            <span
              data-testid="conductor-user-mark"
              data-mark={what()}
              data-sign-in={what() === "refused" ? props.row.signIn : undefined}
            >
              {what() === "queued"
                ? "queued"
                : what() === "refused"
                  ? props.row.signIn === "signed-out"
                    ? "not sent — nobody is signed in"
                    : props.row.signIn === "account"
                      ? "not sent — this account cannot run it now"
                      : "not sent"
                  : "no answer"}
            </span>
            {/* THE DOOR, BESIDE THE FAILURE IT FIXES: a refusal the agent
                said (in structure, never in prose) an account could clear.
                Nobody signed in already has the agent's own row on screen;
                this is for the account that IS signed in and cannot. */}
            <Show when={what() === "refused" && props.row.signIn === "account"}>
              <button
                type="button"
                data-testid="conductor-mark-signin"
                class="text-accent hover:underline cursor-pointer"
                onClick={() => orch.askSignIn()}
              >
                sign in again
              </button>
            </Show>
            <Show when={what() === "refused"}>
              <button
                type="button"
                data-testid="conductor-send-again"
                class="text-accent hover:underline cursor-pointer"
                onClick={() =>
                  // The retry carries exactly what the first attempt did: the
                  // row names files kolu-server is already holding under its state
                  // root, so a row minted a moment ago and one restored after
                  // a restart send the same message. Only the thumbnail is
                  // this browser's, and no wire ever carried it.
                  // Never a steer: the turn this message was refused by is
                  // over, and a retry is the message being sent for the first
                  // time.
                  orch.prompt(
                    props.row.text,
                    props.row.mentions ?? [],
                    attachments(),
                    false,
                  )
                }
              >
                send again
              </button>
            </Show>
          </div>
        )}
      </Show>
    </>
  );
}

export default ConductorTranscript;
