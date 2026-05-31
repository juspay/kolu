/**
 * Terminal component — Kolu domain wiring around `@kolu/solid-xterm`'s
 * `createXterm` primitive. The primitive owns every xterm.js mechanic
 * (construction, addons, WebGL lifecycle, scroll-lock, touch, buffer probe,
 * disposal ordering); this component supplies the domain: oRPC streaming, PTY
 * resize/input, themes, zoom, file-ref navigation, keyboard-shortcut routing,
 * sticky modifiers, and image/file upload — plus the visibility/focus policy
 * (when to fit, focus, raise the keyboard).
 *
 * Keyboard zoom is handled by createZoom() (zoom.ts) and consumed here
 * reactively via a fontSize signal.
 */

import {
  createXterm,
  type ITheme,
  type XtermKeyContext,
} from "@kolu/solid-xterm";
import { streamCall } from "@kolu/surface/solid";
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
import { FONT_FAMILY } from "terminal-themes";
import { ACTIONS, matchesAnyShortcut } from "../input/actions";
import { matchesKeybind } from "../input/keyboard";
import { createZoom } from "../input/zoom";
import { refitOnTabVisible } from "../refitOnTabVisible";
import { openInCodeTab } from "../right-panel/openInCodeTab";
import { isExpectedCleanupError } from "../rpc/streamCleanup";
import { writeTextToClipboard } from "../ui/clipboard";
import { isTouch } from "../useMobile";
import { client, preferences } from "../wire";
import { matchFileRefs } from "./fileRefLink";
import ScrollToBottom from "./ScrollToBottom";
import { applyStickyModifiers } from "./stickyModifiers";
import SearchBar from "./SearchBar";
import { useTerminalStore } from "./useTerminalStore";

/** Module-level counters for the #606 disposal audit. Exposed to window via
 *  `debug/consoleHooks.ts`. `mounts` increments once per component body
 *  execution; `cleanups` increments once per `onCleanup` firing. If
 *  `mounts - cleanups > liveComponentCount` after a mode-toggle run, some
 *  Terminal disposals are being skipped — that's the leak path. */
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
  const terminalStore = useTerminalStore();
  const fontSize = createZoom(props.terminalId, () => props.visible);

  /** Selection-driven focus. Desktop raises the keyboard when a tile becomes
   *  active/visible; on touch that's intrusive — the soft keyboard should only
   *  rise from an explicit tap (handled inside the primitive), never as a
   *  side-effect of switching/revealing a tile. So this is a no-op on touch. */
  function focusOnSelection() {
    if (!isTouch()) xterm.focus();
  }

  /** Upload a clipboard image to the PTY (server bracketed-pastes the path). */
  async function uploadPastedImage(file: File) {
    const reason = sizeRejectionFor("clipboard image", file.size);
    if (reason !== null) {
      toast.error(reason);
      return;
    }
    try {
      const base64 = bufferToBase64(await file.arrayBuffer());
      await client.terminal.pasteImage({ id: props.terminalId, data: base64 });
    } catch (err) {
      toast.error(`Failed to upload clipboard image: ${errMsg(err)}`);
    }
  }

  /** Upload a dropped file to the PTY — same shape as image paste, sourced
   *  from DataTransfer instead of ClipboardData. */
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

  /** App keyboard policy, run before xterm sees the key. Return true to let
   *  xterm handle it, false to suppress so a Kolu shortcut can act. */
  function handleKey(e: KeyboardEvent, ctx: XtermKeyContext): boolean {
    // Let Cmd+key pass through to the browser (except copy/paste without Shift).
    if (e.metaKey) {
      const key = e.key.toLowerCase();
      if ((key === "c" || key === "v") && !e.shiftKey) return true;
      return false;
    }
    // Let the browser handle Ctrl+V so it fires a paste event — the primitive's
    // capture-phase paste listener uploads images; xterm covers text.
    if (e.ctrlKey && e.key === "v") return false;
    // Ctrl+Shift+C — Linux/Windows terminal copy chord. Without preventDefault
    // Chromium hijacks it for DevTools' inspect picker; xterm's selection isn't
    // in the textarea either, so copy via getSelection() ourselves.
    if (matchesKeybind(e, ACTIONS.copySelection.keybind)) {
      e.preventDefault();
      const selection = ctx.getSelection();
      if (selection)
        writeTextToClipboard(selection)
          .then(() => toast.success("Copied selection to clipboard"))
          .catch((err: Error) => {
            console.error("Failed to copy selection:", err);
            toast.error(`Failed to copy selection: ${err.message}`);
          });
      return false;
    }
    // Let any registered app shortcut bubble to the capture-phase dispatcher.
    if (matchesAnyShortcut(e)) return false;
    return true;
  }

  const xterm = createXterm({
    id: props.terminalId,
    fontFamily: FONT_FAMILY,
    fontSize,
    theme: () => props.theme,
    scrollback: DEFAULT_SCROLLBACK,
    rendererPolicy: () => preferences().terminalRenderer,
    visible: () => props.visible,
    // Only the focused+visible tile may hold a WebGL context under `auto` —
    // Chrome's ~16-context/tab limit is quickly exhausted in canvas mode where
    // every tile renders simultaneously (#575).
    webglEligible: () => props.visible && props.focused !== false,
    scrollLockEnabled: () => preferences().scrollLock,
    isTouch,
    matchLinks: matchFileRefs,
    onLinkActivate: (ref) => {
      // Read repoRoot at click time (not mount) so a cwd change keeps clicks
      // anchored to the new repo.
      const meta = terminalStore.getMetadata(props.terminalId);
      const repoRoot = meta?.git?.repoRoot ?? null;
      if (!repoRoot) return;
      openInCodeTab({ ref, repoRoot, cwd: meta?.cwd, targetMode: "browse" });
    },
    attach: ({ signal, onReset }) =>
      streamCall(
        client.terminal.attach,
        { id: props.terminalId },
        { signal, onRetry: onReset },
      ),
    sendInput: (data) =>
      void client.terminal.sendInput({
        id: props.terminalId,
        // Fold any sticky Ctrl/Alt armed on the mobile key bar into this
        // keystroke (no-op on desktop, where nothing is ever armed).
        data: applyStickyModifiers(data),
      }),
    resize: (cols, rows) => {
      // Terminal may have been killed mid-resize — swallow.
      void client.terminal
        .resize({ id: props.terminalId, cols, rows })
        .catch(() => {});
    },
    writeClipboard: writeTextToClipboard,
    handleKey,
    onPasteImage: (file) => void uploadPastedImage(file),
    onDropFile: (file) => void uploadDroppedFile(file),
    onFocus: props.onFocus,
    isExpectedStreamError: isExpectedCleanupError,
  });

  // Re-fit and auto-focus when the terminal becomes visible (display:none →
  // visible). defer: true skips the initial run (onMount handles first fit).
  createEffect(
    on(
      () => props.visible,
      (visible) => {
        if (!visible) return;
        xterm.resetScroll();
        xterm.fit();
        if (props.focused !== false) focusOnSelection();
      },
      { defer: true },
    ),
  );

  // Grab focus when the focused prop transitions to true (e.g. sub-panel toggle).
  createEffect(
    on(
      () => props.focused,
      (focused) => {
        if (focused && props.visible) focusOnSelection();
      },
      { defer: true },
    ),
  );

  // Refocus terminal when the search bar closes — only if it should have focus.
  createEffect(
    on(
      () => props.searchOpen,
      (open) => {
        if (!open && props.visible && props.focused !== false)
          focusOnSelection();
      },
      { defer: true },
    ),
  );

  // Cleanup registered SYNCHRONOUSLY at the component body top — NOT inside the
  // async onMount. If the reactive owner disposes during onMount's await (e.g.
  // an <Show> toggle swapping a tile), an onCleanup registered after the await
  // is a silent no-op. The primitive's own `disposed` flag is the bail signal
  // for its async mount body.
  onCleanup(() => {
    lifecycleCounters.cleanups++;
    xterm.dispose();
    // Break the containerRef → __xterm → xterm graph bridge so the terminal is
    // GC-eligible even if SolidJS still retains the DIV (#591/#606).
    const el = containerRef as HTMLDivElement & { __xterm?: unknown };
    if (el) el.__xterm = undefined;
  });

  onMount(() => {
    const owner = getOwner();
    void (async () => {
      try {
        await xterm.mount(containerRef);
        runWithOwner(owner, () => {
          // Kolu-owned e2e bridge: cucumber step defs read `container.__xterm`
          // to drive xterm's public API (buffer reads, cell-to-pixel math).
          // The live Terminal is structurally a KoluXtermProbe (the narrow
          // subset declared in kolu-common/test-hooks).
          const raw = xterm.raw();
          if (raw) {
            (
              containerRef as HTMLDivElement & { __xterm?: KoluXtermProbe }
            ).__xterm = raw as unknown as KoluXtermProbe;
          }
          // FitAddon.fit() only works once the container has real pixel
          // dimensions. Hidden terminals live inside display:none, so they wait
          // at xterm's 80×24 default until they become visible (the visibility
          // effect above fits then).
          if (props.visible) {
            xterm.fit();
            if (props.focused !== false) focusOnSelection();
            xterm.publishDimensions();
          }
          // Re-fit + clear the texture atlas when the browser tab becomes
          // visible again (glyph corruption #239).
          refitOnTabVisible(
            () => xterm.refit(),
            () => props.visible,
          );
        });
      } catch (err) {
        console.error("Terminal onMount failed:", err);
      }
    })();
  });

  return (
    <div class="w-full h-full relative" classList={{ hidden: !props.visible }}>
      <Show when={xterm.searchAddon()}>
        {(addon) => (
          <SearchBar
            searchAddon={addon()}
            open={props.searchOpen}
            onClose={() => props.onSearchOpenChange(false)}
          />
        )}
      </Show>
      <ScrollToBottom
        visible={xterm.isLocked()}
        active={xterm.hasNewOutput()}
        onClick={() => {
          xterm.scrollToBottom();
          xterm.focus();
        }}
      />
      <div
        ref={containerRef}
        // touch-manipulation: eliminate 300ms tap delay and prevent double-tap-to-zoom on mobile.
        // data-[drop-target]: inset ring while a file drag is hovering — set/cleared by the
        // primitive's dragover/drop/dragleave listeners.
        class="w-full h-full overflow-hidden touch-manipulation data-[drop-target]:outline data-[drop-target]:outline-2 data-[drop-target]:-outline-offset-2 data-[drop-target]:outline-sky-400/70"
        data-terminal-id={props.terminalId}
        data-visible={props.visible ? "" : undefined}
        data-focused={props.focused !== false ? "" : undefined}
        data-sub-terminal={props.isSub ? "" : undefined}
        data-font-size={fontSize()}
        data-renderer={xterm.hasWebgl() ? "webgl" : "dom"}
      />
    </div>
  );
};

export default Terminal;
