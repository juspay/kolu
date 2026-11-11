/** A tool call, as a card.
 *
 *  Two shapes, and which one a row gets is the harness's decision, not this
 *  component's: a call it positively recognised as the `kolu` MCP server's
 *  carries a structured `kolu` reading and gets a card that can name the
 *  terminal and open it; everything else gets the generic card built from the
 *  agent's own title and the folded JSON. That reading IS the card vocabulary,
 *  so the markup switches on it directly; `./toolCard` holds only the two
 *  derivations the markup cannot read off the row, and the clock.
 *
 *  The live clock (`· 47s`) appears only on a call that is RUNNING and only once
 *  the wait is worth watching — see `runningFor`. It is derived from the row's
 *  own `startedAt` stamp, so a reloaded tab shows the same number as the tab
 *  beside it instead of starting a stopwatch of its own. */

import { decodeHostKey } from "kolu-common/hostKey";
import type { ConductorToolRow } from "kolu-common/conductor";
import type { TerminalId } from "kolu-common/surface";
import { type Component, Show } from "solid-js";
import { useDockFocus } from "../canvas/dock/useDockFocus";
import { hostLabel } from "../host/hostChipTone";
import { selectHostTab } from "../host/selectHostTab";
import { getClockNow } from "../time/clock";
import ConductorDiffs from "./ConductorDiffs";
import { foldJson, runningFor, sentInput, waitedFor } from "./toolCard";

const STATUS_MARK: Record<ConductorToolRow["status"], string> = {
  pending: "·",
  in_progress: "◐",
  completed: "✓",
  failed: "✗",
};

const STATUS_CLASS: Record<ConductorToolRow["status"], string> = {
  pending: "text-fg-3",
  in_progress: "text-busy",
  completed: "text-ok",
  failed: "text-danger",
};

const ConductorToolCard: Component<{ row: ConductorToolRow }> = (props) => {
  const focus = useDockFocus();
  const now = getClockNow();

  /** READ THE CLOCK ONLY WHILE THE CALL IS RUNNING. `now()` is the app's one
   *  1 s tick, and a transcript holds every tool call a conversation ever made:
   *  reading it unconditionally subscribed every finished card to a signal that
   *  invalidates once a second, so a long session re-ran hundreds of memos for
   *  a number that cannot change. The status check short-circuits before the
   *  read, so a settled card holds no subscription at all. */
  const clock = () =>
    props.row.status === "in_progress" ? runningFor(props.row, now()) : null;
  /** The terminal a card is ABOUT, when it is about one — BOTH halves of its
   *  identity. Every kolu reading carries the id and the host it is on (the
   *  two sides of the `host/id` the agent spoke); a call we could not resolve
   *  carries neither, and has nothing to open and nothing to guess at. */
  const subject = (): { host: string; id: TerminalId } | null => {
    const call = props.row.kolu;
    if (call === undefined || call.terminalId === null || call.host === null) {
      return null;
    }
    return { host: call.host, id: call.terminalId };
  };

  /** Go to it. The terminal may be on a machine whose tab is not the selected
   *  one, so this is a TAB SWITCH and then a focus — `selectHostTab` leaves
   *  the conversation and lands on that host's canvas in whatever posture it
   *  was left in (maximized stays maximized), and the focus lands on the tile
   *  there. The same two steps, in the same order, a palette row or a
   *  notification click takes. */
  const openTile = (at: { host: string; id: TerminalId } | null) => (
    <Show when={at}>
      {(target) => (
        <button
          type="button"
          data-testid="conductor-tool-open-tile"
          data-terminal-id={target().id}
          data-host={target().host}
          class="text-[0.7rem] font-semibold text-accent hover:underline cursor-pointer shrink-0"
          onClick={() => {
            selectHostTab(decodeHostKey(target().host));
            focus(target().id);
          }}
        >
          open tile
        </button>
      )}
    </Show>
  );

  /** The folded body — a screen tail, a snapshot, or the call's own JSON. One
   *  `<details>` for all three, because they are the same affordance: the card
   *  says what happened, and this is the evidence under it.
   *
   *  IT WRAPS, rather than scrolling sideways. A minified tool payload is one
   *  line with no space in it — `ListMcpResourcesTool` answers 5 KB that way —
   *  and `pre-wrap` alone cannot break a run of characters that holds no break
   *  opportunity, so the line stayed 25 000 px wide inside a 970 px block and
   *  was reachable only by scrolling the block sideways. `wrap-anywhere`
   *  (`overflow-wrap: anywhere`) lets the break land mid-token, which is the
   *  right trade for a payload somebody opened deliberately to READ: every
   *  character is on screen, and the card keeps its width.
   *
   *  `min-w-0` on the `<details>` is the structural half. It is a grid item,
   *  and a grid item's default `min-width: auto` refuses to shrink below its
   *  content — so a body that ever stopped being a scroll container (as the
   *  `<pre>`'s `overflow-auto` makes it) would push the card, the transcript
   *  and the document wider in one step. The containment must not depend on
   *  which overflow value the next edit happens to leave here. */
  const folded = (summary: string, body: string | null) => (
    <Show when={body}>
      {(text) => (
        <details class="col-span-full min-w-0">
          <summary class="font-mono text-[0.65rem] text-fg-3 cursor-pointer">
            {summary}
          </summary>
          <pre
            data-testid="conductor-tool-detail"
            class="mt-1.5 max-h-64 overflow-auto rounded-md bg-surface-0 px-2.5 py-2 font-mono text-[0.65rem] leading-relaxed whitespace-pre-wrap wrap-anywhere text-fg-2"
          >
            {foldJson(text())}
          </pre>
        </details>
      )}
    </Show>
  );

  return (
    <div
      data-testid="conductor-tool-card"
      data-tool-kind={props.row.kolu?.kind ?? "generic"}
      data-host={props.row.kolu?.host ?? undefined}
      data-status={props.row.status}
      // `minmax(0, 1fr)` for the title column and `min-w-0` on the card: a
      // `1fr` track and a grid item both floor at their CONTENT by default, so
      // one long title or one unbroken payload line would size the card, the
      // card would size the transcript, and the transcript would size the
      // document. Written here rather than relied on from the parent because
      // the card is the box that must hold a tool's output whatever it is.
      class="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1.5 rounded-lg border border-edge bg-surface-1 px-2.5 py-1.5 text-xs"
    >
      <span class="font-mono text-[0.62rem] font-semibold text-fg-3 bg-surface-2 rounded px-1.5 py-px">
        {props.row.tool ?? props.row.server ?? "tool"}
      </span>
      <span class="min-w-0 truncate">
        {/* WHICH MACHINE, first. One conversation drives terminals on every
            host, so `fix-parser` alone does not say where the agent typed —
            and the card's own "open tile" goes to a different tab depending
            on the answer. */}
        <Show when={props.row.kolu?.host}>
          {(host) => (
            <span
              data-testid="conductor-tool-host"
              class="mr-1.5 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-accent"
            >
              {hostLabel(decodeHostKey(host()))}
            </span>
          )}
        </Show>
        {(() => {
          const call = props.row.kolu;
          if (call === undefined)
            return <span class="text-fg">{props.row.text}</span>;
          switch (call.kind) {
            case "create":
              return (
                <>
                  → <b class="font-semibold">{call.name ?? "terminal"}</b>
                  <Show when={call.cwd}>
                    {(cwd) => <span class="text-fg-2"> · {cwd()}</span>}
                  </Show>
                  <Show when={call.agent}>
                    {(agent) => (
                      <span class="font-mono text-fg-2"> · {agent()}</span>
                    )}
                  </Show>
                </>
              );
            case "sendInput":
              return (
                <>
                  <b class="font-semibold">{call.name ?? "terminal"}</b>
                  <Show when={sentInput(call)}>
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
                  <b class="font-semibold">{call.name ?? "terminal"}</b>
                  <Show when={call.state}>
                    {(state) => <span class="text-alert"> · {state()}</span>}
                  </Show>
                  <Show when={waitedFor(call.elapsedMs)}>
                    {(waited) => (
                      <span class="text-fg-2"> after {waited()}</span>
                    )}
                  </Show>
                </>
              );
            case "screen":
              return (
                <>
                  <b class="font-semibold">{call.name ?? "terminal"}</b>
                  <span class="text-fg-2"> · screen</span>
                </>
              );
            case "kill":
              return (
                <>
                  <b class="font-semibold">{call.name ?? "terminal"}</b>
                  <span class="text-fg-2"> · killed</span>
                </>
              );
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
        const call = props.row.kolu;
        if (call === undefined)
          return folded("▸ call", props.row.detail ?? null);
        if (call.kind === "settle")
          return folded("▸ last lines (screenTail)", call.screenTail);
        if (call.kind === "screen") return folded("▸ screen", call.snapshot);
        return null;
      })()}
      <Show when={props.row.progress}>
        {(progress) => (
          // LIVE CONTENT, wrapped and height-capped. The vertical clip is the
          // point — this is a tail, not a transcript — but a horizontal one
          // was a silent loss: an MCP answer arrives here as one minified line
          // and `overflow-hidden` CUT it at the card's edge, so what the agent
          // read was simply gone. `wrap-anywhere` breaks it mid-token instead,
          // which keeps every character on screen and the card at its width.
          <pre class="col-span-full min-w-0 font-mono text-[0.65rem] text-fg-3 whitespace-pre-wrap wrap-anywhere max-h-24 overflow-hidden">
            {progress()}
          </pre>
        )}
      </Show>
      <Show when={props.row.diffs}>
        {(diffs) => <ConductorDiffs rowId={props.row.id} diffs={diffs()} />}
      </Show>
    </div>
  );
};

export default ConductorToolCard;
