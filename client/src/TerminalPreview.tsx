/**
 * TerminalPreview — read-only miniature xterm.js instance for sidebar previews.
 *
 * Renders at the exact same cols×rows as the main terminal, then CSS-scales
 * the canvas down to fit the host container. Identical dimensions mean the
 * server's stream (cursor escapes, line wraps, clears) interprets the same
 * way in the preview as in the main terminal — the preview is a true
 * zoomed-out view of the same cell grid.
 *
 * No FitAddon: fitting would re-compute cols/rows from the container size
 * and diverge from the main. We size explicitly via term.resize().
 */

import { type Component, onMount, onCleanup, createEffect, on } from "solid-js";
import { createResizeObserver } from "@solid-primitives/resize-observer";
import { Terminal as XTerm, type ITheme } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { FONT_FAMILY } from "./theme";
import { client } from "./rpc";
import type { TerminalId } from "kolu-common";

/** Font size for the internal xterm instance. Large enough to render crisp
 *  on canvas; the whole element is CSS-scaled down to fit the host. */
const PREVIEW_FONT_SIZE = 14;

const TerminalPreview: Component<{
  terminalId: TerminalId;
  theme: ITheme;
  cols: number;
  rows: number;
}> = (props) => {
  /** Host: the sidebar card slot; variable size. */
  let hostRef!: HTMLDivElement;
  /** Inner: the xterm canvas at natural (cols × charWidth × rows × lineHeight) size. */
  let innerRef!: HTMLDivElement;
  let terminal: XTerm | null = null;
  let streamAbort: AbortController | null = null;

  /** Recompute the CSS scale so the inner natural size fits the host. */
  function applyScale() {
    if (!innerRef || !hostRef || !terminal) return;
    // Clear previous transform to measure natural size.
    innerRef.style.transform = "";
    const naturalW = innerRef.offsetWidth;
    const naturalH = innerRef.offsetHeight;
    if (naturalW === 0 || naturalH === 0) return;
    const hostW = hostRef.clientWidth;
    const hostH = hostRef.clientHeight;
    // Uniform scale — preserves aspect ratio. Whichever axis is tighter wins.
    const scale = Math.min(hostW / naturalW, hostH / naturalH);
    innerRef.style.transform = `scale(${scale})`;
  }

  createEffect(
    on(
      () => props.theme,
      (theme) => {
        if (terminal) terminal.options.theme = theme;
      },
      { defer: true },
    ),
  );

  // Resize xterm when the main terminal's dimensions change.
  createEffect(
    on(
      () => [props.cols, props.rows] as const,
      ([cols, rows]) => {
        if (!terminal) return;
        terminal.resize(cols, rows);
        requestAnimationFrame(applyScale);
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
    // xterm measures cell dimensions on its first animation frame — offsetWidth
    // is 0 on the same tick as term.open(), so defer the first scale.
    requestAnimationFrame(applyScale);

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

    // Recompute scale whenever the host card changes size (sidebar resize,
    // viewport breakpoint change, etc.)
    createResizeObserver(
      () => hostRef,
      () => applyScale(),
    );

    onCleanup(() => {
      streamAbort?.abort();
      terminal?.dispose();
    });
  });

  return (
    <div
      ref={hostRef}
      class="w-full h-full overflow-hidden"
      // The scaled xterm canvas almost never fills the host slot exactly:
      // main terminal aspect ratio (cols × charW : rows × lineH) won't match
      // the sidebar card's, and the mismatch shifts as the user opens/closes
      // sub-panels (which resize main → changes cols/rows → changes the
      // preview's natural ratio). Painting the host with the terminal theme
      // background makes the unused bands read as terminal padding rather
      // than a generic-surface gap that flashes on every layout change.
      // pointer-events: none — preview is purely visual (disableStdin: true,
      // scrollback: 0). Without this, xterm's wheel listener captures trackpad
      // scroll when the cursor is over the preview, blocking the sidebar from
      // scrolling. Disabling pointer events also lets clicks fall through to
      // the parent SidebarEntry button, so clicking the preview now selects
      // the terminal (previously xterm swallowed those clicks too).
      style={{
        "background-color": props.theme.background,
        "pointer-events": "none",
      }}
      data-testid="terminal-preview"
      data-terminal-id={props.terminalId}
    >
      <div
        ref={innerRef}
        style={{
          "transform-origin": "top left",
          // Inline-block so offsetWidth/Height reflect the xterm canvas size,
          // not the parent host's width. We measure natural size before scaling.
          display: "inline-block",
        }}
      />
    </div>
  );
};

export default TerminalPreview;
