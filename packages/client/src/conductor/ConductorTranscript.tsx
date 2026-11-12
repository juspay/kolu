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
 *  The tool calls between two things the Conductor said are folded into one
 *  closed "Details" (`foldToolRuns`), so the conversation reads as its
 *  sentences; what a reader would lose by folding — a running call, a failure,
 *  the line about an agent — stays in the flow. */

import { formatBytes } from "@kolu/byte-units";
import type { ConductorRow, ConductorToolRow } from "kolu-common/conductor";
import { Markdown } from "@kolu/solid-markdown";
import { Key } from "@solid-primitives/keyed";
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  on,
  onMount,
  Show,
  Switch,
} from "solid-js";
import ScrollToBottom from "../terminal/ScrollToBottom";
import ConductorAsk from "./ConductorAsk";
import ConductorToolCard from "./ConductorToolCard";
import { thumbnailOf } from "./thumbnails";
import {
  foldNoticeRuns,
  foldToolRuns,
  type TranscriptItem,
} from "./transcript";
import {
  applyTranscriptScroll,
  pinTranscript,
  rememberTranscriptScroll,
  transcriptPinned,
  unpinTranscript,
} from "./transcriptScroll";
import { useConductor } from "./useConductor";

const ConductorTranscript: Component<{
  rows: readonly ConductorRow[];
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
   *  (`foldNoticeRuns`), never eight copies of one fact; and the tool calls
   *  between two pieces of prose are one closed "Details" (`foldToolRuns`). */
  const items = createMemo(() => foldToolRuns(foldNoticeRuns(props.rows)));

  // BEFORE the follow effect below, and that order is the fix: declared first,
  // so Solid runs it first and the first follow check measures a container
  // already at the reader's position instead of a fresh one at 0 (which it
  // would correctly read as "scrolled far up" and refuse to move).
  onMount(() => applyTranscriptScroll(scroller));

  /** New rows arrived while the reader was away from the end — what makes the
   *  pill's ring, so it says "there is something new down there" rather than
   *  only "you are not at the bottom". */
  const [unseen, setUnseen] = createSignal(false);

  /** What a frame may change: how many rows there are and how long the last
   *  one's text is. The text matters as much as the count — a streaming
   *  paragraph grows one row for a whole turn, and following only new rows
   *  would leave the view a paragraph behind. */
  const signature = createMemo(() => {
    const rows = props.rows;
    const last = rows[rows.length - 1];
    return `${rows.length}:${last === undefined || last.kind === "plan" ? 0 : last.text.length}`;
  });

  createEffect(
    // `on`, so the body's reads of the ELEMENT are not dependencies and the
    // deps are exactly these two: what was drawn, and whether the reader is
    // following. The pin is a dep because the pill and a sent message re-pin
    // with no row arriving, and the view must move then too.
    on([signature, transcriptPinned], ([drawn, pinned], prev) => {
      if (!placed) {
        applyTranscriptScroll(scroller);
        placed = scroller.scrollHeight > scroller.clientHeight;
        return;
      }
      // NOT `atEnd(scroller)`. The rows are already in the column by now, so
      // that measurement answers about the chunk that just landed, not about
      // the reader — which is precisely how the transcript stopped following.
      if (pinned) {
        scroller.scrollTop = scroller.scrollHeight;
        setUnseen(false);
        return;
      }
      if (prev !== undefined && prev[0] !== drawn) setUnseen(true);
    }),
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
        class="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden flex flex-col gap-2.5 px-4 py-3"
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
            id; a fold's is the id of the prose it follows. Both are stable for
            the thing's life, and an item never changes kind under its key. */}
        <Key each={items()} by={(item) => item.key}>
          {(item) => (
            <Switch>
              <Match when={foldRowsOf(item())}>
                {(rows) => <TranscriptFold rows={rows()} />}
              </Match>
              <Match when={entryOf(item())}>
                {(entry) => (
                  <TranscriptRow row={entry().row} repeat={entry().repeat} />
                )}
              </Match>
            </Switch>
          )}
        </Key>
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

/** The two arms of an item, narrowed — what lets each `<Match>` hand its child
 *  a typed accessor instead of re-checking the kind inside it. */
const foldRowsOf = (item: TranscriptItem) =>
  item.kind === "fold" ? item.rows : undefined;
const entryOf = (item: TranscriptItem) =>
  item.kind === "entry" ? item.entry : undefined;

/** A run of the Conductor's tool calls, folded. A plain `<details>`, CLOSED
 *  until somebody opens it, and owned by the DOM: the list keys it by the prose
 *  it follows, so the element — and whether it is open — survives every update
 *  to the calls inside it. The strip's reveal opens it from outside
 *  (`revealTranscriptRow`), which is why it carries its own test id. */
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
        <Key each={props.rows} by={(row) => row.id}>
          {(row) => <TranscriptRow row={row()} repeat={1} />}
        </Key>
      </div>
    </details>
  );
}

function TranscriptRow(props: { row: ConductorRow; repeat: number }) {
  return (
    <div
      data-testid="conductor-row"
      data-row-kind={props.row.kind}
      data-row-id={props.row.id}
      // A row is a flex item of the column above, so it needs the same floor
      // released — without it the row passes its card's content width straight
      // up and the `min-w-0` above has nothing to do.
      class="min-w-0"
      classList={{ "self-end max-w-[86%]": props.row.kind === "user" }}
    >
      <Switch>
        <Match when={props.row.kind === "user" && props.row}>
          {(row) => <UserRow row={row()} />}
        </Match>
        <Match when={props.row.kind === "agent" && props.row}>
          {(row) => (
            <div class="text-fg text-[0.82rem]">
              <Markdown markdown={row().text} variant="compact" />
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
                    classList={{ "text-fg": step.status === "in_progress" }}
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
        <blockquote class="rounded-[0.75rem_0.75rem_0.2rem_0.75rem] border border-accent/30 bg-accent/15 px-3 py-2 text-[0.82rem] whitespace-pre-wrap m-0">
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
            <span data-testid="conductor-user-mark" data-mark={what()}>
              {what() === "queued"
                ? "queued"
                : what() === "refused"
                  ? props.row.auth === true
                    ? "not sent — nobody is signed in"
                    : "not sent"
                  : "no answer"}
            </span>
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
                  orch.prompt(
                    props.row.text,
                    props.row.mentions ?? [],
                    attachments(),
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
