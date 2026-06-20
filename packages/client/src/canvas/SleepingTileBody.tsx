/** The dormant body injected into a sleeping tile's `CanvasTile` shell. Phase 2
 *  is a lightweight placeholder — what the tile WAS (intent + cwd), how long
 *  it's been asleep, and the one verb that brings it back. PR 3 swaps this body
 *  for the frozen screenshot; the shell (drag, resize, chrome, maximize) is
 *  `CanvasTile` either way, so only this body changes. */

import type { SleepingTerminal } from "kolu-common/surface";
import { type Component, Show } from "solid-js";
import { formatTimeAgo } from "../terminal/staleness";
import { MOON } from "./sleepingTilePalette";

const basename = (p: string) => p.split("/").filter(Boolean).pop() ?? p;

const SleepingTileBody: Component<{
  record: SleepingTerminal;
  onWake: () => void;
}> = (props) => {
  const top = () =>
    props.record.terminals.find((t) => !t.parentId) ??
    props.record.terminals[0];
  const intent = () => top()?.intent?.trim();
  const cwd = () => top()?.cwd ?? "";

  return (
    <div class="flex-1 min-h-0 flex flex-col gap-1.5 px-3 py-2.5 overflow-hidden">
      <Show
        when={intent()}
        fallback={
          <span class="text-xs font-semibold" style={{ color: "#c7ccd6" }}>
            {basename(cwd())}
          </span>
        }
      >
        <span
          class="text-xs font-semibold leading-snug"
          style={{ color: "#c7ccd6" }}
        >
          {intent()}
        </span>
      </Show>
      <span
        class="text-[0.66rem] font-mono truncate"
        style={{ color: "#8b929d" }}
      >
        📁 {basename(cwd())}
      </span>
      <span class="text-[0.6rem]" style={{ color: "#5b626d" }}>
        ☾ asleep {formatTimeAgo(props.record.sleptAt)} · PTY released
      </span>
      <button
        type="button"
        data-testid="sleeping-tile-wake"
        class="mt-auto self-start text-xs font-semibold rounded px-3 py-1.5 pointer-events-auto"
        style={{ background: MOON, color: "#0e1014" }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          props.onWake();
        }}
      >
        Wake
      </button>
    </div>
  );
};

export default SleepingTileBody;
