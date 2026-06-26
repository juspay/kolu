/** The copy-mode history pager (PR2) — a read-only, fixed-width reader over the
 *  on-disk transcript. Never a splice into the live reflowing grid: the live
 *  `Terminal.tsx` stays mounted and running behind it. The body is a dedicated
 *  `@xterm/xterm` instance with the DOM renderer (no WebGL — it must not spend
 *  the WebGL budget), never attached to the live PTY; it opens at the bottom
 *  (newest), pages UP by the reflow-stable byte cursor, searches the transcript
 *  server-side, and exports the full un-clipped history as a themed PDF.
 *
 *  Hosts: a desktop `ModalDialog` or a mobile bottom `Drawer` (forked on
 *  `layoutMode()`), so it reads as a separate surface over the dimmed canvas. */

import Drawer from "@corvu/drawer";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import type { ISearchOptions } from "@xterm/addon-search";
import { Terminal as XTerm } from "@xterm/xterm";
import type { TerminalId } from "kolu-common/surface";
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { toast } from "solid-sonner";
import { FONT_FAMILY } from "terminal-themes";
import { exportScrollbackAsPdf } from "../exportScrollbackAsPdf";
import { withKeyboardDismiss } from "../ui/dismissSoftKeyboard";
import { ChevronDownIcon, ChevronUpIcon, CloseIcon } from "../ui/Icons";
import ModalDialog from "../ui/ModalDialog";
import { surface } from "../ui/Surface";
import { CONTEXTUAL_TIPS } from "../settings/tips";
import { useTips } from "../settings/useTips";
import { isDesktop } from "../useMobile";
import { client } from "../wire";
import { SEARCH_DECORATIONS } from "./SearchBar";
import { getTerminalRefs } from "./terminalRefs";
import { useHistoryPager } from "./useHistoryPager";
import { useTerminalStore } from "./useTerminalStore";

/** Match-decoration colours, identical to the live find bar (SearchBar.tsx). */
/** Rows above the loaded top within which a scroll-up triggers a backfill. */
const BACKFILL_THRESHOLD = 6;

type Sentinel =
  | { kind: "loading" }
  | { kind: "start" }
  | { kind: "evicted" }
  | { kind: "unavailable" }
  | { kind: "faulted" }
  | { kind: "error" }
  | null;

const SENTINEL_TEXT: Record<string, string> = {
  loading: "⠋ loading older history…",
  start: "──────── Beginning of session ────────",
  evicted: "Older output trimmed to stay under the history limit",
  unavailable: "History isn't being recorded for this terminal.",
  faulted:
    "⚠ History unavailable — a disk error interrupted recording for this terminal.",
  error: "⚠ Couldn't load history — see the error notification.",
};

/** Sentinel kinds that read as a warning (amber) rather than neutral chrome —
 *  the single predicate the footer's colour classList tests, so a new warning
 *  kind can't silently drift the two mirrored arms. */
const WARN_SENTINELS = new Set(["faulted", "evicted", "error"]);

/** The pager body — owns the xterm lifecycle and the backfill/search state.
 *  Re-created (keyed) per open terminal, so its state never leaks across tiles. */
function PagerBody(props: { id: TerminalId; onClose: () => void }) {
  const store = useTerminalStore();
  let host!: HTMLDivElement;
  let term: XTerm | null = null;
  let fit: FitAddon | null = null;
  let search: SearchAddon | null = null;

  // Loaded ANSI pages, oldest→newest. Each ends with a clean CRLF, so writing
  // them in order reproduces the single-shot render.
  let pages: string[] = [];
  let topCursor: number | null = null; // byteSeq above which older history sits
  let atFloor = false;
  let loading = false;

  const [sentinel, setSentinel] = createSignal<Sentinel>({ kind: "loading" });
  const [query, setQuery] = createSignal("");
  const [caseSensitive, setCaseSensitive] = createSignal(false);
  const [matchCount, setMatchCount] = createSignal(0);
  const [matchIndex, setMatchIndex] = createSignal(-1);
  let hits: { cursor: number }[] = [];
  // The byte cursor of the span currently rendered for search navigation, or
  // null when the body holds a non-search page (initial / backfilled). Lets
  // stepping among matches that share one span advance the in-view SearchAddon
  // instead of reloading the same page and re-highlighting the first hit (F9).
  let loadedCursor: number | null = null;
  // Search pagination + invalidation (F3, F8). `searchNextCursor` resumes the
  // server scan beyond the first capped page; `searchTruncated` drives the "+"
  // in the match label so a partial hit list is never shown as complete.
  // `executedKey` is the (query, case) signature of the hit list we hold,
  // so editing the query / toggling case re-runs the search instead of
  // stepping the stale hits.
  let searchNextCursor: number | null = null;
  const [searchTruncated, setSearchTruncated] = createSignal(false);
  let executedKey: string | null = null;
  // One fixed-width flag char (case c/i) then the raw query — a `:` delimiter
  // keeps it readable; the fixed prefix makes the signature unambiguous even
  // when the query itself contains a `:`.
  const searchKey = (): string => `${caseSensitive() ? "c" : "i"}:${query()}`;
  // A monotonic token guarding the fetch→render races (F7): mount, the
  // ResizeObserver, the Latest button, and search jumps all start loads; only
  // the newest may apply its pages, so an older response can't overwrite a
  // newer width's render. Every fetcher captures the token and bails after each
  // await if a newer load has started.
  let loadSeq = 0;
  // The sibling guard for the search RPCs (F5): `runSearch`/`loadMoreHits` await
  // before committing hits/counts/cursors, so a slow search for an OLD query
  // could otherwise overwrite the UI for the current one (and leave navigation on
  // stale cursors). Each captures a token; a newer search — or any query/option
  // change via `resetSearch` — bumps it, so a late response bails after the await.
  let searchSeq = 0;

  const overscanRows = () => Math.max(40, (term?.rows ?? 24) * 4);
  // The pager renders history at its HISTORICAL width (never reflowed to the
  // modal), so the xterm is sized to the content, not the viewport. `contentCols`
  // grows monotonically as wider epochs page in (`res.contentWidth`); the modal
  // scrolls horizontally past it. Fixed-row content is width-locked, so widening
  // the xterm never re-wraps a row.
  let contentCols = 80;
  /** Adopt a page's content width — grow the xterm if this epoch is wider. */
  function adoptWidth(w: number): void {
    contentCols = Math.max(contentCols, w);
  }

  /** Resolve once xterm has parsed `data` into the buffer — its write is async,
   *  so reading buffer length / scrolling / searching before the callback fires
   *  races the render (F5). */
  function writeAsync(t: XTerm, data: string): Promise<void> {
    return new Promise((resolve) => t.write(data, () => resolve()));
  }

  /** Re-render every loaded page and resolve only after the writes have parsed,
   *  returning the resulting buffer length. Callers AWAIT this before reading
   *  buffer state, scrolling, or invoking search. */
  async function renderAll(): Promise<number> {
    if (!term) return 0;
    // Size the xterm to the content BEFORE writing, so a fixed-row line wider than
    // the modal is rendered at full width (the modal h-scrolls) rather than
    // soft-wrapped. Widening never re-wraps fixed rows, so re-rendering is safe.
    if (term.cols !== contentCols) term.resize(contentCols, term.rows);
    term.reset();
    for (const p of pages) {
      if (!term) return 0;
      await writeAsync(term, p);
    }
    return term?.buffer.active.length ?? 0;
  }

  async function loadInitial() {
    if (!term) return;
    const token = ++loadSeq;
    setSentinel({ kind: "loading" });
    loadedCursor = null;
    let res: Awaited<ReturnType<typeof client.terminal.history>>;
    try {
      res = await client.terminal.history({
        id: props.id,
        beforeCursor: null,
        maxLines: overscanRows(),
      });
    } catch (err) {
      // Don't leave the loading sentinel up forever on an RPC failure (F6) — the
      // loaders are invoked fire-and-forget from mount/scroll/resize, so an
      // uncaught throw is an unhandled rejection with no user signal.
      if (token !== loadSeq) return;
      setSentinel({ kind: "error" });
      toast.error(`Failed to load history: ${(err as Error).message}`);
      return;
    }
    // A newer load (resize / Latest) superseded this one mid-flight — drop the
    // stale response so it can't overwrite the newer width's pages (F7).
    if (token !== loadSeq || !term) return;
    if (res.kind !== "ok") {
      pages = [];
      atFloor = true;
      topCursor = null;
      await renderAll();
      if (token !== loadSeq) return;
      setSentinel({ kind: res.kind } as Sentinel);
      return;
    }
    pages = [res.ansi];
    topCursor = res.nextCursor;
    atFloor = res.atFloor;
    adoptWidth(res.contentWidth);
    await renderAll();
    if (token !== loadSeq) return;
    term?.scrollToBottom();
    // At the floor: an EVICTED floor (older trimmed) reads differently from the
    // genuine start of session — show the honest sentinel for each (F4).
    setSentinel(
      atFloor ? { kind: res.floorEvicted ? "evicted" : "start" } : null,
    );
  }

  /** One backward page. Returns an explicit outcome so `jumpTop` can stop the
   *  moment a page fails or the floor is reached, instead of spinning on a
   *  swallowed error or an arbitrary page cap (F4). */
  type LoadOutcome = "loaded" | "floor" | "noop" | "failed" | "stale";
  async function loadOlder(): Promise<LoadOutcome> {
    if (!term || loading || atFloor || topCursor === null) return "noop";
    const token = ++loadSeq;
    loading = true;
    setSentinel({ kind: "loading" });
    try {
      const res = await client.terminal.history({
        id: props.id,
        beforeCursor: topCursor,
        maxLines: overscanRows(),
      });
      if (token !== loadSeq || !term) return "stale";
      if (res.kind !== "ok") {
        atFloor = true;
        setSentinel({ kind: res.kind } as Sentinel);
        return "floor";
      }
      const before = term.buffer.active.length;
      const anchor = term.buffer.active.viewportY;
      pages = [res.ansi, ...pages];
      loadedCursor = null;
      adoptWidth(res.contentWidth);
      const after = await renderAll();
      if (token !== loadSeq || !term) return "stale";
      // Hold the user's scroll anchor: the added rows pushed everything down.
      term.scrollToLine(anchor + (after - before));
      topCursor = res.nextCursor;
      atFloor = res.atFloor;
      // At the floor: an EVICTED floor (older trimmed) reads differently from the
      // genuine start of session — show the honest sentinel for each (F4).
      setSentinel(
        atFloor ? { kind: res.floorEvicted ? "evicted" : "start" } : null,
      );
      return atFloor ? "floor" : "loaded";
    } catch (err) {
      // Same fire-and-forget surface as loadInitial — surface the failure rather
      // than reject unhandled (F6), and report it so jumpTop aborts (F4).
      if (token !== loadSeq) return "stale";
      setSentinel({ kind: "error" });
      toast.error(`Failed to load older history: ${(err as Error).message}`);
      return "failed";
    } finally {
      loading = false;
    }
  }

  /** Jump the pager to a search hit's span and highlight the in-view occurrence.
   *  When the target hit shares the span already loaded, step the SearchAddon
   *  in-view (forward/back by `dir`) instead of reloading the page — otherwise
   *  every hit in one span re-renders the same page and re-highlights its first
   *  occurrence while the counter advances (F9). */
  async function jumpToHit(i: number, dir: 1 | -1 = 1) {
    if (!term || i < 0 || i >= hits.length) return;
    setMatchIndex(i);
    const cursor = hits[i]!.cursor;
    const opts: ISearchOptions = {
      decorations: SEARCH_DECORATIONS,
      caseSensitive: caseSensitive(),
    };
    if (cursor !== loadedCursor) {
      const token = ++loadSeq;
      let res: Awaited<ReturnType<typeof client.terminal.history>>;
      try {
        res = await client.terminal.history({
          id: props.id,
          beforeCursor: cursor,
          maxLines: overscanRows(),
        });
      } catch (err) {
        if (token !== loadSeq) return;
        setSentinel({ kind: "error" });
        toast.error(`Failed to load history: ${(err as Error).message}`);
        return;
      }
      if (token !== loadSeq || !term) return;
      if (res.kind !== "ok") return;
      pages = [res.ansi];
      topCursor = res.nextCursor;
      atFloor = res.atFloor;
      loadedCursor = cursor;
      adoptWidth(res.contentWidth);
      await renderAll();
      if (token !== loadSeq || !term) return;
      term.scrollToBottom();
    }
    if (dir === -1) search?.findPrevious(query(), opts);
    else search?.findNext(query(), opts);
  }

  /** Reset all search state — called when the query or an option changes so a
   *  stale hit list is never stepped or shown as complete (F3). */
  function resetSearch() {
    hits = [];
    setMatchCount(0);
    setMatchIndex(-1);
    searchNextCursor = null;
    setSearchTruncated(false);
    executedKey = null;
    loadedCursor = null;
    // Abandon any search RPC still in flight so it can't commit over the cleared
    // state (F5).
    searchSeq++;
    search?.clearDecorations();
  }

  /** A search that ran out at the eviction floor (older content trimmed under
   *  retention) is NOT exhaustive — say so, rather than let the "n / m" count
   *  read as the complete set of matches (F3). Terminal (nextCursor is null), so
   *  this fires at most once per query as the search reaches the floor. */
  function noteIfEvicted(res: { evicted: boolean }): void {
    if (res.evicted)
      toast.warning(
        "Older history was trimmed under the retention limit — earlier matches may be missing",
      );
  }

  async function runSearch() {
    const q = query();
    if (!q) {
      resetSearch();
      return;
    }
    const key = searchKey();
    const token = ++searchSeq;
    try {
      const res = await client.terminal.searchHistory({
        id: props.id,
        query: q,
        beforeCursor: null,
        caseSensitive: caseSensitive(),
        maxResults: 500,
      });
      // A newer search (or a query/option change) superseded this one mid-flight:
      // drop the stale results rather than overwrite the current query's UI (F5).
      if (token !== searchSeq) return;
      hits = res.hits;
      setMatchCount(hits.length);
      searchNextCursor = res.nextCursor;
      setSearchTruncated(res.truncated);
      noteIfEvicted(res);
      executedKey = key;
      loadedCursor = null;
      if (hits.length > 0) await jumpToHit(0);
      else setMatchIndex(-1);
    } catch (err) {
      toast.error(`Search failed: ${(err as Error).message}`);
    }
  }

  /** Page in the next batch of older matches beyond the first capped page (F8).
   *  Returns how many hits were appended. */
  async function loadMoreHits(): Promise<number> {
    if (searchNextCursor === null) return 0;
    const token = ++searchSeq;
    const cursor = searchNextCursor;
    const res = await client.terminal.searchHistory({
      id: props.id,
      query: query(),
      beforeCursor: cursor,
      caseSensitive: caseSensitive(),
      maxResults: 500,
    });
    // The query/options changed (or a fresh search ran) while paging: don't append
    // the older query's matches onto the current hit list (F5).
    if (token !== searchSeq) return 0;
    hits = [...hits, ...res.hits];
    setMatchCount(hits.length);
    searchNextCursor = res.nextCursor;
    setSearchTruncated(res.truncated);
    noteIfEvicted(res);
    return res.hits.length;
  }

  function step(delta: 1 | -1) {
    if (hits.length === 0) return;
    const target = matchIndex() + delta;
    // Stepping forward past the loaded tail with more matches on the server:
    // page them in rather than wrapping back to the top over a partial list (F8).
    if (delta === 1 && target >= hits.length && searchNextCursor !== null) {
      const base = hits.length;
      void loadMoreHits()
        .then((added) => jumpToHit(added > 0 ? base : 0, 1))
        .catch((err: Error) =>
          toast.error(`Failed to load more matches: ${err.message}`),
        );
      return;
    }
    const next = (target + hits.length) % hits.length;
    void jumpToHit(next, delta);
  }

  async function jumpTop() {
    // Load straight to the real beginning — no arbitrary page cap. Stop the
    // instant a page fails, hits the floor, or is superseded, so a single RPC
    // failure can't fire 200 toasts and a deep history isn't cut short (F4).
    for (;;) {
      const outcome = await loadOlder();
      if (outcome !== "loaded") break;
    }
    term?.scrollToTop();
  }

  function exportPdf() {
    void exportScrollbackAsPdf(props.id, store.getMetadata(props.id)).catch(
      (err: Error) => toast.error(`Failed to export PDF: ${err.message}`),
    );
  }

  onMount(() => {
    const theme = getTerminalRefs(props.id)?.xterm.options.theme ?? {};
    const t = new XTerm({
      cols: 80,
      rows: 24,
      scrollback: 100_000,
      theme,
      fontFamily: FONT_FAMILY,
      disableStdin: true,
      allowProposedApi: true,
    });
    fit = new FitAddon();
    search = new SearchAddon();
    t.loadAddon(fit);
    t.loadAddon(search);
    t.open(host);
    fit.fit();
    term = t;
    // Backfill when the user scrolls near the loaded top.
    t.onScroll((y) => {
      if (y <= BACKFILL_THRESHOLD) void loadOlder();
    });
    void loadInitial();
    useTips().showTipOnce(CONTEXTUAL_TIPS.historyPager);

    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(() => {
      // History renders at its HISTORICAL width (never the reader's), so a resize
      // NEVER refetches — only the visible ROW count changes (the modal grew/shrank
      // in height). Keep the xterm at `contentCols` and just re-fit rows; the
      // already-loaded pages stay in scrollback. Debounce so a drag coalesces.
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        resizeTimer = undefined;
        if (!term || !fit) return;
        const dims = fit.proposeDimensions();
        if (dims?.rows && dims.rows !== term.rows)
          term.resize(contentCols, dims.rows);
      }, 100);
    });
    ro.observe(host);
    onCleanup(() => {
      if (resizeTimer) clearTimeout(resizeTimer);
      ro.disconnect();
      term?.dispose();
      term = null;
    });
  });

  const ChipButton = (p: {
    active: boolean;
    onClick: () => void;
    label: string;
    children: string;
  }) => (
    <button
      type="button"
      class="px-1.5 py-0.5 rounded text-xs font-mono leading-none border"
      classList={{
        "bg-accent/30 border-accent text-fg": p.active,
        "bg-surface-2 border-edge text-fg-3": !p.active,
      }}
      title={p.label}
      onClick={p.onClick}
    >
      {p.children}
    </button>
  );

  const HeaderButton = (p: {
    onClick: () => void;
    label: string;
    children: import("solid-js").JSX.Element;
  }) => (
    <button
      type="button"
      class="h-8 min-w-8 px-2 flex items-center justify-center rounded-lg text-fg-3 hover:text-fg hover:bg-black/20 transition-colors"
      title={p.label}
      aria-label={p.label}
      onClick={p.onClick}
    >
      {p.children}
    </button>
  );

  const matchLabel = () => {
    if (!query()) return "";
    if (matchCount() === 0) return "No results";
    const idx = matchIndex() >= 0 ? matchIndex() + 1 : "?";
    // The trailing "+" marks a capped hit list with older matches still on the
    // server — stepping past the end pages them in (F8).
    return `${idx} / ${matchCount()}${searchTruncated() ? "+" : ""}`;
  };

  return (
    <div class="flex flex-col h-full min-h-0">
      {/* Header — title, search, jump, PDF, close */}
      <div class="flex items-center gap-2 px-3 py-2 border-b border-edge shrink-0 flex-wrap">
        <span class="text-sm text-fg-2 font-medium mr-1">⏱ History</span>
        <div class="flex items-center gap-1.5">
          <input
            type="text"
            placeholder="Find…"
            class="bg-surface-2 text-fg text-sm rounded-lg px-2 py-1 w-40 outline-none border border-edge focus:border-accent"
            value={query()}
            onInput={(e) => {
              setQuery(e.currentTarget.value);
              // The hit list belongs to the previous query — drop it so the next
              // Enter runs a fresh search instead of stepping stale hits (F3).
              resetSearch();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                // Re-search when the query/options changed since the loaded hits
                // were fetched; otherwise step within them (F3).
                if (matchCount() === 0 || searchKey() !== executedKey)
                  void runSearch();
                else step(e.shiftKey ? -1 : 1);
              } else if (e.key === "Escape") {
                e.preventDefault();
                props.onClose();
              }
            }}
          />
          <ChipButton
            active={caseSensitive()}
            onClick={() => {
              setCaseSensitive((v) => !v);
              resetSearch();
            }}
            label="Case sensitive"
          >
            Aa
          </ChipButton>
          <span class="text-xs text-fg-3 min-w-[3.5rem] text-center tabular-nums">
            {matchLabel()}
          </span>
          <HeaderButton onClick={() => step(-1)} label="Previous match">
            <ChevronUpIcon />
          </HeaderButton>
          <HeaderButton onClick={() => step(1)} label="Next match">
            <ChevronDownIcon />
          </HeaderButton>
        </div>
        <div class="flex-1" />
        <HeaderButton onClick={() => void jumpTop()} label="Top of history">
          ⤒
        </HeaderButton>
        <HeaderButton onClick={() => void loadInitial()} label="Latest">
          ⤓
        </HeaderButton>
        <HeaderButton onClick={exportPdf} label="Export as PDF">
          ⤓ PDF
        </HeaderButton>
        <HeaderButton onClick={props.onClose} label="Close (Esc)">
          <CloseIcon />
        </HeaderButton>
      </div>

      {/* Top sentinel */}
      <Show when={sentinel()}>
        {(s) => (
          <div
            class="px-3 py-1 text-xs text-center shrink-0"
            classList={{
              "text-amber-400": WARN_SENTINELS.has(s().kind),
              "text-fg-3": !WARN_SENTINELS.has(s().kind),
            }}
          >
            {SENTINEL_TEXT[s().kind]}
          </div>
        )}
      </Show>

      {/* Read-only xterm body (DOM renderer). History renders at its HISTORICAL
          width (never reflowed), so the xterm is sized to the content and this
          wrapper scrolls HORIZONTALLY when it's wider than the modal; the xterm
          owns vertical scroll (its scrollback). */}
      <div class="flex-1 min-h-0 overflow-x-auto overflow-y-hidden px-2">
        <div ref={host} class="h-full w-max" />
      </div>

      {/* Footer — jump to live */}
      <div class="flex items-center justify-end px-3 py-1.5 border-t border-edge shrink-0">
        <button
          type="button"
          class="text-sm text-fg-2 hover:text-fg flex items-center gap-1"
          onClick={props.onClose}
        >
          ↓ Jump to live
        </button>
      </div>
    </div>
  );
}

/** The App-level singleton: renders the pager for the active terminal when its
 *  pager is open (only one is open at a time — it closes on active switch). */
export default function HistoryPager() {
  const store = useTerminalStore();
  const pager = useHistoryPager();
  const openId = (): TerminalId | null => {
    const id = store.activeId();
    return id !== null && pager.isOpen(id) ? id : null;
  };
  const chrome = surface({ radius: "xl", shadow: "soft" });

  return (
    <Show when={openId()} keyed>
      {(id) => {
        // withKeyboardDismiss wraps the open-change handler (blur soft keyboard
        // on close); `close()` is the 0-arg button callback that routes through it.
        const onOpenChange = withKeyboardDismiss((open: boolean) => {
          if (!open) pager.setOpen(id, false);
        });
        const close = () => onOpenChange(false);
        return (
          <Show
            when={isDesktop()}
            fallback={
              <Drawer side="bottom" open onOpenChange={onOpenChange}>
                <Drawer.Portal>
                  <Drawer.Overlay class="fixed inset-0 z-40 bg-black/40 opacity-0 transition-opacity duration-200 data-open:opacity-100" />
                  <Drawer.Content class="fixed bottom-0 left-0 right-0 z-50 bg-surface-0 border-t border-edge shadow-xl h-[90vh] flex flex-col rounded-t-lg overflow-hidden">
                    <div
                      class="flex justify-center py-1.5 shrink-0"
                      aria-hidden="true"
                    >
                      <span class="w-10 h-1 rounded-full bg-fg-3/40" />
                    </div>
                    <div class="flex-1 min-h-0">
                      <PagerBody id={id} onClose={close} />
                    </div>
                  </Drawer.Content>
                </Drawer.Portal>
              </Drawer>
            }
          >
            <ModalDialog
              open
              onOpenChange={onOpenChange}
              size="lg"
              refocusOnClose
            >
              <div
                class={`${chrome.class} flex flex-col w-full overflow-hidden`}
                style={{ height: "min(74vh, 60rem)" }}
              >
                <PagerBody id={id} onClose={close} />
              </div>
            </ModalDialog>
          </Show>
        );
      }}
    </Show>
  );
}
