/** The strip above the scroll: what is still OUT — a background task armed
 *  mid-turn, a subagent the conversation started.
 *
 *  It sits above the transcript rather than in it because the fact outlives
 *  the row that announced it: a task armed an hour ago is still running, and
 *  its row is an hour of scrollback away. Pressing one jumps to that row
 *  rather than restating it here.
 *
 *  IT IS NOT A PERMANENT BAND. The tool-server roster — `kolu ✓ · plus the
 *  agent's own` — used to stand here on every conversation, a third row of
 *  furniture above the first reply, saying the same thing all day. It is a
 *  thing a person looks up when they wonder whether the agent really has
 *  kolu's hands, which is what a menu is for, so it lives in the header's `⋯`
 *  now (`ConductorMenu`). What is left renders only while something is
 *  actually out, and the conversation starts at the top of the column the rest
 *  of the time. */

import type { ConductorState } from "kolu-common/conductor";
import { type Component, For, Show } from "solid-js";
import { formatElapsedShort } from "../time/duration";
import { useShownClock } from "./conductorShown";

const ConductorStrip: Component<{
  watching: ConductorState["watching"];
  /** Reveal the transcript row a watched task or subagent belongs to. */
  onReveal: (rowId: string) => void;
}> = (props) => {
  // Ages that stop while nobody is reading them — the pane is retained behind
  // a host tab, so this is `getClockNow` gated on `shown()`.
  const now = useShownClock();
  const since = (stamp: string): string => {
    const at = Date.parse(stamp);
    return Number.isNaN(at) ? "" : formatElapsedShort(Math.max(0, now() - at));
  };

  return (
    <Show
      when={props.watching.length > 0}
      // ABSENT, not empty: a strip with nothing in it is a band of padding
      // above every conversation that has nothing out, which is furniture
      // between a person and the first thing they came to read.
    >
      <div
        data-testid="conductor-strip"
        // `leading-4` for the same reason the header carries one: a LENGTH
        // line-height makes every child's line box 16px whatever its size, so
        // a bare word, a bordered pill and a `Tip`'s wrapper all centre on one
        // line instead of each striking its own.
        class="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-1.5 border-b border-edge font-mono text-[0.68rem] leading-4 text-fg-2"
      >
        <For each={props.watching}>
          {(out) => (
            <button
              type="button"
              data-kind={out.kind}
              // `conductor-out`, not `conductor-watching`: the status line's
              // count of watched terminals owns that name, and two unrelated
              // facts under one test id is how a selector comes to mean
              // whichever one happens to be on screen.
              data-testid="conductor-out"
              class="inline-flex items-center gap-1.5 rounded-full border px-2 py-px cursor-pointer"
              classList={{
                "border-busy/45 text-busy": out.kind === "task",
                "border-edge-bright text-fg-2": out.kind === "agent",
              }}
              onClick={() => props.onReveal(out.row)}
            >
              <span>{out.kind === "task" ? "●" : "⤷"}</span>
              <span class="truncate max-w-[16rem]">{out.name}</span>
              <span class="text-fg-3">· {since(out.since)}</span>
            </button>
          )}
        </For>
      </div>
    </Show>
  );
};

export default ConductorStrip;
