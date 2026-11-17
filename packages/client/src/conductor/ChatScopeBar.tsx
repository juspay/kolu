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
 *  the chips are drawn from, so "5 of 15" cannot disagree with what is on
 *  screen. It is read only while the chat is scoped: with no scope the memo
 *  never touches the rows, so an unscoped conversation pays nothing per
 *  streamed chunk. */

import type { ConductorRow } from "kolu-common/conductor";
import { type Component, createMemo, Show } from "solid-js";
import { chatScope, showAllChat } from "./chatScope";
import { joinsOf, turnWorks } from "./turnWorks";
import { useWorkMap } from "./useWorks";
import WorkChipFace from "./WorkChipFace";

const ChatScopeBar: Component<{ rows: readonly ConductorRow[] }> = (props) => {
  const map = useWorkMap();
  const tally = createMemo(() => {
    const id = chatScope();
    if (id === null) return null;
    const works = map();
    const turns = turnWorks(props.rows, works, joinsOf(works));
    let total = 0;
    let shown = 0;
    for (const row of props.rows) {
      const turn = turns.get(row.id);
      if (turn === undefined || turn.first !== row.id) continue;
      total += 1;
      if (turn.works.includes(id)) shown += 1;
    }
    return { id, work: works.get(id), total, shown };
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
          <Show when={only().work}>
            {(work) => <WorkChipFace work={work()} />}
          </Show>
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
