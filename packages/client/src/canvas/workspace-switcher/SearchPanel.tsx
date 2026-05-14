import type { TerminalId } from "kolu-common/surface";
import {
  type Component,
  createEffect,
  createSignal,
  For,
  Index,
  onCleanup,
  Show,
} from "solid-js";
import { toast } from "solid-sonner";
import { formatTimeAgo } from "../../terminal/staleness";
import { useTerminalStore } from "../../terminal/useTerminalStore";
import { CloseIcon } from "../../ui/Icons";
import { client } from "../../wire";
import { useTileTheme } from "../useTileTheme";
import { agentLabel, metaLine, prSummary, tokenLine } from "./chrome";
import {
  bucketDescriptor,
  type WorkspaceSwitcherColumn,
  type WorkspaceSwitcherEntry,
  type WorkspaceSwitcherModel,
} from "./model";

/** Expanded hover panel with repo facets, search, and agent-state columns.
 *
 *  Reads as an operator's console: typographic hierarchy carries the load,
 *  not boxes-within-boxes. Repo identity (color) appears in the sidebar's
 *  selection bar, the card eyebrow, and the card border — three echoes of
 *  the same truth. */
const WorkspaceSearchPanel: Component<{
  model: WorkspaceSwitcherModel;
  query: string;
  focusSearch: boolean;
  onQueryChange: (query: string) => void;
  onSearchFocused: () => void;
  onRepoFilterChange: (repoName: string | null) => void;
  onReviewReadyChange: (active: boolean) => void;
  onSelect: (id: TerminalId) => void;
  onClose: () => void;
}> = (props) => {
  const columnCount = () => Math.max(1, props.model.columns.length);
  const totalCount = () =>
    props.model.repoFacets.reduce((sum, facet) => sum + facet.count, 0);
  let searchInputRef: HTMLInputElement | undefined;

  createEffect(() => {
    if (!props.focusSearch) return;
    queueMicrotask(() => {
      searchInputRef?.focus();
      searchInputRef?.select();
      props.onSearchFocused();
    });
  });

  return (
    // Visibility, absolute positioning, and hover corridor geometry are owned
    // by the parent. This component renders only the interactive panel body.
    <div
      data-testid="workspace-switcher-panel"
      id="workspace-switcher-panel"
      class="pointer-events-auto relative w-full overflow-hidden rounded-xl border border-edge/80 bg-surface-1/95 backdrop-blur-xl shadow-[0_30px_80px_-20px_rgba(0,0,0,0.65),inset_0_1px_0_0_rgba(255,255,255,0.04)]"
    >
      {/* Top strip — search prompt + global count. The `>` glyph leans
       *  into the terminal-native aesthetic and replaces the generic
       *  bordered input box. */}
      <div class="flex items-center gap-3 px-4 h-10 border-b border-edge/60 bg-surface-0/40">
        <span
          aria-hidden="true"
          class="font-mono text-[0.85rem] leading-none text-accent select-none"
        >
          ⏵
        </span>
        <input
          ref={searchInputRef}
          data-testid="workspace-switcher-search"
          value={props.query}
          onInput={(e) => props.onQueryChange(e.currentTarget.value)}
          class="flex-1 min-w-0 bg-transparent border-0 outline-none font-mono text-[0.8rem] text-fg placeholder:text-fg-3/60 caret-accent"
          placeholder="repo, branch, pr, agent, cwd…"
          aria-label="Search workspaces"
          spellcheck={false}
          autocomplete="off"
        />
        <button
          type="button"
          data-testid="workspace-switcher-review-ready"
          data-active={props.model.reviewReadyOnly ? "" : undefined}
          class="shrink-0 inline-flex items-center gap-1.5 h-6 px-2 rounded-md text-[0.65rem] font-mono uppercase tracking-[0.14em] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          classList={{
            "bg-accent/15 text-accent border border-accent/40":
              props.model.reviewReadyOnly,
            "text-fg-3 border border-edge/60 hover:text-fg hover:bg-surface-2 hover:border-edge-bright/60":
              !props.model.reviewReadyOnly,
          }}
          aria-pressed={props.model.reviewReadyOnly ? "true" : "false"}
          title={
            props.model.reviewReadyOnly
              ? "Showing only terminals with an open PR — click to clear"
              : "Filter to terminals with an open PR (ready for review)"
          }
          onClick={() =>
            props.onReviewReadyChange(!props.model.reviewReadyOnly)
          }
        >
          <span aria-hidden="true">PR</span>
          <span class="tabular-nums opacity-80">
            {props.model.reviewReadyCount}
          </span>
        </button>
        <button
          type="button"
          data-testid="workspace-switcher-close"
          class="shrink-0 flex items-center justify-center w-6 h-6 -mr-1 rounded-md text-fg-3 hover:text-fg hover:bg-surface-2 active:bg-surface-2 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          aria-label="Close workspace switcher"
          title="Close (Esc)"
          onClick={() => props.onClose()}
        >
          <CloseIcon class="w-3.5 h-3.5" />
        </button>
      </div>

      <div class="grid grid-cols-[12rem_minmax(0,1fr)] max-h-[70vh] overflow-hidden">
        <aside class="scrollbar-subtle border-r border-edge/60 py-3 px-2 overflow-y-auto">
          <div class="px-2 mb-2 font-mono text-[0.6rem] uppercase tracking-[0.18em] text-fg-3/80">
            repos
          </div>
          <RepoFacetButton
            label="All"
            count={totalCount()}
            color="var(--color-accent)"
            selected={props.model.selectedRepo === null}
            onClick={() => props.onRepoFilterChange(null)}
            data-testid="workspace-switcher-repo"
            data-selected={props.model.selectedRepo === null ? "" : undefined}
          />
          <div class="mt-0.5 flex flex-col gap-px">
            <Index each={props.model.repoFacets}>
              {(facet) => (
                <RepoFacetButton
                  label={facet().repoName}
                  count={facet().count}
                  color={facet().color}
                  selected={props.model.selectedRepo === facet().repoName}
                  onClick={() =>
                    props.onRepoFilterChange(
                      props.model.selectedRepo === facet().repoName
                        ? null
                        : facet().repoName,
                    )
                  }
                  data-testid="workspace-switcher-repo"
                  data-repo-name={facet().repoName}
                  data-selected={
                    props.model.selectedRepo === facet().repoName
                      ? ""
                      : undefined
                  }
                />
              )}
            </Index>
          </div>
        </aside>

        <section class="min-w-0 p-4 overflow-hidden">
          <div
            class="scrollbar-subtle grid gap-4 overflow-y-auto max-h-[calc(70vh-3.5rem)] pr-1"
            style={{
              "grid-template-columns": `repeat(${columnCount()}, minmax(0, 1fr))`,
            }}
          >
            <Index each={props.model.columns}>
              {(column) => (
                <ColumnView column={column()} onSelect={props.onSelect} />
              )}
            </Index>
          </div>
          <Show when={props.model.visibleEntries.length === 0}>
            <div class="mt-4 font-mono text-[0.75rem] text-fg-3/80 text-center tracking-wide">
              ── no live terminals match ──
            </div>
          </Show>
        </section>
      </div>
    </div>
  );
};

/** Column body — handles both the flat agent-state columns and the Idle
 *  column's age sub-rows. Branches on `idleSubBuckets` so the renderer
 *  doesn't have to special-case the column key in every JSX block; the
 *  model already decided whether sub-rows are appropriate. */
const ColumnView: Component<{
  column: WorkspaceSwitcherColumn;
  onSelect: (id: TerminalId) => void;
}> = (props) => (
  <div
    data-testid="workspace-switcher-column"
    data-agent-bucket={props.column.key}
    class="min-w-0"
  >
    <div
      class="flex items-center justify-between gap-2 mb-2 pb-1.5 border-b"
      style={{
        "border-color": `color-mix(in oklch, ${props.column.accentVar} 22%, var(--color-edge))`,
      }}
    >
      <div
        class={`font-mono text-[0.65rem] font-semibold uppercase tracking-[0.2em] ${props.column.textClass}`}
      >
        {props.column.label}
      </div>
      <div class="font-mono text-[0.65rem] text-fg-3 tabular-nums">
        {props.column.entries.length.toString().padStart(2, "0")}
      </div>
    </div>
    <Show
      when={
        props.column.key === "idle" ? props.column.idleSubBuckets : undefined
      }
      fallback={
        <EntryList
          entries={props.column.entries}
          empty={props.column.empty}
          onSelect={props.onSelect}
        />
      }
    >
      {(subBuckets) => (
        <div class="flex flex-col gap-3">
          <For each={subBuckets()}>
            {(sub) => (
              <div
                data-testid="workspace-switcher-idle-sub"
                data-idle-sub={sub.key}
                class="flex flex-col gap-2"
              >
                <div class="flex items-center justify-between gap-2 px-1">
                  <div class="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-fg-3">
                    {sub.label}
                  </div>
                  <div class="font-mono text-[0.6rem] text-fg-3/70 tabular-nums">
                    {sub.entries.length.toString().padStart(2, "0")}
                  </div>
                </div>
                <EntryList
                  entries={sub.entries}
                  empty="empty"
                  onSelect={props.onSelect}
                  compactEmpty
                />
              </div>
            )}
          </For>
        </div>
      )}
    </Show>
  </div>
);

/** Entry-list body — shared by flat columns and Idle sub-rows. Owns the
 *  store/tileTheme reads so reactivity flows correctly through `Index`
 *  (the row callback only re-mounts on identity change; per-row updates
 *  are tracked through the `store.activeId()` etc. accessors). */
const EntryList: Component<{
  entries: readonly WorkspaceSwitcherEntry[];
  empty: string;
  compactEmpty?: boolean;
  onSelect: (id: TerminalId) => void;
}> = (props) => {
  const store = useTerminalStore();
  const tileTheme = useTileTheme();
  return (
    <div class="flex flex-col gap-2">
      <Show
        when={props.entries.length > 0}
        fallback={
          <div
            class={
              props.compactEmpty
                ? "font-mono text-[0.65rem] text-fg-3/40 tracking-wide pl-1"
                : "font-mono text-[0.7rem] text-fg-3/70 tracking-wide py-3 text-center"
            }
          >
            ── {props.empty} ──
          </div>
        }
      >
        <Index each={props.entries}>
          {(entry) => (
            <div data-testid="workspace-switcher-entry">
              <WorkspaceCard
                entry={entry()}
                active={store.activeId() === entry().id}
                unread={store.isUnread(entry().id)}
                tileBg={tileTheme(entry().id).bg}
                tileFg={tileTheme(entry().id).fg}
                onSelect={() => props.onSelect(entry().id)}
              />
              <Show when={entry().bucket === "awaiting"}>
                <AwaitingReplyInput terminalId={entry().id} />
              </Show>
            </div>
          )}
        </Index>
      </Show>
    </div>
  );
};

/** Sidebar facet row — left accent bar in repo color when selected,
 *  no fill. Count uses tabular nums so the column reads vertically. */
const RepoFacetButton: Component<{
  label: string;
  count: number;
  color: string;
  selected: boolean;
  onClick: () => void;
  "data-testid"?: string;
  "data-repo-name"?: string;
  "data-selected"?: string;
}> = (props) => (
  <button
    type="button"
    data-testid={props["data-testid"]}
    data-repo-name={props["data-repo-name"]}
    data-selected={props["data-selected"]}
    class="group/repo relative w-full flex items-center justify-between gap-2 pl-3 pr-2 py-1.5 rounded-md text-left cursor-pointer transition-colors hover:bg-surface-2/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/40"
    onClick={() => props.onClick()}
  >
    <span
      aria-hidden="true"
      class="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full transition-opacity duration-150"
      classList={{
        "opacity-100": props.selected,
        "opacity-0 group-hover/repo:opacity-40": !props.selected,
      }}
      style={{ "background-color": props.color }}
    />
    <span
      class="truncate text-sm transition-colors"
      classList={{
        "text-fg font-medium": props.selected,
        "text-fg-2 group-hover/repo:text-fg": !props.selected,
      }}
      style={props.selected ? { color: props.color } : undefined}
    >
      {props.label}
    </span>
    <span class="font-mono text-[0.7rem] tabular-nums text-fg-3 shrink-0">
      {props.count}
    </span>
  </button>
);

/** Single workspace card — eyebrow / headline / status / meta. Agent
 *  state lives on inactive card borders; active state uses a left rail so
 *  focus remains distinguishable even when the terminal is awaiting input.
 *  The Idle column hosts parked entries directly; cards inside it skip the
 *  breathing agent-state border and fade so live work reads louder. */
const WorkspaceCard: Component<{
  entry: WorkspaceSwitcherEntry;
  active: boolean;
  unread: boolean;
  tileBg: string;
  tileFg: string;
  onSelect: () => void;
}> = (props) => {
  const agent = () => props.entry.info.meta.agent;
  const snippet = () => props.entry.info.meta.agentSnippet;
  const pr = () => prSummary(props.entry);
  const tokens = () => tokenLine(agent());
  // Read the bucket the model assigned, not the raw agent state — an idle
  // entry that was previously "awaiting" must not paint a red ⏵ glyph
  // on a card that's been parked for hours, or it screams for attention
  // that no longer applies.
  const bucketInfo = () => bucketDescriptor(props.entry.bucket);
  const lastActive = () => formatTimeAgo(props.entry.info.meta.lastActivityAt);
  const idle = () => props.entry.bucket === "idle";

  return (
    <button
      type="button"
      data-testid="workspace-switcher-card"
      data-terminal-id={props.entry.id}
      data-repo-name={props.entry.repoName}
      data-agent-bucket={props.entry.bucket}
      data-active={props.active ? "" : undefined}
      class={`relative rounded-lg border p-2.5 text-left cursor-pointer transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${props.active || idle() ? "" : bucketInfo().borderClass}`}
      classList={{
        "border-edge-bright/70 bg-surface-0/60 shadow-[0_0_0_1px_color-mix(in_oklch,var(--card-color)_22%,transparent)]":
          props.active,
        "border-edge/60 bg-surface-0/60 hover:bg-surface-2/70 hover:border-edge-bright/70":
          !props.active,
        "opacity-60": idle() && !props.active,
      }}
      style={{
        "--card-color": props.entry.info.repoColor,
        "--pill-state-color": bucketInfo().accentVar,
        // Override the pill-border ring radius so the agent-state border
        // follows the card's `rounded-lg` corners instead of drawing the
        // default pill oval. `inset: -2px` on ::before bumps the outer
        // radius by 2px to stay flush.
        "--pill-border-radius": "calc(0.5rem + 2px)",
      }}
      onClick={() => props.onSelect()}
      title={props.entry.info.meta.cwd}
    >
      <Show when={props.active}>
        <span
          aria-hidden="true"
          class="absolute left-0 top-2 bottom-2 w-1 rounded-r-full"
          style={{ "background-color": props.entry.info.branchColor }}
        />
      </Show>
      <Show when={props.unread}>
        <span
          class="absolute right-2 top-2 inline-flex h-2 w-2"
          aria-hidden="true"
        >
          <span class="absolute inline-flex h-full w-full rounded-full bg-alert opacity-75 animate-ping" />
          <span class="relative inline-flex rounded-full h-2 w-2 bg-alert" />
        </span>
      </Show>

      {/* Eyebrow: repo identity + (right) PR # if resolved. */}
      <div class="flex items-center justify-between gap-2 min-w-0">
        <span
          class="font-mono text-[0.6rem] font-bold uppercase tracking-[0.16em] truncate min-w-0"
          style={{ color: props.entry.info.repoColor }}
        >
          {props.entry.repoName}
        </span>
        <Show when={pr()}>
          {(summary) => (
            <span class="font-mono text-[0.65rem] tabular-nums text-fg-2 shrink-0">
              #{summary().number}
            </span>
          )}
        </Show>
      </div>

      {/* Headline: branch label — DM Sans semibold, the human-readable
       *  anchor of the card. Suffix renders in mono tabular when present. */}
      <div class="mt-1 flex items-baseline gap-2 min-w-0">
        <span
          class="text-[0.95rem] font-semibold truncate leading-tight"
          style={{ color: props.entry.info.branchColor }}
        >
          {props.entry.label}
        </span>
        <Show when={props.entry.suffix}>
          {(suffix) => (
            <span class="font-mono text-[0.6rem] tabular-nums text-fg-3 shrink-0">
              {suffix()}
            </span>
          )}
        </Show>
      </div>

      {/* Status: glyph color encodes bucket; agent label and tokens sit
       *  on the same line for left-edge scanability. */}
      <div class="mt-2 flex items-center gap-1.5 min-w-0 text-[0.72rem] text-fg-2">
        <span
          aria-hidden="true"
          class={`font-mono leading-none shrink-0 ${bucketInfo().textClass}`}
        >
          {bucketInfo().glyph}
        </span>
        <span class="truncate">{agentLabel(agent())}</span>
        <Show when={tokens()}>
          {(t) => (
            <span class="font-mono text-[0.62rem] text-fg-3 tabular-nums shrink-0 ml-auto">
              {t()}
            </span>
          )}
        </Show>
      </div>

      {/* Peek snippet — most-recent assistant utterance or active tool
       *  call. Tool calls render in mono for typographic distinction
       *  ("Edit(foo.ts)" reads as code); assistant prose reads as text.
       *  Two-line clamp keeps the card a stable scan-target even when
       *  the snippet is long. */}
      <Show when={!idle() ? snippet() : null}>
        {(s) => (
          <div
            data-testid="workspace-switcher-card-snippet"
            data-snippet-kind={s().kind}
            class="mt-1.5 text-[0.7rem] leading-snug text-fg-2/90 line-clamp-2"
            classList={{
              "font-mono text-fg-3": s().kind === "tool_use",
            }}
            title={s().text}
          >
            {s().text}
          </div>
        )}
      </Show>

      {/* Meta line: cwd or foreground process — a quiet trailing whisper.
       *  Recency badge sits to the right when an agent semantic-key
       *  transition has been observed (lastActivityAt > 0). */}
      <div class="mt-0.5 flex items-baseline gap-2 font-mono text-[0.65rem] text-fg-3/90 min-w-0">
        <span class="truncate min-w-0">{metaLine(props.entry)}</span>
        <Show when={lastActive()}>
          {(label) => (
            <span
              data-testid="workspace-switcher-card-recency"
              class="tabular-nums text-fg-3/70 shrink-0 ml-auto"
              title={`Last agent activity: ${new Date(props.entry.info.meta.lastActivityAt).toLocaleString()}`}
            >
              {label()}
            </span>
          )}
        </Show>
      </div>

      {/* PR title row — only when resolved. The PR number already
       *  appears in the eyebrow, so this row carries title + checks. */}
      <Show when={pr()}>
        {(summary) => (
          <div class="mt-1 text-[0.7rem] text-fg-2 truncate">
            <span class="truncate">{summary().title}</span>
            <Show when={summary().checks}>
              {(checks) => (
                <span class="font-mono text-fg-3 tabular-nums">
                  {" · "}
                  {checks()}
                </span>
              )}
            </Show>
          </div>
        )}
      </Show>
    </button>
  );
};

/** Inline reply input — appears under awaiting cards so the user can
 *  answer a prompt without focusing the terminal. Submits with Enter,
 *  forwarding the typed text plus a trailing `\r` to the agent's PTY
 *  via `terminal.sendInput`. Held outside the parent card's `<button>`
 *  element to keep HTML valid (no nested interactive controls) and to
 *  ensure click+keypress events don't bubble to the card's onSelect. */
const AwaitingReplyInput: Component<{ terminalId: TerminalId }> = (props) => {
  const [value, setValue] = createSignal("");
  const [sending, setSending] = createSignal(false);
  // Tracks whether the component is still mounted. The 50 ms gap in
  // `submit()` straddles a microtask boundary; if the user switches
  // terminals (or the awaiting bucket clears) during that gap, we
  // skip the trailing CR write and the post-submit `setValue("")` so
  // we don't write to a torn-down reactive owner.
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });

  async function submit() {
    const text = value().trim();
    if (text.length === 0 || sending()) return;
    setSending(true);
    try {
      // Send the text and the trailing carriage return as **two
      // separate PTY writes** with a short gap. Combining them into a
      // single `${text}\r` works for Claude Code's Ink-based input (it
      // splits the chunk into key events itself), but Codex's
      // Ratatui-backed input reads the whole chunk in one `read()` and
      // treats the trailing CR as a literal newline inside the text
      // rather than as the Enter key — so the text lands in the prompt
      // but the turn never submits. Splitting the writes mimics a fast
      // typer; every TUI we tested treats a CR that arrives in its
      // own read as the Enter keypress.
      await client.terminal.sendInput({
        id: props.terminalId,
        data: text,
      });
      // 50 ms is enough for the TUI's input event loop to process the
      // pasted characters before the CR arrives. Lower values (10-20)
      // intermittently raced on a busy event loop in dogfooding; higher
      // values feel laggy on the human side.
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (disposed) return;
      await client.terminal.sendInput({
        id: props.terminalId,
        data: "\r",
      });
      if (!disposed) setValue("");
    } catch (err) {
      toast.error(`Failed to send reply: ${(err as Error).message}`);
    } finally {
      if (!disposed) setSending(false);
    }
  }

  return (
    <div
      class="mt-1.5 flex items-center gap-1.5 px-2 py-1 rounded-md border border-edge/60 bg-surface-0/80"
      data-testid="workspace-switcher-reply"
      data-terminal-id={props.terminalId}
    >
      <span
        aria-hidden="true"
        class="font-mono text-[0.75rem] leading-none text-warning select-none"
      >
        ⏵
      </span>
      <input
        data-testid="workspace-switcher-reply-input"
        type="text"
        value={value()}
        disabled={sending()}
        onInput={(e) => setValue(e.currentTarget.value)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // Stop propagation so the search bar and global shortcuts don't
          // capture keystrokes while the reply is focused.
          e.stopPropagation();
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
        }}
        class="flex-1 min-w-0 bg-transparent border-0 outline-none font-mono text-[0.72rem] text-fg placeholder:text-fg-3/60 caret-warning disabled:opacity-60"
        placeholder="Reply…"
        aria-label="Reply to agent"
        spellcheck={false}
        autocomplete="off"
      />
    </div>
  );
};

export default WorkspaceSearchPanel;
