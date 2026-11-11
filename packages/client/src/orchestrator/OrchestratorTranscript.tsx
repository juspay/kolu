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
 *  back — that is the one behaviour that makes a live transcript unusable. */

import type { OrchestratorRow } from "@kolu/padi-client/orchestrator";
import { Markdown } from "@kolu/solid-markdown";
import {
  type Component,
  createEffect,
  For,
  Match,
  Show,
  Switch,
} from "solid-js";
import OrchestratorAsk from "./OrchestratorAsk";
import OrchestratorToolCard from "./OrchestratorToolCard";
import { useOrchestrator } from "./useOrchestrator";

/** How close to the bottom still counts as "following", in pixels. A couple of
 *  lines of slack, so a half-scrolled wheel notch does not unpin the view. */
const FOLLOW_SLACK_PX = 48;

const OrchestratorTranscript: Component<{
  rows: readonly OrchestratorRow[];
  pending: boolean;
  error: Error | undefined;
  containerRef: (el: HTMLDivElement) => void;
}> = (props) => {
  let scroller!: HTMLDivElement;

  createEffect(() => {
    // Depend on the row count AND the last row's text, so a streaming
    // paragraph keeps the view pinned rather than only new rows doing it.
    const rows = props.rows;
    void rows.length;
    const last = rows[rows.length - 1];
    void (last !== undefined && last.kind !== "plan" ? last.text : "");
    if (scroller === undefined) return;
    const distance =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    if (distance <= FOLLOW_SLACK_PX + 1)
      scroller.scrollTop = scroller.scrollHeight;
  });

  return (
    <div
      data-testid="orchestrator-transcript"
      ref={(el) => {
        scroller = el;
        props.containerRef(el);
      }}
      class="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2.5 px-4 py-3"
    >
      <Show when={props.error}>
        {(err) => (
          <p
            data-testid="orchestrator-transcript-error"
            class="text-danger text-xs"
          >
            The transcript stopped: {err().message}
          </p>
        )}
      </Show>
      <Show when={props.pending && props.rows.length === 0}>
        <p class="text-fg-3 text-xs">Opening the conversation…</p>
      </Show>
      <For each={props.rows}>{(row) => <TranscriptRow row={row} />}</For>
    </div>
  );
};

function TranscriptRow(props: { row: OrchestratorRow }) {
  return (
    <div
      data-testid="orchestrator-row"
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
                    data-testid="orchestrator-plan-step"
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
          {(row) => <OrchestratorToolCard row={row()} />}
        </Match>
        <Match when={props.row.kind === "ask" && props.row}>
          {(row) => <OrchestratorAsk row={row()} />}
        </Match>
        <Match when={props.row.kind === "notice" && props.row}>
          {(row) => (
            <p class="font-mono text-[0.68rem] text-fg-3">{row().text}</p>
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

function UserRow(props: { row: Extract<OrchestratorRow, { kind: "user" }> }) {
  const orch = useOrchestrator();
  /** The mark a message wears when it did not simply go.
   *
   *  `refused` means nothing took it, so *send again* sends it for the FIRST
   *  time and the retry is honest. `unanswered` means it went out and nothing
   *  came back — an agent that took it and went silent looks identical to one
   *  that never took it, so no retry is offered rather than one that might
   *  double the message. */
  const mark = (): "queued" | "refused" | "unanswered" | undefined =>
    props.row.queued === true ? "queued" : props.row.delivery;

  return (
    <>
      <blockquote class="rounded-[0.75rem_0.75rem_0.2rem_0.75rem] border border-accent/30 bg-accent/15 px-3 py-2 text-[0.82rem] whitespace-pre-wrap m-0">
        {props.row.text}
      </blockquote>
      <Show when={mark()}>
        {(what) => (
          <div class="mt-1 flex items-center justify-end gap-2 font-mono text-[0.62rem] text-fg-3">
            <span data-testid="orchestrator-user-mark" data-mark={what()}>
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
                data-testid="orchestrator-send-again"
                class="text-accent hover:underline cursor-pointer"
                onClick={() =>
                  orch.prompt(props.row.text, props.row.mentions ?? [])
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

export default OrchestratorTranscript;
