/**
 * TerminalPreview — read-only miniature xterm.js instance for Mission Control.
 *
 * Streams live terminal output at a small font size. No input, no addons beyond
 * FitAddon. Uses canvas renderer (not WebGL) to keep GPU overhead low when
 * rendering many previews simultaneously.
 */

import { type Component, onMount, onCleanup, createEffect, on } from "solid-js";
import { createResizeObserver } from "@solid-primitives/resize-observer";
import { Terminal as XTerm, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { FONT_FAMILY } from "./theme";
import { client } from "./rpc";
import type { TerminalId } from "kolu-common";

const PREVIEW_FONT_SIZE = 5;

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
      allowProposedApi: true,
    });
    terminal = term;

    fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(containerRef);
    // Hide scrollbar — overflowY option not available until xterm 6.1+
    const viewport = containerRef.querySelector<HTMLElement>(".xterm-viewport");
    if (viewport) viewport.style.overflowY = "hidden";
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

    onCleanup(() => {
      streamAbort?.abort();
      terminal?.dispose();
    });
  });

  return (
    <div
      ref={containerRef}
      class="w-full h-full overflow-hidden"
      data-testid="terminal-preview"
      data-terminal-id={props.terminalId}
    />
  );
};

export default TerminalPreview;
