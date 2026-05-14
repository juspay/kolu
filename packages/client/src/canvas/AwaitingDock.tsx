/** Awaiting dock — top-right column of cards/pills surfacing every
 *  active agent that needs you (full cards) or is busy (compact pills).
 *
 *  Two tiers, top to bottom:
 *  1. **Awaiting cards** — full cards for terminals whose agent is in
 *     `waiting` state. Show the last few non-chrome lines of the xterm
 *     buffer (via `tailBuffer`) plus a reply input that pipes to the
 *     PTY. The whole repo+branch+tail region is a click target that
 *     activates the underlying terminal; the input form is a sibling
 *     so focusing it doesn't switch tiles away.
 *  2. **Working pills** — single-row pills for terminals whose agent is
 *     `thinking`/`tool_use`. Just repo + branch, click to jump.
 *
 *  Parked (auto-stale, `lastActivityAt > STALE_THRESHOLD_MS`)
 *  terminals are filtered out of both tiers — once an agent's been
 *  idle for hours, the dock should stop pointing at it.
 *
 *  Lives below the ChromeBar (top-14) so the workspace-chrome controls
 *  (record, panel, settings, ⌘K) stay clickable. Auto-hides when both
 *  tiers are empty. */

import type { TerminalId } from "kolu-common/surface";
import {
  type Component,
  For,
  Show,
  createMemo,
  createSignal,
  onCleanup,
} from "solid-js";
import { tailBuffer } from "../terminal/bufferTail";
import { useStaleCheck } from "../terminal/staleness";
import { getTerminalRefs } from "../terminal/terminalRefs";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { client } from "../wire";
import { agentBucket } from "./workspace-switcher/model";

const TAIL_LINES = 3;
const PEEK_REFRESH_MS = 250;

const AwaitingDock: Component = () => {
  const store = useTerminalStore();
  const isStale = useStaleCheck();

  const liveIds = (bucket: "awaiting" | "working") =>
    store.terminalIds().filter((id) => {
      const meta = store.getMetadata(id);
      if (!meta) return false;
      if (isStale(meta.lastActivityAt)) return false;
      return agentBucket(meta.agent) === bucket;
    });

  const awaitingIds = createMemo(() => liveIds("awaiting"));
  const workingIds = createMemo(() => liveIds("working"));

  return (
    <Show when={awaitingIds().length + workingIds().length > 0}>
      <div
        data-testid="awaiting-dock"
        class="absolute top-14 right-4 z-20 flex flex-col gap-2 items-end"
      >
        <For each={awaitingIds()}>{(id) => <AwaitingCard id={id} />}</For>
        <For each={workingIds()}>{(id) => <WorkingPill id={id} />}</For>
      </div>
    </Show>
  );
};

const AwaitingCard: Component<{ id: TerminalId }> = (props) => {
  const store = useTerminalStore();
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
          class="pill-border pill-border-awaiting rounded-lg border border-edge/60 bg-surface-0/85 backdrop-blur-sm p-2.5 w-[280px] flex flex-col gap-1.5 shadow-lg"
          style={{ "--pill-border-radius": "calc(0.5rem + 2px)" }}
        >
          <button
            type="button"
            onClick={() => store.activate(props.id)}
            class="flex flex-col gap-1.5 text-left cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded"
            title="Jump to this terminal"
          >
            <div class="flex items-baseline justify-between gap-2 min-w-0">
              <span
                class="font-mono text-[0.6rem] font-bold uppercase tracking-[0.16em] truncate min-w-0"
                style={{ color: displayInfo().repoColor }}
              >
                {displayInfo().key.group}
              </span>
              <span
                class="text-[0.75rem] font-semibold truncate min-w-0"
                style={{ color: displayInfo().branchColor }}
              >
                {displayInfo().key.label}
              </span>
            </div>
            <Show when={tail().length > 0}>
              <div
                data-testid="awaiting-dock-tail"
                class="font-mono text-[0.7rem] text-fg-2 leading-snug whitespace-pre-wrap break-all w-full"
              >
                <For each={tail()}>
                  {(line) => <div class="truncate">{line}</div>}
                </For>
              </div>
            </Show>
          </button>
          <form onSubmit={submit}>
            <input
              type="text"
              data-testid="awaiting-dock-reply"
              value={value()}
              onInput={(e) => setValue(e.currentTarget.value)}
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

const WorkingPill: Component<{ id: TerminalId }> = (props) => {
  const store = useTerminalStore();
  const info = createMemo(() => store.getDisplayInfo(props.id));

  return (
    <Show when={info()}>
      {(displayInfo) => (
        <button
          type="button"
          data-testid="awaiting-dock-working"
          data-terminal-id={props.id}
          onClick={() => store.activate(props.id)}
          class="pill-border pill-border-working rounded-lg border border-edge/40 bg-surface-0/75 backdrop-blur-sm px-2.5 py-1 flex items-baseline gap-2 w-[280px] cursor-pointer hover:bg-surface-1/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          style={{ "--pill-border-radius": "calc(0.5rem + 2px)" }}
          title="Jump to this terminal"
        >
          <span
            class="font-mono text-[0.55rem] font-bold uppercase tracking-[0.16em] truncate"
            style={{ color: displayInfo().repoColor }}
          >
            {displayInfo().key.group}
          </span>
          <span
            class="text-[0.7rem] font-medium truncate"
            style={{ color: displayInfo().branchColor }}
          >
            {displayInfo().key.label}
          </span>
        </button>
      )}
    </Show>
  );
};

export default AwaitingDock;
