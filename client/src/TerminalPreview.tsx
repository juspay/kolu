/**
 * TerminalPreview — read-only miniature xterm.js instance for sidebar previews.
 *
 * Renders at the exact same cols×rows as the main terminal and at the same
 * font size. Identical dimensions mean the server's stream (cursor escapes,
 * line wraps, clears) interprets the same way in the preview as in the main
 * terminal — the preview is a true cell-for-cell mirror.
 *
 * We don't scale the canvas down to fit the host. Instead, the host is a
 * short `overflow-hidden` strip and the inner xterm is pinned to the
 * bottom-left, so only the last few rows (and leftmost ~24 columns) show
 * through. That keeps the visible text readable at native font size —
 * scaling the full 80×24 canvas to fit a 200×48 strip made text unreadable
 * and wasted space on letterboxing.
 *
 * No FitAddon: fitting would re-compute cols/rows from the container size
 * and diverge from the main. We size explicitly via term.resize().
 */

import { type Component, onMount, onCleanup, createEffect, on } from "solid-js";
import { Terminal as XTerm, type ITheme } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { FONT_FAMILY } from "./theme";
import { client } from "./rpc";
import type { TerminalId } from "kolu-common";

/** Font size for the preview xterm. Matches the main-terminal default so
 *  the bottom-left crop looks identical to the corresponding region of the
 *  full terminal — no scaling, no blur. */
const PREVIEW_FONT_SIZE = 14;

const TerminalPreview: Component<{
  terminalId: TerminalId;
  theme: ITheme;
  cols: number;
  rows: number;
}> = (props) => {
  /** Inner: the xterm canvas at natural size, absolute-positioned at the
   *  bottom-left of the host so the host's overflow clip reveals just the
   *  last few rows and leftmost columns. */
  let innerRef!: HTMLDivElement;
  let terminal: XTerm | null = null;
  let streamAbort: AbortController | null = null;

  createEffect(
    on(
      () => props.theme,
      (theme) => {
        if (terminal) terminal.options.theme = theme;
      },
      { defer: true },
    ),
  );

  // Keep the xterm in sync with the main terminal's dimensions so the
  // server's stream stays consistent. No scale recompute needed — the host
  // just reveals a fixed bottom-left window onto whatever size the canvas
  // happens to be.
  createEffect(
    on(
      () => [props.cols, props.rows] as const,
      ([cols, rows]) => {
        if (!terminal) return;
        terminal.resize(cols, rows);
      },
      { defer: true },
    ),
  );

  onMount(async () => {
    await document.fonts.load(`1em ${FONT_FAMILY}`);

    const term = new XTerm({
      fontFamily: FONT_FAMILY,
      theme: props.theme,
      fontSize: PREVIEW_FONT_SIZE,
      cols: props.cols,
      rows: props.rows,
      cursorBlink: false,
      cursorInactiveStyle: "none",
      disableStdin: true,
      // No scrollback = no scrollbar. Preview is read-only, scrolling not needed.
      scrollback: 0,
      allowProposedApi: true,
    });
    terminal = term;
    term.open(innerRef);

    streamAbort = new AbortController();
    const signal = streamAbort.signal;

    // Stream screen state + live data
    void (async () => {
      try {
        const stream = await client.terminal.attach(
          { id: props.terminalId },
          { signal },
        );
        for await (const data of stream) {
          terminal?.write(data);
        }
      } catch {
        // Stream aborted — expected on cleanup
      }
    })();

    onCleanup(() => {
      streamAbort?.abort();
      terminal?.dispose();
    });
  });

  return (
    <div
      class="relative w-full h-full overflow-hidden"
      // Paint the host with the terminal theme bg so any gap between the
      // pinned xterm and the host edges reads as terminal padding rather
      // than a generic-surface gap.
      //
      // pointer-events: none — preview is purely visual (disableStdin: true,
      // scrollback: 0). Without this, xterm's wheel listener captures trackpad
      // scroll when the cursor is over the preview, blocking the sidebar from
      // scrolling. Disabling pointer events also lets clicks fall through to
      // the parent SidebarEntry button, so clicking the preview selects the
      // terminal.
      style={{
        "background-color": props.theme.background,
        "pointer-events": "none",
      }}
      data-testid="terminal-preview"
      data-terminal-id={props.terminalId}
    >
      {/* Pin the xterm to the bottom-left corner. The canvas is rendered at
       *  its natural 80×24 size and overflows both right (wider than the
       *  strip) and top (taller than the strip); the host's overflow-hidden
       *  crops it to a bottom-left window showing the tail of recent output. */}
      <div ref={innerRef} class="absolute bottom-0 left-0" />
    </div>
  );
};

export default TerminalPreview;
