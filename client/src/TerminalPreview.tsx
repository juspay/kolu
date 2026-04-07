/**
 * TerminalPreview — read-only miniature xterm.js instance for sidebar previews.
 *
 * Streams live terminal output. Instead of rendering at a tiny font (which is
 * blurry and gives different cols×rows than the main terminal — meaning the
 * same stream wraps/clips differently), it renders xterm at a normal readable
 * font on a larger virtual canvas, then CSS-scales the whole thing down to
 * fit the host container. This preserves the column count closer to the main
 * terminal and keeps text crisp, at the cost of a bit of CSS indirection.
 */

import { type Component, onMount, onCleanup, createEffect, on } from "solid-js";
import { createResizeObserver } from "@solid-primitives/resize-observer";
import { refitOnTabVisible } from "./refitOnTabVisible";
import { Terminal as XTerm, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { FONT_FAMILY } from "./theme";
import { client } from "./rpc";
import type { TerminalId } from "kolu-common";

/** Font size for the internal xterm instance (crisp). */
const PREVIEW_FONT_SIZE = 12;
/** How much to shrink the internal canvas to fit the host container.
 *  0.4 means the virtual canvas is 1/0.4 = 2.5× the host size — the inner
 *  xterm gets ~2.5× the cols/rows a naïve fit would give it. */
const PREVIEW_SCALE = 0.4;

const TerminalPreview: Component<{
  terminalId: TerminalId;
  theme: ITheme;
}> = (props) => {
  let containerRef!: HTMLDivElement;
  let terminal: XTerm | null = null;
  let fitAddon: FitAddon | null = null;
  let streamAbort: AbortController | null = null;
  let fitRaf = 0;

  function debouncedFit() {
    cancelAnimationFrame(fitRaf);
    fitRaf = requestAnimationFrame(() => fitAddon?.fit());
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

  onMount(async () => {
    await document.fonts.load(`1em ${FONT_FAMILY}`);

    const term = new XTerm({
      fontFamily: FONT_FAMILY,
      theme: props.theme,
      fontSize: PREVIEW_FONT_SIZE,
      cursorBlink: false,
      cursorInactiveStyle: "none",
      disableStdin: true,
      // No scrollback = no scrollbar. Preview is read-only, scrolling not needed.
      scrollback: 0,
      allowProposedApi: true,
    });
    terminal = term;

    fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(containerRef);
    fitAddon.fit();

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

    createResizeObserver(
      () => containerRef,
      () => debouncedFit(),
    );

    refitOnTabVisible(debouncedFit);

    onCleanup(() => {
      streamAbort?.abort();
      terminal?.dispose();
    });
  });

  // The outer div is the host size. The inner div (containerRef) is the
  // virtual canvas — sized at 1/PREVIEW_SCALE of the host, then CSS-scaled
  // back down to fit. xterm + FitAddon run inside the inner div and see
  // the larger dimensions, giving more cols×rows at a readable font size.
  const invScale = `${100 / PREVIEW_SCALE}%`;
  return (
    <div
      class="w-full h-full overflow-hidden"
      data-testid="terminal-preview"
      data-terminal-id={props.terminalId}
    >
      <div
        ref={containerRef}
        style={{
          width: invScale,
          height: invScale,
          transform: `scale(${PREVIEW_SCALE})`,
          "transform-origin": "top left",
        }}
      />
    </div>
  );
};

export default TerminalPreview;
