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
