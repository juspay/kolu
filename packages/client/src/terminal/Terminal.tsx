/**
 * Terminal component — wires `@kolu/solid-xterm`'s `createSolidXterm`
 * primitive into Kolu's PTY stream, file-ref linkifier, e2e bridge,
 * diagnostics registry, and clipboard/drag-drop upload handlers.
 *
 * Everything xterm-internal (XTerm construction, addon attachment,
 * WebGL lifecycle, reactive theme + fontSize sync, scroll-lock state
 * machine) lives behind the `xterm` handle. This file only owns the
 * Kolu-specific integrations: link provider that reads `terminalStore`
 * metadata, custom key handler for Cmd+key passthrough + selection
 * copy, e2e `container.__xterm` bridge, registerTerminalRefs +
 * registerDiagnostics calls, PTY stream attach + retry, paste/drag-drop
 * uploads.
 *
 * Keyboard zoom is handled by createZoom() (zoom.ts) and consumed here
 * reactively via a fontSize signal.
 */

import { writeTextToClipboard } from "@kolu/browser-clipboard";
import { SafeClipboardProvider } from "@kolu/browser-clipboard/xterm";
import { createSolidXterm } from "@kolu/solid-xterm";
import { streamCall } from "@kolu/surface/solid";
import { FONT_FAMILY } from "@kolu/terminal-themes";
import { makeEventListener } from "@solid-primitives/event-listener";
import { createResizeObserver } from "@solid-primitives/resize-observer";
import type { Terminal as XTerm } from "@xterm/xterm";
import { DEFAULT_SCROLLBACK } from "kolu-common/config";
import type { TerminalId } from "kolu-common/surface";
import { rejectionFor, sizeRejectionFor } from "kolu-common/upload";
import {
  type Component,
  createEffect,
  getOwner,
  on,
  onCleanup,
  onMount,
  runWithOwner,
  Show,
} from "solid-js";
import { toast } from "solid-sonner";
import { match } from "ts-pattern";
import "@xterm/xterm/css/xterm.css";
import type { ITheme } from "@xterm/xterm";
import { ACTIONS, matchesAnyShortcut } from "../input/actions";
import { matchesKeybind } from "../input/keyboard";
import { createZoom } from "../input/zoom";
import { refitOnTabVisible } from "../refitOnTabVisible";
import { openInCodeTab } from "../right-panel/openInCodeTab";
import { isExpectedCleanupError } from "../rpc/streamCleanup";
import { isTouch } from "../useMobile";
import { client, preferences } from "../wire";
import { createFileRefLinkProvider } from "./fileRefLinkProvider";
import { setupMobileTapToFocus, setupMobileTouchScroll } from "./mobileTouch";
import ScrollToBottom from "./ScrollToBottom";
import SearchBar from "./SearchBar";
import { registerTerminalRefs, unregisterTerminalRefs } from "./terminalRefs";
import { registerDiagnostics } from "./useTerminalDiagnostics";
import { useTerminalStore } from "./useTerminalStore";
import {
  trackCreate,
  trackDispose,
  trackLoseContextCalled,
} from "./webglTracker";

/** Sum `byteLength` of every BufferLine's `Uint32Array` in xterm's primary
 *  and alternate buffers. Reaches through private `_core._bufferService`,
 *  so every access is null-guarded — if xterm renames these fields in a
 *  future version, the probe reports `null` and the UI labels it "unknown"
 *  instead of crashing. Uses `length` + `get(i)` rather than iterating the
 *  private list array, because `CircularList.length` is the public view
 *  into a ring buffer with an arbitrary internal start offset. */
function readBufferBytes(
  term: XTerm,
): { primary: number; alternate: number } | null {
  const bufSvc = (
    term as unknown as {
      _core?: {
        _bufferService?: {
          buffers?: {
            normal?: {
              lines?: {
                length: number;
                get(i: number): { _data?: Uint32Array } | undefined;
              };
            };
            alt?: {
              lines?: {
                length: number;
                get(i: number): { _data?: Uint32Array } | undefined;
              };
            };
          };
        };
      };
    }
  )._core?._bufferService;
  if (!bufSvc?.buffers) return null;

  function sum(lines: {
    length: number;
    get(i: number): { _data?: Uint32Array } | undefined;
  }) {
    let total = 0;
    for (let i = 0; i < lines.length; i++) {
      const data = lines.get(i)?._data;
      if (data) total += data.byteLength;
    }
    return total;
  }

  const primary = bufSvc.buffers.normal?.lines;
  const alternate = bufSvc.buffers.alt?.lines;
  if (!primary || !alternate) return null;
  return { primary: sum(primary), alternate: sum(alternate) };
}

/** Fire-and-forget an async iterable, silently swallowing AbortErrors (expected on unmount). */
function consumeStream<T>(
  streamFn: () => Promise<AsyncIterable<T>>,
  onItem: (item: T) => void,
  label: string,
) {
  void (async () => {
    try {
      for await (const item of await streamFn()) onItem(item);
    } catch (err) {
      if (!isExpectedCleanupError(err)) {
        console.error(`${label} error:`, err);
      }
    }
  })();
}

/** Module-level counters for the #606 disposal audit. Exposed to window
 *  via `debug/consoleHooks.ts`. `mounts` increments once per component
 *  body execution; `cleanups` increments once per `onCleanup` firing.
 *  If `mounts - cleanups > liveComponentCount` after a mode-toggle run,
 *  some Terminal disposals are being skipped — that's the leak path. */
export const lifecycleCounters = { mounts: 0, cleanups: 0 };

/** ArrayBuffer → base64 without stack overflow (spread on large arrays blows the stack). */
function bufferToBase64(buf: ArrayBuffer): string {
  return btoa(
    Array.from(new Uint8Array(buf), (b) => String.fromCharCode(b)).join(""),
  );
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const Terminal: Component<{
  terminalId: TerminalId;
  visible: boolean;
  /** When true, this terminal should grab keyboard focus. */
  focused?: boolean;
  theme: ITheme;
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
  /** Fired when the user interacts with this terminal (click/keyboard focus). */
  onFocus?: () => void;
  /** When true, this terminal lives in a sub-panel — it owns its own grid
   *  (its container is independent of the main viewport) and stays out of
   *  the viewport signal. Also used for e2e test selectors. */
  isSub?: boolean;
}> = (props) => {
  lifecycleCounters.mounts++;
  let containerRef!: HTMLDivElement;
  let linkProviderDisposable: { dispose(): void } | null = null;
  let webglTrackerId: number | null = null;
  let streamAbort: AbortController | null = null;
  let disposeDiagnostics: (() => void) | null = null;
  /** True once this component's reactive owner has been disposed. Set by the
   *  synchronously-registered `onCleanup` below. The async `onMount` body
   *  checks this after each `await` and bails rather than creating xterm /
   *  WebGL state that no cleanup path can reach — the root of the #591
   *  orphan-canvas leak (SolidJS `onCleanup` registered inside a disposed
   *  owner is a silent no-op, so onCleanup inside the async body would not
   *  run when an `<Show>` toggle disposes the owner during a mode switch). */
  let disposed = false;

  const terminalStore = useTerminalStore();
  const fontSize = createZoom(props.terminalId, () => props.visible);

  /** Capability: only the focused+visible tile is allowed to hold a WebGL
   *  context — Chrome's per-tab limit (~16) is quickly exhausted in canvas
   *  mode where every tile renders simultaneously (issue #575). Non-focused
   *  tiles fall back to xterm's built-in DOM renderer via `WebglAddon.dispose()`. */
  const canUseWebgl = () => props.visible && props.focused !== false;
  /** Dispatch on user renderer policy:
   *  - `auto`: honor the capability gate (WebGL on focused+visible only).
   *  - `webgl`: WebGL on every tile (opt-in; reintroduces #575 risk at scale).
   *  - `dom`: force DOM everywhere (stable font on focus swap, lower GPU). */
  const shouldUseWebgl = () =>
    match(preferences().terminalRenderer)
      .with("auto", canUseWebgl)
      .with("webgl", () => true)
      .with("dom", () => false)
      .exhaustive();

  /** Resize the server-side PTY so node-pty matches the xterm grid. */
  async function publishDimensions() {
    const term = xterm.term();
    if (!term) return;
    const { cols, rows } = term;
    if (cols <= 0 || rows <= 0) return;
    try {
      await client.terminal.resize({ id: props.terminalId, cols, rows });
    } catch {
      // Terminal may have been killed mid-resize
    }
  }

  // ── @kolu/solid-xterm primitive ─────────────────────────────────────
  // Owns construction, addon set, WebGL lifecycle policy, reactive
  // theme + fontSize sync, scroll-lock state machine. The `onTerm`
  // callback wires Kolu-specific integrations once the XTerm + addons
  // are live in the DOM.
  const xterm = createSolidXterm({
    fontFamily: FONT_FAMILY,
    theme: () => props.theme,
    fontSize,
    scrollback: DEFAULT_SCROLLBACK,
    cursorBlink: true,
    // Keep a solid block cursor even when xterm thinks we're unfocused.
    // The default 'outline' is a hollow box that is effectively invisible
    // at phone DPI, and xterm's WebGL renderer flips to the inactive style
    // whenever `document.hasFocus()` is false — unreliable on iOS Safari
    // with the soft keyboard up (CoreBrowserService.ts:55).
    cursorInactiveStyle: "block",
    // Required by SerializeAddon and ImageAddon for buffer access
    allowProposedApi: true,
    addons: {
      clipboard: { provider: new SafeClipboardProvider() },
    },
    webgl: {
      enabled: shouldUseWebgl,
      onCreate: (canvas) => {
        webglTrackerId = trackCreate(props.terminalId, canvas);
      },
      onLoseContextCalled: () => {
        if (webglTrackerId !== null) trackLoseContextCalled(webglTrackerId);
      },
      onDispose: () => {
        if (webglTrackerId !== null) {
          trackDispose(webglTrackerId);
          webglTrackerId = null;
        }
      },
    },
    scrollLock: () => preferences().scrollLock,
    onTerm: (term) => {
      // Linkify `path:line[:col][-end]` references in terminal output.
      // The link provider reads repoRoot from the terminal store at
      // click time (not at mount) so a cwd change keeps subsequent
      // clicks anchored to the new repo.
      linkProviderDisposable = term.registerLinkProvider(
        createFileRefLinkProvider(term, {
          onActivate: (ref) => {
            const meta = terminalStore.getMetadata(props.terminalId);
            const repoRoot = meta?.git?.repoRoot ?? null;
            if (!repoRoot) return;
            openInCodeTab({
              ref,
              repoRoot,
              cwd: meta?.cwd,
              targetMode: "browse",
            });
          },
        }),
      );

      // Click-to-focus on the host div: xterm's own click handler covers
      // the inner canvas, but clicks on the wrapper padding need to focus
      // too. Attach via addEventListener (not JSX onClick) so the host
      // div stays free of interactive props that would force a11y roles
      // — the actual interactive surface is the xterm canvas inside.
      containerRef.addEventListener("click", () => term.focus());

      // Mobile: route soft-keyboard input through `.xterm-screen` itself,
      // the way hterm does (libapps/hterm/js/hterm_scrollport.js:617-655).
      //
      // xterm's own hidden helper textarea already has spellcheck/autocorrect
      // disabled by the library (CoreBrowserTerminal.ts:448-450), but iOS
      // Safari still runs spell-check against the accumulated `textarea.value`
      // that `_syncTextArea()` parks at the cursor cell — hence the phantom
      // underlines. Making the screen element contenteditable gives mobile a
      // real focus target and lets us opt the whole input surface out of
      // correction features. `caret-color: transparent` keeps the native
      // contenteditable caret from fighting xterm's rendered cursor.
      //
      // Desktop is left alone — xterm's unmodified mousedown → textarea.focus
      // path works fine with a hardware keyboard and we don't want to risk
      // fighting its selection handling.
      if (isTouch()) setupMobileTapToFocus(term);

      // Kolu-owned bridge consumed by e2e step definitions —
      // `support/buffer.ts`, `step_definitions/file_ref_link_steps.ts`,
      // and friends read `container.__xterm` to drive xterm's
      // public API (buffer reads, cell-to-pixel math). Removing
      // this assignment silently breaks every cucumber test that
      // touches terminal contents.
      (containerRef as HTMLDivElement & { __xterm?: XTerm }).__xterm = term;

      // Production path for handlers that need live xterm/addon refs
      // (e.g. export-as-PDF reads serializeAddon).
      const serializeAddon = xterm.addons.serialize();
      if (serializeAddon) {
        registerTerminalRefs(props.terminalId, {
          xterm: term,
          serialize: serializeAddon,
          probes: {
            webglAtlas: () => xterm.webgl.atlas(),
            bufferBytes: () => readBufferBytes(term),
          },
        });
      }
      // Diagnostics subscribes to webgl.enabled via accessor — keeps it
      // the single source of truth, no imperative updater to forget.
      disposeDiagnostics = registerDiagnostics(props.terminalId, {
        xterm: term,
        renderer: () => (xterm.webgl.enabled() ? "webgl" : "dom"),
      });

      // xterm.js has attachCustomKeyEventHandler for intercepting keys.
      // Return false to prevent xterm from handling the key.
      term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
        // Let Cmd+key pass through to browser (except copy/paste without Shift)
        if (e.metaKey) {
          const key = e.key.toLowerCase();
          if ((key === "c" || key === "v") && !e.shiftKey) return true;
          return false;
        }

        // Let browser handle Ctrl+V so it fires a paste event. Our capture-phase
        // paste listener uploads images; xterm's own paste handler covers text.
        if (e.ctrlKey && e.key === "v") return false;

        // Ctrl+Shift+C — Linux/Windows terminal copy chord. Without
        // preventDefault, Chromium hijacks the chord to open DevTools'
        // Inspect Element picker. xterm's selection isn't reflected in
        // the textarea either, so we copy via getSelection() ourselves.
        // Must come before the matchesAnyShortcut check below, since
        // copySelection is registered there for ShortcutsHelp visibility
        // but dispatched here.
        if (matchesKeybind(e, ACTIONS.copySelection.keybind)) {
          e.preventDefault();
          const selection = term.getSelection();
          if (selection)
            writeTextToClipboard(selection)
              .then(() => toast.success("Copied selection to clipboard"))
              .catch((err: Error) => {
                console.error("Failed to copy selection:", err);
                toast.error(`Failed to copy selection: ${err.message}`);
              });
          return false;
        }

        // Let any registered app shortcut bubble through to the capture-phase dispatcher
        if (matchesAnyShortcut(e)) return false;

        return true;
      });

      // Attach the resize listener before any initial sizing so the very
      // first fit()/resize() publishes and pings the PTY through the same
      // code path as every subsequent resize.
      term.onResize(() => void publishDimensions());

      // FitAddon.fit() only works when the container has real pixel
      // dimensions. Hidden terminals live inside a display:none ancestor
      // (see `hidden` classList on the wrapper below), so we can't measure
      // them — they wait at xterm's 80×24 default until they become visible,
      // at which point the visibility effect below calls xterm.fit().
      if (props.visible) {
        xterm.addons.fit()?.fit();
        if (props.focused !== false) term.focus();
      }

      // Track user-initiated focus for "remember last focused" in sub-panel
      if (props.onFocus && term.textarea) {
        makeEventListener(term.textarea, "focus", props.onFocus);
      }

      streamAbort = new AbortController();
      const signal = streamAbort.signal;

      // Attach stream: yields scrollback first, then live PTY output.
      // onRetry resets xterm before the retried iterator's first yield
      // (a fresh screenState snapshot) — otherwise it double-paints.
      consumeStream(
        () =>
          streamCall(
            client.terminal.attach,
            { id: props.terminalId },
            {
              signal,
              onRetry: () => {
                term.reset();
                xterm.scrollLock.reset();
              },
            },
          ),
        (data) => xterm.write(data),
        "Terminal attach",
      );

      // fit() above only fires onResize when the grid actually changes.
      // If xterm's default 80×24 already matched the fit target, the listener
      // didn't run — publish manually so the PTY matches. Hidden terminals
      // stay at 80×24 until they become visible; the visibility effect below
      // runs xterm.fit() and publishes then.
      if (props.visible) void publishDimensions();

      // Filter terminal query responses from onData before sending to PTY.
      // The server's headless xterm already answers these; duplicates arriving
      // late over the network get printed as visible garbage.
      const csiResponse = /\x1b\[[?>=]?[\d;]*[cnRy]/; // DA1/DA2/DSR/CPR/DECRPM
      term.onData((data: string) => {
        if (csiResponse.test(data) || data.startsWith("\x1b]")) return;
        void client.terminal.sendInput({ id: props.terminalId, data });
      });

      createResizeObserver(
        () => containerRef,
        () => {
          // Skip fitting when hidden — display:none triggers a 0x0 resize that would
          // cause a server-side PTY resize, producing shell output and false activity.
          if (props.visible) xterm.fit();
        },
      );

      refitOnTabVisible(
        () => {
          xterm.fit();
          xterm.webgl.clearTextureAtlas();
        },
        () => props.visible,
      );
      // Prevent browser context menu so right-click reaches the terminal (mouse tracking)
      makeEventListener(containerRef, "contextmenu", (e: Event) =>
        e.preventDefault(),
      );

      setupMobileTouchScroll(containerRef, () => xterm.term());

      // Bridge browser clipboard images → PTY. Capture phase fires before
      // xterm's own paste handler on the textarea, letting us intercept
      // images while text paste falls through to xterm. Uses the native
      // paste event (not navigator.clipboard.read) so no explicit
      // clipboard-read permission is needed.
      async function uploadPastedImage(file: File) {
        const reason = sizeRejectionFor("clipboard image", file.size);
        if (reason !== null) {
          toast.error(reason);
          return;
        }
        try {
          const base64 = bufferToBase64(await file.arrayBuffer());
          await client.terminal.pasteImage({
            id: props.terminalId,
            data: base64,
          });
        } catch (err) {
          toast.error(`Failed to upload clipboard image: ${errMsg(err)}`);
        }
      }

      makeEventListener(
        containerRef,
        "paste",
        (e: ClipboardEvent) => {
          const items = e.clipboardData?.items;
          if (!items) return;

          const imageItem = Array.from(items).find((i) =>
            i.type.startsWith("image/"),
          );
          const file = imageItem?.getAsFile();
          if (!file) return; // No image — let xterm handle text paste

          // Must stop propagation synchronously before the async upload,
          // otherwise xterm's paste handler would paste the image as garbled text.
          e.stopPropagation();
          e.preventDefault();
          void uploadPastedImage(file);
        },
        { capture: true },
      );

      // Drag-and-drop file upload. Files dropped on the terminal are
      // uploaded to the server, which saves them under the terminal's
      // clipboard directory and bracketed-pastes the path into the PTY
      // — the same shape as Ctrl+V image paste, just sourced from
      // DataTransfer instead of ClipboardData.
      async function uploadDroppedFile(file: File) {
        const reason = rejectionFor(file.name, file.size);
        if (reason !== null) {
          toast.error(reason);
          return;
        }
        try {
          const base64 = bufferToBase64(await file.arrayBuffer());
          await client.terminal.uploadFile({
            id: props.terminalId,
            name: file.name,
            data: base64,
          });
        } catch (err) {
          toast.error(`Failed to upload "${file.name}": ${errMsg(err)}`);
        }
      }

      makeEventListener(containerRef, "dragover", (e: DragEvent) => {
        if (!e.dataTransfer?.types.includes("Files")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        containerRef.dataset.dropTarget = "";
      });
      makeEventListener(containerRef, "dragleave", (e: DragEvent) => {
        const next = e.relatedTarget as Node | null;
        if (next && containerRef.contains(next)) return;
        delete containerRef.dataset.dropTarget;
      });
      makeEventListener(containerRef, "drop", (e: DragEvent) => {
        const files = e.dataTransfer?.files;
        if (!files || files.length === 0) return;
        e.preventDefault();
        delete containerRef.dataset.dropTarget;
        for (const file of files) {
          void uploadDroppedFile(file);
        }
      });
    },
  });

  // Re-fit and auto-focus when terminal becomes visible (display:none → visible).
  // Only auto-focus if this terminal should have focus (focused prop is true or unset).
  // defer: true skips the initial run (mount handles first fit + focus).
  createEffect(
    on(
      () => props.visible,
      (visible) => {
        const term = xterm.term();
        if (!visible || !term) return;
        xterm.scrollLock.reset();
        term.scrollToBottom();
        xterm.fit();
        if (props.focused !== false) term.focus();
      },
      { defer: true },
    ),
  );

  // Grab focus when the focused prop transitions to true (e.g. sub-panel toggle).
  createEffect(
    on(
      () => props.focused,
      (focused) => {
        const term = xterm.term();
        if (focused && props.visible && term) term.focus();
      },
      { defer: true },
    ),
  );

  // Refocus terminal when search bar closes — only if this terminal should have focus.
  createEffect(
    on(
      () => props.searchOpen,
      (open) => {
        const term = xterm.term();
        if (!open && props.visible && props.focused !== false && term)
          term.focus();
      },
      { defer: true },
    ),
  );

  // Cleanup registered SYNCHRONOUSLY at component body top — NOT inside the
  // async `onMount` below. If the reactive owner disposes during `onMount`'s
  // `await document.fonts.load(...)` (e.g. an `<Show>` toggle swapping a tile
  // in or out), any `onCleanup` registered after the await is a silent no-op
  // — the owner's cleanup list was already iterated at disposal.
  // The `disposed` flag is the bail signal for the async body below. Without
  // this, each mode-toggle race leaks a Terminal component instance
  // (orphan xterm + WebGL canvas + scrollback buffer) — the residual #591
  // leak after PRs #578/#596.
  onCleanup(() => {
    lifecycleCounters.cleanups++;
    disposed = true;
    streamAbort?.abort();
    unregisterTerminalRefs(props.terminalId);
    disposeDiagnostics?.();
    disposeDiagnostics = null;
    linkProviderDisposable?.dispose();
    linkProviderDisposable = null;
    // `createSolidXterm` registers its own `onCleanup` for XTerm dispose +
    // WebGL teardown + addon ref clearing. Nothing to do here for those.
    // Break the containerRef → __xterm → xterm Terminal bridge. The
    // containerRef DIV may be retained by SolidJS closures (verified via
    // heap-snapshot retainer walk: `context containerRef` and `context _el$2`
    // across disposed Terminal instances). As long as the DIV is alive and
    // carries `__xterm`, the entire xterm graph (InputHandler, CoreBrowserTerminal,
    // BufferLines, ~900 KB per instance) stays reachable. Clearing the property
    // makes xterm GC-eligible even if the DIV can't be collected yet.
    const el = containerRef as
      | (HTMLDivElement & { __xterm?: XTerm })
      | undefined;
    if (el) el.__xterm = undefined;
  });

  onMount(() => {
    // Capture the component's reactive owner BEFORE the await. SolidJS's
    // global `Owner` is lost across any `await` boundary, so every primitive
    // called after the await (`createResizeObserver`, `makeEventListener`,
    // `createEffect`, and any `onCleanup` inside `@solid-primitives/*` or
    // inside `createSolidXterm`'s `mount`) would register its cleanup on a
    // null owner — a silent no-op. `runWithOwner` re-enters the captured
    // owner for the post-await body so library-internal `onCleanup` calls
    // land on the right cleanup list.
    const owner = getOwner();
    void (async () => {
      try {
        // Wait for the terminal font to load before measuring cell dimensions.
        // Without this, the first terminal may mount before the font is available,
        // causing xterm to measure with the fallback monospace font — wrong metrics.
        await document.fonts.load(`1em ${FONT_FAMILY}`);
        if (disposed) return;
        runWithOwner(owner, () => {
          xterm.mount(containerRef);
        });
      } catch (err) {
        console.error("Terminal onMount failed:", err);
      }
    })();
  });

  return (
    <div class="w-full h-full relative" classList={{ hidden: !props.visible }}>
      <Show when={xterm.addons.search()}>
        {(addon) => (
          <SearchBar
            searchAddon={addon()}
            open={props.searchOpen}
            onClose={() => props.onSearchOpenChange(false)}
          />
        )}
      </Show>
      <ScrollToBottom
        visible={xterm.scrollLock.locked()}
        active={xterm.scrollLock.hasNewOutput()}
        onClick={() => {
          xterm.scrollLock.toBottom();
          xterm.term()?.focus();
        }}
      />
      <div
        ref={containerRef}
        // touch-manipulation: eliminate 300ms tap delay and prevent double-tap-to-zoom on mobile.
        // data-[drop-target]: inset ring while a file drag is hovering — set/cleared by the
        // dragover/drop/dragleave listeners in onMount.
        class="w-full h-full overflow-hidden touch-manipulation data-[drop-target]:outline data-[drop-target]:outline-2 data-[drop-target]:-outline-offset-2 data-[drop-target]:outline-sky-400/70"
        data-terminal-id={props.terminalId}
        data-visible={props.visible ? "" : undefined}
        data-focused={props.focused !== false ? "" : undefined}
        data-sub-terminal={props.isSub ? "" : undefined}
        data-font-size={fontSize()}
        data-renderer={xterm.webgl.enabled() ? "webgl" : "dom"}
      />
    </div>
  );
};

export default Terminal;
