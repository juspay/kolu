/** A tool call, as a card.
 *
 *  Two shapes, and which one a row gets is the harness's decision, not this
 *  component's: a call it positively recognised as the `kolu` MCP server's
 *  carries a structured reading and gets a card that can name the terminal and
 *  open it; everything else gets the generic card built from the agent's own
 *  title and the folded JSON. The mapping lives in `./toolCard`, pure, so the
 *  cases are pinned by unit tests rather than by reading markup.
 *
 *  The live clock (`· 47s`) appears only on a call that is RUNNING and only once
 *  the wait is worth watching — see `runningFor`. It is derived from the row's
 *  own `startedAt` stamp, so a reloaded tab shows the same number as the tab
 *  beside it instead of starting a stopwatch of its own. */

import type { OrchestratorToolRow } from "@kolu/padi-client/orchestrator";
import type { TerminalId } from "kolu-common/surface";
import { type Component, createMemo, Show } from "solid-js";
import { useDockFocus } from "../canvas/dock/useDockFocus";
import { getClockNow } from "../time/clock";
import OrchestratorDiffs from "./OrchestratorDiffs";
import { runningFor, toolCard } from "./toolCard";

const STATUS_MARK: Record<OrchestratorToolRow["status"], string> = {
  pending: "·",
  in_progress: "◐",
  completed: "✓",
  failed: "✗",
};

const STATUS_CLASS: Record<OrchestratorToolRow["status"], string> = {
  pending: "text-fg-3",
  in_progress: "text-busy",
  completed: "text-ok",
  failed: "text-danger",
};

const OrchestratorToolCard: Component<{ row: OrchestratorToolRow }> = (
  props,
) => {
  const focus = useDockFocus();
  const now = getClockNow();
  const card = createMemo(() => toolCard(props.row));
  const clock = () => runningFor(props.row, now());
  /** The terminal a card is ABOUT, when it is about one. Every kolu-aware arm
   *  carries the id; the generic card is a call we could not name, so there is
   *  no terminal to open and nothing to guess at. */
  const subject = (): TerminalId | null => {
    const c = card();
    return c.kind === "generic" ? null : c.terminalId;
  };

  const openTile = (id: TerminalId | null) => (
    <Show when={id}>
      {(terminalId) => (
        <button
          type="button"
          data-testid="orchestrator-tool-open-tile"
          data-terminal-id={terminalId()}
          class="text-[0.7rem] font-semibold text-accent hover:underline cursor-pointer shrink-0"
          onClick={() => focus(terminalId())}
        >
          open tile
        </button>
      )}
    </Show>
  );

  /** The folded body — a screen tail, a snapshot, or the call's own JSON. One
   *  `<details>` for all three, because they are the same affordance: the card
   *  says what happened, and this is the evidence under it. */
  const folded = (summary: string, body: string | null) => (
    <Show when={body}>
      {(text) => (
        <details class="col-span-full">
          <summary class="font-mono text-[0.65rem] text-fg-3 cursor-pointer">
            {summary}
          </summary>
          <pre
            data-testid="orchestrator-tool-detail"
            class="mt-1.5 max-h-64 overflow-auto rounded-md bg-surface-0 px-2.5 py-2 font-mono text-[0.65rem] leading-relaxed whitespace-pre-wrap text-fg-2"
          >
            {text()}
          </pre>
        </details>
      )}
    </Show>
  );

  return (
    <div
      data-testid="orchestrator-tool-card"
      data-tool-kind={card().kind}
      data-status={props.row.status}
      class="grid grid-cols-[auto_1fr_auto] items-center gap-x-2.5 gap-y-1.5 rounded-lg border border-edge bg-surface-1 px-2.5 py-1.5 text-xs"
    >
      <span class="font-mono text-[0.62rem] font-semibold text-fg-3 bg-surface-2 rounded px-1.5 py-px">
        {props.row.tool ?? props.row.server ?? "tool"}
      </span>
      <span class="min-w-0 truncate">
        {(() => {
          const c = card();
          switch (c.kind) {
            case "create":
              return (
                <>
                  → <b class="font-semibold">{c.name ?? "terminal"}</b>
                  <Show when={c.cwd}>
                    {(cwd) => <span class="text-fg-2"> · {cwd()}</span>}
                  </Show>
                  <Show when={c.agent}>
                    {(agent) => (
                      <span class="font-mono text-fg-2"> · {agent()}</span>
                    )}
                  </Show>
                </>
              );
            case "sendInput":
              return (
                <>
                  <b class="font-semibold">{c.name ?? "terminal"}</b>
                  <Show when={c.sent}>
                    {(sent) => (
                      <span class="font-mono text-fg-2">
                        {" "}
                        ←{" "}
                        {sent().as === "key"
                          ? sent().value
                          : `“${sent().value}”`}
                      </span>
                    )}
                  </Show>
                </>
              );
            case "settle":
              return (
                <>
                  <b class="font-semibold">{c.name ?? "terminal"}</b>
                  <Show when={c.state}>
                    {(state) => <span class="text-alert"> · {state()}</span>}
                  </Show>
                  <Show when={c.waited}>
                    {(waited) => (
                      <span class="text-fg-2"> after {waited()}</span>
                    )}
                  </Show>
                </>
              );
            case "screen":
              return (
                <>
                  <b class="font-semibold">{c.name ?? "terminal"}</b>
                  <span class="text-fg-2"> · screen</span>
                </>
              );
            case "kill":
              return (
                <>
                  <b class="font-semibold">{c.name ?? "terminal"}</b>
                  <span class="text-fg-2"> · killed</span>
                </>
              );
            case "generic":
              return <span class="text-fg">{c.title}</span>;
          }
        })()}
      </span>
      <span class="flex items-center gap-2 shrink-0">
        <Show when={clock()}>
          {(elapsed) => (
            <span class="font-mono text-[0.65rem] text-busy">
              · {elapsed()}
            </span>
          )}
        </Show>
        {openTile(subject())}
        <span class={`font-mono ${STATUS_CLASS[props.row.status]}`}>
          {STATUS_MARK[props.row.status]}
        </span>
      </span>
      {/* A background task reports its launch and then LIVES — the row stays
          live past the turn that made it, and its ending word (`completed`,
          `killed`, `stopped`) is the harness's own: a monitor you stopped did
          not fail. */}
      <Show when={props.row.armed}>
        {(armed) => (
          <div class="col-span-full font-mono text-[0.68rem] text-fg-2 border-l-2 border-busy pl-2">
            <b class="text-fg">{armed().task}</b>
            <Show when={armed().description}>
              {(what) => <span> · {what()}</span>}
            </Show>
            <span class="text-busy">
              {" "}
              · {armed().ended ?? "still running…"}
            </span>
            <Show when={armed().report}>
              {(report) => <div class="text-fg-3">{report()}</div>}
            </Show>
          </div>
        )}
      </Show>
      <Show when={props.row.spawned}>
        {(spawned) => (
          <div class="col-span-full font-mono text-[0.68rem] text-fg-2">
            ⤷ {spawned().kind ?? "subagent"}
            <Show when={spawned().said}>
              {(said) => <span class="text-fg-3"> · {said()}</span>}
            </Show>
          </div>
        )}
      </Show>
      <Show when={props.row.stranded}>
        <div class="col-span-full font-mono text-[0.65rem] text-attention">
          its turn ended and it never reported back
        </div>
      </Show>
      {(() => {
        const c = card();
        if (c.kind === "settle")
          return folded("▸ last lines (screenTail)", c.screenTail);
        if (c.kind === "screen") return folded("▸ screen", c.snapshot);
        if (c.kind === "generic") return folded("▸ call", c.detail);
        return null;
      })()}
      <Show when={props.row.progress}>
        {(progress) => (
          <pre class="col-span-full font-mono text-[0.65rem] text-fg-3 whitespace-pre-wrap max-h-24 overflow-hidden">
            {progress()}
          </pre>
        )}
      </Show>
      <Show when={props.row.diffs}>
        {(diffs) => <OrchestratorDiffs rowId={props.row.id} diffs={diffs()} />}
      </Show>
    </div>
  );
};

export default OrchestratorToolCard;
