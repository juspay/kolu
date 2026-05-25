/** MobileCodeSheet — content of the mobile file-browser drawer.
 *
 *  On mobile the right panel is hidden (`RightPanelLayout` returns its
 *  children directly when `isMobile()` is true), so the Code tab's file
 *  tree + content split has nowhere to live. This sheet is the mobile
 *  surface for the same data — a bottom drawer with a master-detail
 *  flow:
 *
 *  - **Master**: Pierre's `FileTree` over the active terminal's repo
 *    (`fsListAll` stream).
 *  - **Detail**: `BrowseFileDispatcher` — text files render via Pierre's
 *    `CodeView`, `.html`/`.svg`/`.pdf` render via the sandboxed
 *    `iframe` preview the desktop Code tab uses. Identical components,
 *    no mobile-specific viewer.
 *
 *  Selection persists per-terminal via `useRightPanel.selectedFile`,
 *  keyed by `"browse"` mode — the same slot the desktop CodeTab writes,
 *  so opening the same terminal on desktop after a mobile session
 *  restores the last-viewed file. The back arrow clears the slot;
 *  the close button dismisses the whole drawer without touching
 *  selection. */

import { FileTree } from "@kolu/solid-pierre";
import type { TerminalId, TerminalMetadata } from "kolu-common/surface";
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  Match,
  on,
  Show,
  Switch,
} from "solid-js";
import { toast } from "solid-sonner";
import { type NavRequest, resolveNavPath } from "./navRequest";
import { pendingMobileOpen } from "./openInMobileFiles";
import BrowseFileDispatcher from "./right-panel/BrowseFileDispatcher";
import { useRightPanel } from "./right-panel/useRightPanel";
import { useColorScheme } from "./settings/useColorScheme";
import { pierreIconConfig, pierreTreesStyle } from "./ui/pierreTheme";
import { app } from "./wire";
import { FileBrowseIcon, GitBranchIcon } from "./ui/Icons";

const MobileCodeSheet: Component<{
  terminalId: TerminalId | null;
  meta: TerminalMetadata | null;
  onClose: () => void;
}> = (props) => {
  const { themeTypeLiteral: diffTheme } = useColorScheme();
  const rightPanel = useRightPanel();
  const repoPath = () => props.meta?.git?.repoRoot ?? null;
  // Deliberate divergence from `CodeTab.tsx`: no membership-check effect
  // that nulls the slot when the selected path leaves `treePaths()`.
  // The drawer is short-lived (user closes it after viewing), so the
  // round-trip "file disappeared mid-session" failure mode is moot —
  // and the friendlier UX is to land the user back on the detail view
  // they last had open on reopen, not drop them to the tree.
  const selectedPath = () => rightPanel.selectedFile("browse");

  const allPaths = app.streams.fsListAll.use(
    () => {
      const p = repoPath();
      return p ? { repoPath: p } : null;
    },
    {
      onError: (err) => toast.error(`File list stream: ${err.message}`),
    },
  );

  // Consume-once record for the latest pendingMobileOpen tick. Mirrors
  // `CodeTab.tsx`'s `handled` signal — the request reference
  // discriminates two structurally-identical taps (`openInMobileFiles`
  // mints a fresh object per call), and the resolved path lets
  // `selectedRange` decide whether the current selection is the one
  // this request produced (so a subsequent tree-tap that changes
  // `selectedFile` invalidates the highlight without a second
  // resolution call).
  const [handled, setHandled] = createSignal<{
    request: NavRequest;
    resolvedPath: string | null;
  } | null>(null);

  // Consume `openInMobileFiles` requests once `fsListAll` has settled.
  // Mirrors `CodeTab.tsx`'s `pendingOpen` consumer — terminal output
  // emits absolute paths (`/abs/path`), cwd-relative paths
  // (`error in foo.ts:42` while in a subdir), and basename-only
  // references (`Foo.hs:42` from compiler output that drops the
  // `src/lib/` prefix); `resolveNavPath` normalizes them against
  // the live repo file set. Writing `req.ref.path` raw into the
  // selection slot (the bug this effect fixes) pushes
  // un-resolvable strings at `fsReadFile` and the server returns
  // `path escapes root` or `EISDIR`.
  createEffect(
    on(
      () => {
        const req = pendingMobileOpen();
        const paths = allPaths();
        const isPending = allPaths.pending();
        return { req, paths, isPending };
      },
      ({ req, paths, isPending }) => {
        if (!req) return;
        if (handled()?.request === req) return;
        const repo = repoPath();
        if (repo === null || repo !== req.repoRoot) return;
        if (isPending || !paths) return;
        const rel = resolveNavPath(req, paths.paths);
        if (rel === null) {
          toast.error(`File reference not found: ${req.ref.path}`);
          setHandled({ request: req, resolvedPath: null });
          return;
        }
        rightPanel.setSelectedFile("browse", rel);
        setHandled({ request: req, resolvedPath: rel });
      },
      { defer: true },
    ),
  );

  // Line-range highlight for terminal `path:line` taps — mirrors
  // CodeTab's `selectedRange`. The memo emits a range only when the
  // current `selectedPath` is the file the latest pendingMobileOpen
  // resolved to; any tree-tap that changes the slot naturally
  // invalidates the highlight (resolvedPath !== selectedPath). Refs
  // without a `:N` suffix (`README.md`) open the file with no
  // highlight — the user asked for the file, not a specific line.
  const selectedRange = createMemo<{ start: number; end: number } | null>(
    () => {
      const req = pendingMobileOpen();
      if (!req) return null;
      const h = handled();
      if (!h || h.request !== req || h.resolvedPath === null) return null;
      if (h.resolvedPath !== selectedPath()) return null;
      if (req.ref.startLine === null || req.ref.endLine === null) return null;
      return { start: req.ref.startLine, end: req.ref.endLine };
    },
  );

  return (
    <div
      data-testid="mobile-code-sheet"
      class="flex flex-col h-full bg-surface-1 text-fg"
    >
      {/* Header — back arrow (detail only), title, close (×). The back
       *  button stays mounted with a `hidden` class toggle instead of
       *  `<Show>`; remount cycles racing with the body's overlay
       *  transition occasionally left the button missing from the DOM
       *  for the next reactive tick, which was enough for an immediate
       *  tap to whiff. CSS toggling keeps the element present and the
       *  selector stable. */}
      <div class="flex items-center gap-2 px-3 py-2 border-b border-edge shrink-0 min-h-11">
        <button
          type="button"
          data-testid="mobile-code-back"
          class="h-8 w-8 flex items-center justify-center text-fg-2 rounded-md active:bg-surface-2"
          classList={{ hidden: selectedPath() === null }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => rightPanel.clearSelectedFile("browse")}
          aria-label="Back to file tree"
        >
          ‹
        </button>
        <Show
          when={selectedPath()}
          keyed
          fallback={
            <span class="flex items-center gap-2 flex-1 min-w-0 text-sm font-semibold">
              <FileBrowseIcon class="w-4 h-4 shrink-0" />
              Files
            </span>
          }
        >
          {(path) => (
            <span
              class="flex-1 min-w-0 text-sm font-mono truncate"
              title={path}
            >
              {path}
            </span>
          )}
        </Show>
        <button
          type="button"
          data-testid="mobile-code-close"
          class="h-8 w-8 flex items-center justify-center text-fg-2 rounded-md active:bg-surface-2 shrink-0"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={props.onClose}
          aria-label="Close files"
        >
          ×
        </button>
      </div>

      {/* Body — tree always mounted, detail overlays on top when a file
       *  is selected. Pierre's `FileTree` keeps its subscription warm
       *  across back-and-forth navigation; remounting it on every back
       *  click sometimes left its virtualizer in a stuck state where
       *  rows wouldn't repaint until the next reactive tick. */}
      <div class="flex-1 min-h-0 overflow-hidden relative">
        <Show
          when={repoPath()}
          fallback={
            <div
              class="flex flex-col items-center justify-center h-full text-fg-3/40 gap-2 text-[11px]"
              data-testid="mobile-code-no-repo"
            >
              <GitBranchIcon class="w-8 h-8 opacity-40" />
              Not in a git repository
            </div>
          }
        >
          {(repo) => {
            // Pierre's `<file-tree-container>` keeps its scroll viewport
            // inside a shadow root. iOS Safari's native scroll discovery
            // walks the composed tree for a scrollable ancestor — but in
            // practice (real iPhone, not Playwright emulation), shadow-
            // contained scrollers below a Corvu `Drawer.Content` don't
            // receive the touchmove deltas at all and the tree appears
            // frozen below the visible band.
            //
            // Two compounding causes: (a) Corvu's drag-to-dismiss walks
            // `parentElement`/`_$host` to find scrollables — Pierre uses
            // neither host convention, so Corvu reports zero scroll and
            // claims the touch as a drag; (b) iOS's own native-scroll
            // pathway is unreliable inside a portaled drawer above a
            // shadow-rooted scroller.
            //
            // Drive the scroll ourselves: capture touchstart/move on the
            // wrapper, locate Pierre's shadow-DOM scroller, and set
            // `scrollTop` directly. Stops Corvu via stopPropagation in
            // the same handler. Pierre's own pointerdown handlers (row
            // clicks) live inside the shadow root and fire before the
            // event escapes — they still work because we only act on
            // movements past a small threshold, and a stationary tap
            // never crosses it.
            let scrollState: {
              startY: number;
              startTop: number;
              scroller: HTMLElement;
              moved: boolean;
            } | null = null;
            const findScroller = (
              container: HTMLElement,
            ): HTMLElement | null => {
              const ftc = container.querySelector("file-tree-container");
              const root = (ftc as Element | null)?.shadowRoot;
              if (!root) return null;
              for (const el of root.querySelectorAll<HTMLElement>("*")) {
                if (el.scrollHeight > el.clientHeight + 1) return el;
              }
              return null;
            };
            const onTreeTouchStart = (e: TouchEvent) => {
              e.stopPropagation();
              const touch = e.touches[0];
              if (!touch) return;
              const scroller = findScroller(e.currentTarget as HTMLElement);
              if (!scroller) return;
              scrollState = {
                startY: touch.clientY,
                startTop: scroller.scrollTop,
                scroller,
                moved: false,
              };
            };
            const onTreeTouchMove = (e: TouchEvent) => {
              if (!scrollState) return;
              const touch = e.touches[0];
              if (!touch) return;
              const dy = touch.clientY - scrollState.startY;
              if (!scrollState.moved && Math.abs(dy) < 4) return;
              scrollState.moved = true;
              scrollState.scroller.scrollTop = scrollState.startTop - dy;
              // Once we've committed to scrolling, eat the touchmove so
              // iOS doesn't fight us with its own scroll attempt and so
              // Pierre's row-click logic doesn't fire on touchend.
              e.preventDefault();
              e.stopPropagation();
            };
            const onTreeTouchEnd = () => {
              scrollState = null;
            };
            return (
              <>
                <div
                  class="absolute inset-0"
                  onPointerDown={(e) => e.stopPropagation()}
                  onTouchStart={onTreeTouchStart}
                  onTouchMove={onTreeTouchMove}
                  onTouchEnd={onTreeTouchEnd}
                  onTouchCancel={onTreeTouchEnd}
                >
                  <Switch
                    fallback={
                      <div class="px-2 py-1 text-fg-3/50 text-[11px]">
                        Loading…
                      </div>
                    }
                  >
                    <Match when={allPaths.error()}>
                      {(err) => (
                        <div class="px-2 py-1 text-danger text-[11px]">
                          Error: {err().message}
                        </div>
                      )}
                    </Match>
                    <Match when={allPaths()}>
                      {(paths) => (
                        <FileTree
                          paths={paths().paths}
                          selectedPath={null}
                          onSelect={(p) => {
                            if (p !== null)
                              rightPanel.setSelectedFile("browse", p);
                          }}
                          initialExpansion="closed"
                          search={true}
                          icons={pierreIconConfig}
                          onError={(err) =>
                            toast.error(
                              `File tree render failed: ${err.message}`,
                            )
                          }
                          class="h-full w-full"
                          style={pierreTreesStyle}
                        />
                      )}
                    </Match>
                  </Switch>
                </div>
                <Show when={selectedPath()} keyed>
                  {(path) => {
                    const tid = props.terminalId;
                    if (tid === null) return null;
                    return (
                      <div class="absolute inset-0 bg-surface-1">
                        <BrowseFileDispatcher
                          terminalId={tid}
                          repoPath={repo()}
                          filePath={path}
                          theme={diffTheme()}
                          initialSelectedLines={selectedRange()}
                        />
                      </div>
                    );
                  }}
                </Show>
              </>
            );
          }}
        </Show>
      </div>
    </div>
  );
};

export default MobileCodeSheet;
