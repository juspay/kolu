// @vitest-environment happy-dom
/** THE HEAP ROW IS DRAWN FOR A HEAP THAT MOVED, NOT FOR EVERY DUMP.
 *
 *  The dialog's dump memo recomputes whenever any of the many figures it
 *  gathers ticks — the socket's status, a process's RSS, a terminal's probe —
 *  and `readJsHeap()` mints a FRESH `{ usedMiB, totalMiB, limitMiB }` on every
 *  read. So the `<Show>` that narrows the heap readout was handed an
 *  equal-but-new object on every dump, re-rendering a row whose three figures
 *  had not moved; Solid's dev attribution reports that as
 *  UNSTABLE_MEMO_OUTPUT (object) once four consecutive runs do it. The gate is
 *  `sameJsHeap` as the memo's `equals`, which is the REAL comparator here —
 *  only the dialog's sources are stubbed. */

import type { JSX } from "@solidjs/web";
import { render } from "@solidjs/web";
import { createSignal, flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  /** The socket status the dump reads — one of the many leaves whose tick
   *  recomputes the whole dump. The test installs it. */
  ws: (() => "open") as () => string,
}));

vi.mock("./ui/ModalDialog", () => ({
  default: (props: { open: boolean; children: JSX.Element }) => (
    <div>{props.open ? props.children : null}</div>
  ),
}));
vi.mock("@corvu-next/dialog", () => ({
  default: {
    Content: (props: { children: JSX.Element }) => <div>{props.children}</div>,
    Label: (props: { children: JSX.Element }) => <h2>{props.children}</h2>,
  },
}));
vi.mock("solid-sonner", () => ({
  toast: { success: () => {}, error: () => {} },
}));
vi.mock("./rpc/rpc", () => ({
  wsStatus: () => fixture.ws(),
  serverProcessId: () => null,
}));
vi.mock("./terminal/useTerminalStore", () => ({
  useTerminalStore: () => ({
    terminalIds: () => [],
    getMetadata: () => undefined,
  }),
}));
vi.mock("./terminal/useTerminalDiagnostics", () => ({
  getDiagnostics: () => [],
}));
vi.mock("./terminal/terminalRefs", () => ({
  getTerminalRefs: () => undefined,
}));
vi.mock("./terminal/webglTracker", () => ({
  webglLifecycleSnapshot: () => ({
    totalCreated: 0,
    disposed: 0,
    aliveInDom: 0,
    aliveDetached: 0,
    gced: 0,
    contextsLost: 0,
    totalDomCanvases: 0,
    aliveCanvases: [],
    recentEvents: [],
  }),
}));
vi.mock("./ui/useMemoryUsage", () => ({
  serverRssBytes: () => null,
  padiMemoryDisplay: () => null,
  kavalMemoryDisplay: () => null,
}));
vi.mock("./attention/useAttentionFacts", () => ({
  useAttentionFacts: () => ({ attentionOf: () => null }),
}));
vi.mock("./attention/attentionMarks", () => ({
  hostFrame: () => ({
    live: true,
    byClass: { working: [], linger: [], asking: [] },
  }),
}));
vi.mock("@kolu/padi-client/attention", () => ({
  hostActiveIds: () => [],
  frameClassOf: () => "idle",
}));
vi.mock("@kolu/surface-app/solid", () => ({
  useSurfaceApp: () => ({ server: () => null }),
}));
vi.mock("./wire", () => ({ activeHost: () => ({ kind: "local" }) }));
vi.mock("./WireDiagnosticsSection", () => ({ default: () => <div /> }));
vi.mock("./CopyDiagnosticsButton", () => ({ default: () => <div /> }));
vi.mock("./PadiDiagnosticsSection", () => ({
  default: () => <div />,
  createPadiDiagnosticsFetch: () => ({
    state: () => ({ kind: "loading", host: null }),
    refresh: () => {},
  }),
}));
vi.mock("@kolu/solid-logtail", () => ({ writeTextToClipboard: () => {} }));

// The build stamp the dialog prints is a bundler define, and the heap probe is
// Chromium-only: both are facts of the page the dialog reads at render.
vi.stubGlobal("__XTERM_VERSION__", "5.6.0");
Object.defineProperty(performance, "memory", {
  configurable: true,
  // A FRESH record per read, which is what the browser hands back.
  get: () => ({
    usedJSHeapSize: 42 * 1024 * 1024,
    totalJSHeapSize: 64 * 1024 * 1024,
    jsHeapSizeLimit: 2048 * 1024 * 1024,
  }),
});

import DiagnosticInfo, { diagnosticDialog } from "./DiagnosticInfo";

let dispose: (() => void) | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  diagnosticDialog.close();
  dispose?.();
  host?.remove();
  dispose = undefined;
  host = undefined;
  vi.restoreAllMocks();
});

/** The heap row's cell, by the figures it prints. */
function heapRow(): HTMLElement | undefined {
  return [...(host?.querySelectorAll<HTMLElement>("span") ?? [])].find((s) =>
    s.textContent?.startsWith("42 / 64 MiB"),
  );
}

it("a dump driven by another figure redraws no heap row", () => {
  const [ws, setWs] = createSignal("open");
  fixture.ws = ws;
  host = document.createElement("div");
  document.body.append(host);
  diagnosticDialog.openDialog();
  dispose = render(() => <DiagnosticInfo activeId={null} />, host);

  const row = heapRow();
  expect(row?.textContent).toBe("42 / 64 MiB (limit 2048 MiB)");

  // Five socket readings, each recomputing the whole dump over a heap that has
  // not moved.
  for (const status of ["connecting", "open", "connecting", "open", "closed"]) {
    setWs(status);
    flush();
  }

  // The same element, still saying the same thing: the row was never rebuilt.
  expect(heapRow()).toBe(row);
  expect(row?.textContent).toBe("42 / 64 MiB (limit 2048 MiB)");
});
