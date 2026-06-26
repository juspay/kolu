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
import { getTerminalRefs } from "./terminalRefs";
import { useHistoryPager } from "./useHistoryPager";
import { useTerminalStore } from "./useTerminalStore";

/** Match-decoration colours, identical to the live find bar (SearchBar.tsx). */
const SEARCH_DECORATIONS: ISearchOptions = {
  decorations: {
    matchBackground: "#FFD33D44",
    matchBorder: "#FFD33D88",
    matchOverviewRuler: "#FFD33D",
    activeMatchBackground: "#FFD33DAA",
    activeMatchBorder: "#FFD33D",
    activeMatchColorOverviewRuler: "#FFD33DFF",
  },
};

/** Rows above the loaded top within which a scroll-up triggers a backfill. */
const BACKFILL_THRESHOLD = 6;

type Sentinel =
  | { kind: "loading" }
  | { kind: "start" }
  | { kind: "evicted" }
  | { kind: "unavailable" }
  | { kind: "faulted" }
  | null;

const SENTINEL_TEXT: Record<string, string> = {
  loading: "⠋ loading older history…",
  start: "──────── Beginning of session ────────",
  evicted: "Older output trimmed to stay under the history limit",
  unavailable: "History isn't being recorded for this terminal.",
  faulted:
    "⚠ History may be incomplete — disk error; showing up to the last good point.",
};

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
  const [regex, setRegex] = createSignal(false);
  const [matchCount, setMatchCount] = createSignal(0);
  const [matchIndex, setMatchIndex] = createSignal(-1);
  let hits: { cursor: number }[] = [];

  const cols = () => term?.cols ?? 80;
  const overscanRows = () => Math.max(40, (term?.rows ?? 24) * 4);

  function renderAll(): number {
    if (!term) return 0;
    term.reset();
    for (const p of pages) term.write(p);
    return term.buffer.active.length;
  }

  async function loadInitial() {
    if (!term) return;
    setSentinel({ kind: "loading" });
    const res = await client.terminal.history({
      id: props.id,
      beforeCursor: null,
      maxLines: overscanRows(),
      width: cols(),
    });
    if (res.kind !== "ok") {
      pages = [];
      atFloor = true;
      topCursor = null;
      renderAll();
      setSentinel({ kind: res.kind } as Sentinel);
      return;
    }
    pages = [res.ansi];
    topCursor = res.nextCursor;
    atFloor = res.atFloor;
    renderAll();
    term.scrollToBottom();
    setSentinel(atFloor ? { kind: "start" } : null);
  }

  async function loadOlder() {
    if (!term || loading || atFloor || topCursor === null) return;
    loading = true;
    setSentinel({ kind: "loading" });
    try {
      const res = await client.terminal.history({
        id: props.id,
        beforeCursor: topCursor,
        maxLines: overscanRows(),
        width: cols(),
      });
      if (res.kind !== "ok") {
        atFloor = true;
        setSentinel({ kind: res.kind } as Sentinel);
        return;
      }
      const before = term.buffer.active.length;
      const anchor = term.buffer.active.viewportY;
      pages = [res.ansi, ...pages];
      const after = renderAll();
      // Hold the user's scroll anchor: the added rows pushed everything down.
      term.scrollToLine(anchor + (after - before));
      topCursor = res.nextCursor;
      atFloor = res.atFloor;
      setSentinel(atFloor ? { kind: "start" } : null);
    } finally {
      loading = false;
    }
  }

  /** Jump the pager to a search hit's span and highlight in-view occurrences. */
  async function jumpToHit(i: number) {
    if (!term || i < 0 || i >= hits.length) return;
    setMatchIndex(i);
    const res = await client.terminal.history({
      id: props.id,
      beforeCursor: hits[i]!.cursor,
      maxLines: overscanRows(),
      width: cols(),
    });
    if (res.kind !== "ok") return;
    pages = [res.ansi];
    topCursor = res.nextCursor;
    atFloor = res.atFloor;
    renderAll();
    term.scrollToBottom();
    search?.findNext(query(), {
      ...SEARCH_DECORATIONS,
      caseSensitive: caseSensitive(),
      regex: regex(),
    });
  }

  async function runSearch() {
    const q = query();
    if (!q) {
      hits = [];
      setMatchCount(0);
      setMatchIndex(-1);
      search?.clearDecorations();
      return;
    }
    try {
      const res = await client.terminal.searchHistory({
        id: props.id,
        query: q,
        beforeCursor: null,
        regex: regex(),
        caseSensitive: caseSensitive(),
        maxResults: 500,
      });
      hits = res.hits;
      setMatchCount(hits.length);
      if (hits.length > 0) await jumpToHit(0);
      else setMatchIndex(-1);
    } catch (err) {
      toast.error(`Search failed: ${(err as Error).message}`);
    }
  }

  function step(delta: 1 | -1) {
    if (hits.length === 0) return;
    const next = (matchIndex() + delta + hits.length) % hits.length;
    void jumpToHit(next);
  }

  async function jumpTop() {
    let guard = 0;
    while (!atFloor && guard++ < 200) await loadOlder();
    term?.scrollToTop();
  }

  function copyAll() {
    void client.terminal
      .historyText({ id: props.id })
      .then((t) => navigator.clipboard.writeText(t))
      .then(() => toast.success("Copied full history to clipboard"))
      .catch((err: Error) => toast.error(`Copy failed: ${err.message}`));
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

    const ro = new ResizeObserver(() => {
      if (!term || !fit) return;
      fit.fit();
      // Server-rendered ANSI is width-specific; refetch at the new width. The
      // byte cursors are reflow-stable, so reopening at the tip is correct
      // (depth re-pages on scroll).
      void loadInitial();
    });
    ro.observe(host);
    onCleanup(() => {
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
    return `${idx} / ${matchCount()}`;
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
            onInput={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (matchCount() === 0) void runSearch();
                else step(e.shiftKey ? -1 : 1);
              } else if (e.key === "Escape") {
                e.preventDefault();
                props.onClose();
              }
            }}
          />
          <ChipButton
            active={caseSensitive()}
            onClick={() => setCaseSensitive((v) => !v)}
            label="Case sensitive"
          >
            Aa
          </ChipButton>
          <ChipButton
            active={regex()}
            onClick={() => setRegex((v) => !v)}
            label="Regex"
          >
            .*
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
        <HeaderButton onClick={copyAll} label="Copy all history">
          ⧉
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
              "text-amber-400":
                s().kind === "faulted" || s().kind === "evicted",
              "text-fg-3": s().kind !== "faulted" && s().kind !== "evicted",
            }}
          >
            {SENTINEL_TEXT[s().kind]}
          </div>
        )}
      </Show>

      {/* Read-only xterm body (DOM renderer) */}
      <div ref={host} class="flex-1 min-h-0 overflow-hidden px-2" />

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
