/** WHAT THE CHAT IS POINTED AT, said over the chat.
 *
 *  While the conversation is about one piece of work (`./chatScope.ts`), the
 *  transcript below is showing some of its turns and not others, and a view
 *  that hides things must say so where the hiding happens — a person who
 *  scrolled to the top of a filtered chat and found four lines where there
 *  were forty has no other way to learn why. So the bar names the work with
 *  its own chip, counts what it is keeping, and holds the way out.
 *
 *  The count is the SAME `turnWorks` reading the transcript filters by and
 *  the chips are drawn from — the pane reads it once and hands it to both —
 *  so "5 of 15" cannot disagree with what is on screen. */

import type { ConductorRow } from "kolu-common/conductor";
import { type Component, createMemo, Show } from "solid-js";
import { chatScope, showAllChat } from "./chatScope";
import type { Turn } from "./turnWorks";
import WorkChipFace from "./WorkChipFace";

const ChatScopeBar: Component<{
  rows: readonly ConductorRow[];
  turns: ReadonlyMap<string, Turn>;
}> = (props) => {
  const tally = createMemo(() => {
    const at = chatScope();
    if (at === null) return null;
    let total = 0;
    let shown = 0;
    for (const row of props.rows) {
      const turn = props.turns.get(row.id);
      if (turn === undefined || turn.head !== row.id) continue;
      total += 1;
      if (turn.works.includes(at.id)) shown += 1;
    }
    return { ...at, total, shown };
  });

  return (
    <Show when={tally()}>
      {(only) => (
        <div
          data-testid="chat-scope-bar"
          data-work={only().id}
          class="flex min-w-0 items-center gap-2 border-b border-edge px-5 py-2 text-[0.72rem] text-fg-2"
        >
          <span class="shrink-0">Only</span>
          {/* THE WORK'S OWN FACE, not its title in a different font: the
              chip in the bar, the chips on the turns below it and the chip
              in the box are one drawing of one thing. */}
          <WorkChipFace work={only().record} />
          <span class="min-w-0 truncate text-fg-3 tabular-nums">
            · {only().shown} of {only().total}{" "}
            {only().total === 1 ? "turn" : "turns"}
          </span>
          <button
            type="button"
            data-testid="chat-scope-show-all"
            onClick={showAllChat}
            class="ms-auto shrink-0 cursor-pointer rounded-md border border-edge px-2 py-0.5 text-fg-2 hover:border-edge-bright hover:text-fg"
          >
            Show all
          </button>
        </div>
      )}
    </Show>
  );
};

export default ChatScopeBar;
