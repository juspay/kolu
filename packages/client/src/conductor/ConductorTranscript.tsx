/** The conversation itself.
 *
 *  One row per kind, and the kinds are not interchangeable: what a person typed
 *  is QUOTED and never rendered as markdown (a prompt containing `#` is not a
 *  heading, and a prompt containing a script is not something to interpret),
 *  while the agent's prose IS markdown, at chat scale. A plan is a card because
 *  it is replaced wholesale on every update; a tool call is a card because it
 *  has a status that moves.
 *
 *  Scroll follows the conversation only while the reader is AT the bottom. Once
 *  somebody scrolls up to read something, a streaming turn must not yank them
 *  back — that is the one behaviour that makes a live transcript unusable. The
 *  same rule decides where a fresh mount lands, and `transcriptScroll.ts` holds
 *  it: this component is re-created on every activation of the entry, so where
 *  the reader is cannot live here. */

import { formatBytes } from "@kolu/byte-units";
import type { ConductorRow } from "kolu-common/conductor";
import { Markdown } from "@kolu/solid-markdown";
import { Key } from "@solid-primitives/keyed";
import {
  type Component,
  createEffect,
  createMemo,
  For,
  Match,
  onMount,
  Show,
  Switch,
} from "solid-js";
import ConductorAsk from "./ConductorAsk";
import ConductorToolCard from "./ConductorToolCard";
import { thumbnailOf } from "./thumbnails";
import { foldNoticeRuns } from "./transcript";
import {
  applyTranscriptScroll,
  atEnd,
  rememberTranscriptScroll,
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
   *  (`foldNoticeRuns`), never eight copies of one fact. */
  const entries = createMemo(() => foldNoticeRuns(props.rows));

  // BEFORE the follow effect below, and that order is the fix: declared first,
  // so Solid runs it first and the first follow check measures a container
  // already at the reader's position instead of a fresh one at 0 (which it
  // would correctly read as "scrolled far up" and refuse to move).
  onMount(() => applyTranscriptScroll(scroller));

  createEffect(() => {
    // Depend on the row count AND the last row's text, so a streaming
    // paragraph keeps the view pinned rather than only new rows doing it.
    const rows = props.rows;
    void rows.length;
    const last = rows[rows.length - 1];
    void (last !== undefined && last.kind !== "plan" ? last.text : "");
    if (scroller === undefined) return;
    if (!placed) {
      applyTranscriptScroll(scroller);
      placed = scroller.scrollHeight > scroller.clientHeight;
      return;
    }
    if (atEnd(scroller)) scroller.scrollTop = scroller.scrollHeight;
  });

  return (
    <div
      data-testid="conductor-transcript"
      ref={(el) => {
        scroller = el;
        props.containerRef(el);
      }}
      // Every way the view can move ends here — wheel, drag, keyboard, and the
      // pin above — so there is no path that leaves the remembered position
      // behind. Recording on unmount instead would read a detached element,
      // whose scrollTop browsers are free to have already reset.
      onScroll={(event) => rememberTranscriptScroll(event.currentTarget)}
      class="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2.5 px-4 py-3"
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
      {/* KEYED BY ROW ID, and that is the difference between a live
          conversation and an unusable one. The reducer replaces a row OBJECT on
          every chunk and every tool update, so a reference-keyed list rebuilds
          the `Markdown` subtree per chunk and the card per update — which
          collapses an open `<details>`, loses `ConductorDiffs`' expansion and
          throws away the caret inside a half-filled ask. The id is stable for
          the row's life; the subtree survives with it. */}
      <Key each={entries()} by={(entry) => entry.row.id}>
        {(entry) => <TranscriptRow row={entry().row} repeat={entry().repeat} />}
      </Key>
    </div>
  );
};

function TranscriptRow(props: { row: ConductorRow; repeat: number }) {
  return (
    <div
      data-testid="conductor-row"
      data-row-kind={props.row.kind}
      data-row-id={props.row.id}
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
