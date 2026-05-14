/** Awaiting dock — a bottom-edge strip surfacing every terminal whose
 *  agent is currently waiting on user input.
 *
 *  Each card shows the last few non-empty lines of that terminal's xterm
 *  buffer (read live via `getTerminalRefs`) plus a reply input that pipes
 *  straight to the PTY via `terminal.sendInput`. The dock auto-hides when
 *  no terminals are awaiting, so it costs zero pixels in the calm case.
 *
 *  Mounted as a sibling of `CanvasMinimap` inside `TerminalCanvas`. Ambient
 *  visibility means the user never has to open the workspace switcher to
 *  notice an agent is blocked on them. */

import type { TerminalId } from "kolu-common/surface";
import {
  type Component,
  For,
  Show,
  createMemo,
  createSignal,
  onCleanup,
} from "solid-js";
import { CONTEXTUAL_TIPS } from "../settings/tips";
import { useTips } from "../settings/useTips";
import { tailBuffer } from "../terminal/bufferTail";
import { getTerminalRefs } from "../terminal/terminalRefs";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { client } from "../wire";
import { agentBucket } from "./workspace-switcher/model";

const TAIL_LINES = 4;
const PEEK_REFRESH_MS = 250;

const AwaitingDock: Component = () => {
  const store = useTerminalStore();

  const awaitingIds = createMemo(() =>
    store
      .terminalIds()
      .filter((id) => agentBucket(store.getMetadata(id)?.agent) === "awaiting"),
  );

  return (
    <Show when={awaitingIds().length > 0}>
      <div
        data-testid="awaiting-dock"
        class="absolute bottom-4 right-4 z-20 flex gap-2 max-w-[60vw] overflow-x-auto justify-end"
      >
        <For each={awaitingIds()}>{(id) => <AwaitingCard id={id} />}</For>
      </div>
    </Show>
  );
};

const AwaitingCard: Component<{ id: TerminalId }> = (props) => {
  const store = useTerminalStore();
  const tips = useTips();
  const info = createMemo(() => store.getDisplayInfo(props.id));
  const [tail, setTail] = createSignal<string[]>([]);
  const [value, setValue] = createSignal("");

  const refresh = () => {
    const xterm = getTerminalRefs(props.id)?.xterm;
    if (!xterm) {
      setTail([]);
      return;
    }
    setTail(tailBuffer(xterm, TAIL_LINES));
  };

  refresh();
  const interval = setInterval(refresh, PEEK_REFRESH_MS);
  onCleanup(() => clearInterval(interval));

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    const text = value().trim();
    if (text.length === 0) return;
    setValue("");
    // TUI agents (e.g. Codex Ratatui) drop text+CR when delivered in a
    // single PTY write; split the carriage return into a second write so
    // the input parser sees it as a discrete event.
    await client.terminal.sendInput({ id: props.id, data: text });
    setTimeout(() => {
      void client.terminal.sendInput({ id: props.id, data: "\r" });
    }, 50);
  }

  return (
    <Show when={info()}>
      {(displayInfo) => (
        <div
          data-testid="awaiting-dock-card"
          data-terminal-id={props.id}
          class="pill-border pill-border-awaiting rounded-lg border border-edge/60 bg-surface-0/85 backdrop-blur-sm p-2.5 w-[280px] flex flex-col gap-1.5 shadow-lg shrink-0"
          style={{ "--pill-border-radius": "calc(0.5rem + 2px)" }}
        >
          <button
            type="button"
            class="flex items-baseline justify-between gap-2 text-left min-w-0 cursor-pointer hover:opacity-80"
            onClick={() => store.activate(props.id)}
            title="Jump to this terminal"
          >
            <span
              class="font-mono text-[0.6rem] font-bold uppercase tracking-[0.16em] truncate"
              style={{ color: displayInfo().repoColor }}
            >
              {displayInfo().key.group}
            </span>
            <span class="text-[0.75rem] font-semibold truncate text-fg-1">
              {displayInfo().key.label}
            </span>
          </button>
          <div
            data-testid="awaiting-dock-tail"
            class="font-mono text-[0.7rem] text-fg-2 leading-snug whitespace-pre-wrap break-all h-[3.6em] overflow-hidden"
          >
            <For each={tail()}>
              {(line) => <div class="truncate">{line || " "}</div>}
            </For>
          </div>
          <form onSubmit={submit}>
            <input
              type="text"
              data-testid="awaiting-dock-reply"
              value={value()}
              onInput={(e) => setValue(e.currentTarget.value)}
              onFocus={() => tips.showTipOnce(CONTEXTUAL_TIPS.awaitingDock)}
              placeholder="Reply…"
              class="w-full bg-surface-2/60 border border-edge/40 rounded px-2 py-1 text-[0.8rem] focus:outline-none focus:border-accent/60"
              autocomplete="off"
              autocorrect="off"
              spellcheck={false}
            />
          </form>
        </div>
      )}
    </Show>
  );
};

export default AwaitingDock;
