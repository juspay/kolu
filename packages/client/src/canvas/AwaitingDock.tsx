/** Awaiting dock — top-right column of cards/pills surfacing every
 *  active agent. **One list, sorted strictly by `lastActivityAt`
 *  descending** so the most recent transition is always at the top
 *  regardless of which state it lands in. A working agent that just
 *  started outranks an awaiting agent from an hour ago, and vice
 *  versa — the dock answers "what just changed?" first, "what's
 *  blocking me?" second.
 *
 *  Two render shapes share the same sort:
 *  1. **Awaiting cards** — full cards for terminals whose agent is in
 *     `waiting` state. Show the last few non-chrome lines of the xterm
 *     buffer (via `tailBuffer`) plus a reply input that pipes to the
 *     PTY. The repo+branch+tail region is a click target that activates
 *     the underlying terminal; the input form is a sibling so focusing
 *     it doesn't switch tiles away.
 *  2. **Working pills** — single-row pills for terminals whose agent is
 *     `thinking`/`tool_use`. Repo + branch + animated agent indicator,
 *     click to jump.
 *
 *  Parked (auto-stale, `lastActivityAt > STALE_THRESHOLD_MS`)
 *  terminals are filtered out entirely.
 *
 *  Lives below the ChromeBar (top-14) so the workspace-chrome controls
 *  (record, panel, settings, ⌘K) stay clickable. Auto-hides when no
 *  agents are active. */

import { makeEventListener } from "@solid-primitives/event-listener";
import type { TerminalId, TerminalMetadata } from "kolu-common/surface";
import {
  type Component,
  For,
  Show,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import AgentIndicator from "../terminal/AgentIndicator";
import { tailBuffer } from "../terminal/bufferTail";
import { formatTimeAgo, useStaleCheck } from "../terminal/staleness";
import { getTerminalRefs } from "../terminal/terminalRefs";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { client } from "../wire";
import { useTileTheme } from "./useTileTheme";
import { agentBucket } from "./workspace-switcher/model";

const PEEK_REFRESH_MS = 250;
const MIN_TAIL_LINES = 3;
const MAX_TAIL_LINES = 10;
/** Approximate per-line height budget: each card needs eyebrow + agent
 *  row + reply input + padding (~120px) before tail lines start, plus
 *  ~18px per tail line at the current font size. The dock leaves room
 *  for its top offset and a comfortable bottom margin (~6rem). */
function tailLinesForViewport(viewportPx: number): number {
  const usable = Math.max(0, viewportPx - 200);
  return Math.max(
    MIN_TAIL_LINES,
    Math.min(MAX_TAIL_LINES, Math.floor(usable / 80)),
  );
}

const [viewportHeight, setViewportHeight] = createSignal(
  typeof window === "undefined" ? 1000 : window.innerHeight,
);

const AwaitingDock: Component = () => {
  const store = useTerminalStore();
  const isStale = useStaleCheck();
  onMount(() => {
    setViewportHeight(window.innerHeight);
    makeEventListener(window, "resize", () =>
      setViewportHeight(window.innerHeight),
    );
  });
  const tailLines = createMemo(() => tailLinesForViewport(viewportHeight()));

  const liveIds = createMemo(() =>
    store
      .terminalIds()
      .filter((id) => {
        const meta = store.getMetadata(id);
        if (!meta) return false;
        if (isStale(meta.lastActivityAt)) return false;
        const bucket = agentBucket(meta.agent);
        return bucket === "awaiting" || bucket === "working";
      })
      .sort((a, b) => {
        const ta = store.getMetadata(a)?.lastActivityAt ?? 0;
        const tb = store.getMetadata(b)?.lastActivityAt ?? 0;
        return tb - ta;
      }),
  );

  return (
    <Show when={liveIds().length > 0}>
      <div
        data-testid="awaiting-dock"
        class="absolute top-14 right-4 bottom-4 z-20 flex flex-col gap-2 items-end overflow-y-auto"
      >
        <For each={liveIds()}>
          {(id) => <DockItem id={id} tailLines={tailLines()} />}
        </For>
      </div>
    </Show>
  );
};

/** Picks the right shape for a terminal based on its current bucket.
 *  Reactive so a thinking → waiting transition swaps the pill for the
 *  full card in place. */
const DockItem: Component<{ id: TerminalId; tailLines: number }> = (props) => {
  const store = useTerminalStore();
  const bucket = createMemo(() =>
    agentBucket(store.getMetadata(props.id)?.agent),
  );
  return (
    <Show
      when={bucket() === "awaiting"}
      fallback={<WorkingPill id={props.id} />}
    >
      <AwaitingCard id={props.id} tailLines={props.tailLines} />
    </Show>
  );
};

const AwaitingCard: Component<{ id: TerminalId; tailLines: number }> = (
  props,
) => {
  const store = useTerminalStore();
  const tileTheme = useTileTheme();
  const combined = createMemo(() => {
    const i = store.getDisplayInfo(props.id);
    const m = store.getMetadata(props.id);
    return i && m ? { info: i, meta: m } : null;
  });
  const [tail, setTail] = createSignal<string[]>([]);
  const [value, setValue] = createSignal("");

  const refresh = () => {
    const xterm = getTerminalRefs(props.id)?.xterm;
    if (!xterm) {
      setTail([]);
      return;
    }
    setTail(tailBuffer(xterm, props.tailLines));
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
    <Show when={combined()}>
      {(c) => {
        const displayInfo = c().info;
        const m = c().meta;
        return (
          <div
            data-testid="awaiting-dock-card"
            data-terminal-id={props.id}
            class="pill-border pill-border-awaiting rounded-lg p-2.5 w-[280px] flex flex-col gap-1.5 shadow-lg"
            style={{
              "--pill-border-radius": "calc(0.5rem + 2px)",
              "background-color": tileTheme(props.id).bg,
              color: tileTheme(props.id).fg,
              border: `1px solid ${displayInfo.repoColor}`,
            }}
          >
            <button
              type="button"
              onClick={() => store.activate(props.id)}
              class="flex flex-col gap-1 text-left cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded"
              title="Jump to this terminal"
            >
              <div class="flex items-baseline justify-between gap-2 min-w-0">
                <span
                  class="font-mono text-[0.7rem] font-bold uppercase tracking-[0.14em] truncate min-w-0"
                  style={{ color: displayInfo.repoColor }}
                >
                  {displayInfo.key.group}
                </span>
                <span
                  class="text-[0.95rem] font-semibold leading-tight truncate min-w-0"
                  style={{ color: displayInfo.branchColor }}
                >
                  {displayInfo.key.label}
                </span>
              </div>
              <DockMetaRow meta={m} />
              <PrLine meta={m} />
              <Show when={tail().length > 0}>
                <div
                  data-testid="awaiting-dock-tail"
                  class="font-mono text-[0.7rem] text-fg-2 leading-snug whitespace-pre-wrap break-all w-full mt-0.5"
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
                class="w-full rounded px-2 py-1 text-[0.8rem] focus:outline-none focus:ring-2 focus:ring-accent/40 placeholder:opacity-60"
                style={{
                  color: "inherit",
                  "background-color":
                    "color-mix(in oklch, currentColor 8%, transparent)",
                  border:
                    "1px solid color-mix(in oklch, currentColor 25%, transparent)",
                }}
                autocomplete="off"
                autocorrect="off"
                spellcheck={false}
              />
            </form>
          </div>
        );
      }}
    </Show>
  );
};

const WorkingPill: Component<{ id: TerminalId }> = (props) => {
  const store = useTerminalStore();
  const tileTheme = useTileTheme();
  const combined = createMemo(() => {
    const i = store.getDisplayInfo(props.id);
    const m = store.getMetadata(props.id);
    return i && m ? { info: i, meta: m } : null;
  });

  return (
    <Show when={combined()}>
      {(c) => {
        const displayInfo = c().info;
        const m = c().meta;
        return (
          <button
            type="button"
            data-testid="awaiting-dock-working"
            data-terminal-id={props.id}
            onClick={() => store.activate(props.id)}
            class="pill-border pill-border-working rounded-lg px-2.5 py-1 flex flex-col gap-0.5 w-[280px] cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 text-left"
            style={{
              "--pill-border-radius": "calc(0.5rem + 2px)",
              "background-color": tileTheme(props.id).bg,
              color: tileTheme(props.id).fg,
              border: `1px solid ${displayInfo.repoColor}`,
            }}
            title="Jump to this terminal"
          >
            <div class="flex items-baseline justify-between gap-2 min-w-0">
              <span
                class="font-mono text-[0.65rem] font-bold uppercase tracking-[0.14em] truncate min-w-0"
                style={{ color: displayInfo.repoColor }}
              >
                {displayInfo.key.group}
              </span>
              <span
                class="text-[0.85rem] font-semibold leading-tight truncate min-w-0"
                style={{ color: displayInfo.branchColor }}
              >
                {displayInfo.key.label}
              </span>
            </div>
            <DockMetaRow meta={m} />
            <PrLine meta={m} />
          </button>
        );
      }}
    </Show>
  );
};

/** GitHub PR summary line (when one is resolved). Reads `meta.pr` —
 *  the same source the workspace switcher uses — so the kinds it
 *  accepts stay aligned: only `kind === "ok"` renders, the
 *  `absent`/`pending`/`unavailable` cases collapse to nothing. */
const PrLine: Component<{ meta: TerminalMetadata }> = (props) => {
  const pr = () => (props.meta.pr.kind === "ok" ? props.meta.pr.value : null);
  return (
    <Show when={pr()}>
      {(p) => (
        <div class="flex items-baseline gap-1.5 min-w-0 text-[0.65rem] text-fg-2">
          <span class="font-mono tabular-nums text-fg-3 shrink-0">
            #{p().number}
          </span>
          <span class="truncate min-w-0">{p().title}</span>
        </div>
      )}
    </Show>
  );
};

/** Shared "agent indicator (left) + lastActive (right)" sub-line used
 *  on both the full card and the compact pill. Renders nothing when
 *  the terminal has no agent — `<AwaitingDock>` only mounts these
 *  components when `agentBucket` is awaiting/working, but the
 *  `Show` keeps the render shape honest. */
const DockMetaRow: Component<{ meta: TerminalMetadata }> = (props) => {
  const lastActive = () => formatTimeAgo(props.meta.lastActivityAt);
  return (
    <Show when={props.meta.agent}>
      {(agent) => (
        <div class="flex items-center justify-between gap-2 min-w-0 text-[0.6rem] text-fg-3">
          <AgentIndicator agent={agent()} />
          <Show when={lastActive()}>
            {(label) => <span class="tabular-nums shrink-0">{label()}</span>}
          </Show>
        </div>
      )}
    </Show>
  );
};

export default AwaitingDock;
