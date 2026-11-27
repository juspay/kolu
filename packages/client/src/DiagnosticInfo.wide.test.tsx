// @vitest-environment happy-dom
/** THE DIAGNOSTIC DIALOG OVER A 250-PANE SESSION.
 *
 *  Three readings in this dialog grew with the session, and the first of them
 *  is the narrowest scope anywhere in the client:
 *
 *   - the ATTENTION fold read each pane's metadata slot and projection, its
 *     attention value, and the dozen leaves the pip binder and the diagnostic
 *     narrow on — twelve to fifteen sources per pane, past Solid's 200-source
 *     `WIDE_SCOPE_DEPS` judge at about FOURTEEN panes;
 *   - the JSON DUMP read `getDiagnostics()` — `Object.values` of the register's
 *     store — and then eight to twelve leaves off each record;
 *   - the Count row's own RENDER EFFECT read the same register.
 *
 *  THE STORES ARE THE REAL ONES. The metadata comes through the real
 *  `useTerminalMetadata` projection over `hostWireMirror`'s real keys stream,
 *  per-key `useCollection` view and subscription stores; the attention facts
 *  come through the real `useAttentionFacts` mirror over that host's real
 *  `urgency` cell and `activity` stream; and the register is the real module
 *  store, written by 250 real `registerDiagnostics` calls.
 *
 *  The dialog is MOUNTED and OPEN, because that is the only state in which any
 *  of these exist. */

import type { PadiTerminal, PadiUrgency } from "@kolu/padi-client/surface";
import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { settle } from "@kolu/surface/solid/testlib";
import type { JSX } from "@solidjs/web";
import { render } from "@solidjs/web";
import type { TerminalId } from "kolu-common/surface";
import { createRoot, createSignal, flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";

// `useCollection` opens each key's stream through this; the mirror's procedure
// IS the stream, so calling it is the whole wire.
vi.mock("@kolu/surface/client", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  unenrolledStreamCall: (source: (input: unknown) => unknown, input: unknown) =>
    source(input),
}));

const held = vi.hoisted(() => ({
  /** The active host's scope, as `useTerminalMetadata` reads it. */
  scope: undefined as unknown,
  /** The wire entry for the one host in the pool. */
  entry: (() => undefined) as () => unknown,
  /** One pane's record, through the real metadata projection. */
  meta: ((_id: string) => undefined) as (id: string) => object | undefined,
  /** Every pane, in server order. */
  ids: [] as TerminalId[],
}));

vi.mock("./wire", () => ({
  activeHost: () => ({ kind: "local" }),
  hostKeys: () => [{ kind: "local" }],
  padiMap: { entry: () => held.entry() },
  interpretClientError: () => {},
}));
vi.mock("./hostScope/hostScopes", () => ({ activeScope: () => held.scope }));
vi.mock("./terminal/useTerminalStore", () => ({
  useTerminalStore: () => ({
    terminalIds: () => held.ids,
    getMetadata: (id: string) => held.meta(id),
  }),
}));

// The dialog chrome: a plain open/closed wrapper, so the content under test
// mounts without corvu's portal machinery.
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
  wsStatus: () => "open",
  serverProcessId: () => null,
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
vi.mock("@kolu/surface-app/solid", () => ({
  useSurfaceApp: () => ({ server: () => null }),
}));
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

import { hostWireMirror } from "./hostScope/hostWireMirror.testlib";
import DiagnosticInfo, { diagnosticDialog } from "./DiagnosticInfo";
import { registerDiagnostics } from "./terminal/useTerminalDiagnostics";
import { useTerminalMetadata } from "./terminal/useTerminalMetadata";

const PANES = 250;
/** Every fourth pane is a tile; the three after it are its splits. */
const TILE_EVERY = 4;
const ids = Array.from(
  { length: PANES },
  (_, n) => `t${n}` as TerminalId,
) as TerminalId[];
const parentAt = (n: number): TerminalId | null =>
  n % TILE_EVERY === 0 ? null : (ids[n - (n % TILE_EVERY)] as TerminalId);

/** The ONE pane an agent is working in — a split, so the attention section has
 *  a row that the top-level enumeration alone would not explain. */
const WORKING_AT = 17;

const recordAt = (n: number): PadiTerminal =>
  ({
    state: "active",
    parentId: parentAt(n),
    cwd: `/w/box${n - (n % TILE_EVERY)}`,
    git: { kind: "none" },
    agent: n === WORKING_AT ? { kind: "claude-code", state: "working" } : null,
    foreground: null,
    lastActivityAt: n,
    ports: { status: "known", list: [] },
  }) as unknown as PadiTerminal;

const urgencyOf = (workingIds: readonly TerminalId[]): PadiUrgency =>
  ({
    awaitingIds: [],
    workingIds: [...workingIds],
    lingerIds: [],
    finishedIds: [],
    settled: true,
  }) as unknown as PadiUrgency;

const diagnostics = (): string[] =>
  takeSolidDiagnostics().map(
    (event) => `[${event.severity}] ${event.code} ${event.message}`,
  );

let dispose: (() => void) | undefined;
let disposeStore: (() => void) | undefined;
let root: HTMLElement | undefined;
afterEach(() => {
  dispose?.();
  disposeStore?.();
  dispose = undefined;
  disposeStore = undefined;
  root?.remove();
  root = undefined;
  diagnosticDialog.close();
});

/** The dialog, open, over a 250-pane session: the real metadata projection,
 *  the real attention mirror, and 250 real diagnostics registrations. */
async function dialog() {
  const mirror = hostWireMirror();
  held.entry = () => ({
    clock: { toLocal: (at: number) => at },
    ...(mirror.entry as object),
  });
  held.ids = ids;
  takeSolidDiagnostics();

  const metadata = createRoot((disposeRoot) => {
    disposeStore = disposeRoot;
    const entry = mirror.entry as {
      collections: {
        terminals: { use: (options: { keys: () => TerminalId[] }) => unknown };
      };
    };
    held.scope = {
      wire: {
        terminals: entry.collections.terminals.use({ keys: () => [...ids] }),
      },
      prefs: {
        activityWindow: () => "all" as const,
        setActivityWindow: () => {},
      },
    };
    const built = useTerminalMetadata({ list: () => ids });
    // The register, as `Terminal.tsx` writes it: one registration per pane,
    // each carrying its own live accessors.
    for (const [n, id] of ids.entries()) {
      const [term] = createSignal({ cols: 80, rows: 24 + (n % 3) });
      const [wanted] = createSignal<{ cols: number; rows: number } | null>({
        cols: 80,
        rows: 24 + (n % 3),
      });
      registerDiagnostics(id, {
        term,
        renderer: () => (n % 2 === 0 ? "webgl" : "dom"),
        wanted,
        scrollLock: {
          locked: () => false,
          pendingChunks: () => 0,
          lastEvent: () => null,
        },
      });
    }
    return built;
  });
  held.meta = (id) => metadata.getMetadata(id as TerminalId);

  mirror.pushKeys(ids);
  for (const [n, id] of ids.entries()) mirror.pushRecord(id, recordAt(n));
  mirror.pushUrgency(urgencyOf([ids[WORKING_AT] as TerminalId]));
  mirror.pushActivity([]);
  // The projection is PULLED: reading one slot builds the table and opens every
  // key's subscription, and the frames queued above land on the settle after it.
  held.meta(ids[0] as string);
  await settle();
  flush();

  diagnosticDialog.openDialog();
  root = document.createElement("div");
  document.body.append(root);
  dispose = render(
    () => <DiagnosticInfo activeId={ids[0] as TerminalId} />,
    root,
  );
  // The attention mirror opens its host root when the dialog mounts, so the
  // urgency and activity frames queued above cross their fibers only now.
  await settle();
  flush();
  return { mirror };
}

/** The dialog's own readings, off the painted DOM. */
const countRow = (): string | null =>
  [...(root as HTMLElement).querySelectorAll("div")].find(
    (el) => el.firstElementChild?.textContent === "Count",
  )?.lastElementChild?.textContent ?? null;
const hostCounts = (): string | null =>
  [...(root as HTMLElement).querySelectorAll("div")].find(
    (el) => el.firstElementChild?.textContent === "host counts",
  )?.lastElementChild?.textContent ?? null;
/** Each attention row's id prefix and its padi class, in painted order. */
const attentionRows = (): string[] =>
  [...(root as HTMLElement).querySelectorAll("div.pl-\\[9ch\\]")]
    .map((el) => el.textContent ?? "")
    .filter((text) => text.startsWith("pip="));

it("dumps a 250-pane session with no wide scope", async () => {
  const { mirror } = await dialog();

  // One row per pane the client enumerates, and the register's own count.
  expect(attentionRows()).toHaveLength(PANES);
  expect(countRow()).toBe(String(PANES));
  // The host counts come off the mirrored urgency frame: the one working agent.
  expect(hostCounts()).toContain("1 active (1 working");
  // The working pane's row says so; its neighbours do not.
  expect(attentionRows()[WORKING_AT]).toContain("padi=working");
  expect(attentionRows()[WORKING_AT + 1]).toContain("padi=idle");
  expect(diagnostics()).toEqual([]);

  // The agent finishes and another starts working: exactly those two rows move.
  mirror.pushUrgency(urgencyOf([ids[200] as TerminalId]));
  await settle();
  flush();
  expect(attentionRows()[WORKING_AT]).toContain("padi=idle");
  expect(attentionRows()[200]).toContain("padi=working");
  expect(countRow()).toBe(String(PANES));
  expect(diagnostics()).toEqual([]);
});
