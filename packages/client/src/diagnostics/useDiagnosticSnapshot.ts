import type { ServerDiagnostics, TerminalId } from "kolu-common";
import { type Accessor, createMemo, createResource } from "solid-js";
import { client, serverProcessId, wsStatus } from "../rpc/rpc";
import { getTerminalRefs } from "../terminal/terminalRefs";
import { getDiagnostics } from "../terminal/useTerminalDiagnostics";
import { webglLifecycleSnapshot } from "../terminal/webglTracker";
import { isMobile } from "../useMobile";
import { bytesToMB } from "./format";

/** WebGL2 support detection creates a throwaway canvas + WebGL context
 *  that lingers on a detached node until GC. Compute once at module load
 *  so re-opening this dialog doesn't burn one context per open — the exact
 *  zombie-context pattern this dialog exists to diagnose (#591). */
const WEBGL2_SUPPORTED = (() => {
  const canvas = document.createElement("canvas");
  return !!canvas.getContext("webgl2");
})();

function browserFacts() {
  return {
    userAgent: navigator.userAgent,
    webgl2Supported: WEBGL2_SUPPORTED,
    crossOriginIsolated: self.crossOriginIsolated,
    devicePixelRatio: window.devicePixelRatio,
    xtermVersion: __XTERM_VERSION__,
  };
}

/** `performance.memory` is Chromium-only and missing from the DOM type
 *  definitions — isolate the narrow cast here so the snapshot memo stays
 *  free of it. Returns null on non-Chromium browsers. */
function readJsHeap(): {
  usedMB: number;
  totalMB: number;
  limitMB: number;
} | null {
  const mem = (
    performance as {
      memory?: {
        usedJSHeapSize: number;
        totalJSHeapSize: number;
        jsHeapSizeLimit: number;
      };
    }
  ).memory;
  if (!mem) return null;
  return {
    usedMB: bytesToMB(mem.usedJSHeapSize),
    totalMB: bytesToMB(mem.totalJSHeapSize),
    limitMB: bytesToMB(mem.jsHeapSizeLimit),
  };
}

function terminalSnapshots() {
  return getDiagnostics().map((d) => {
    const refs = getTerminalRefs(d.id);
    const bufferLen = refs?.xterm.buffer.active.length ?? null;
    return {
      id: d.id,
      cols: d.cols,
      rows: d.rows,
      renderer: d.renderer,
      bufferLen,
      scrollback: bufferLen !== null ? bufferLen - d.rows : null,
      atlas: refs?.probes.webglAtlas() ?? null,
      bufferBytes: refs?.probes.bufferBytes() ?? null,
    };
  });
}

export interface DiagnosticSnapshot {
  browser: ReturnType<typeof browserFacts>;
  session: {
    viewport: "mobile" | "canvas";
    wsStatus: ReturnType<typeof wsStatus>;
    serverProcessId: ReturnType<typeof serverProcessId>;
    activeId: TerminalId | null;
    terminalCount: number;
    jsHeap: ReturnType<typeof readJsHeap>;
    domNodes: number;
    canvases: number;
  };
  server: ServerDiagnostics | null;
  terminals: ReturnType<typeof terminalSnapshots>;
  webgl: ReturnType<typeof webglLifecycleSnapshot>;
}

export function useDiagnosticSnapshot(props: {
  open: Accessor<boolean>;
  activeId: Accessor<TerminalId | null>;
}) {
  const browser = browserFacts();
  const [serverDiagnostics] = createResource(
    () => (props.open() ? serverProcessId() : undefined),
    () => client.server.diagnostics(),
  );

  const snapshot = createMemo<DiagnosticSnapshot>(() => {
    const webgl = webglLifecycleSnapshot();
    const terminals = terminalSnapshots();
    return {
      browser,
      session: {
        viewport: isMobile() ? "mobile" : "canvas",
        wsStatus: wsStatus(),
        serverProcessId: serverProcessId(),
        activeId: props.activeId(),
        terminalCount: terminals.length,
        jsHeap: readJsHeap(),
        domNodes: document.getElementsByTagName("*").length,
        canvases: webgl.totalDomCanvases,
      },
      server: serverDiagnostics() ?? null,
      terminals,
      webgl,
    };
  });

  return { snapshot, serverDiagnostics };
}
