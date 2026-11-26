// @vitest-environment happy-dom
//
// DOES `onReady` RUN TO COMPLETION?
//
// `<Xterm>` hands kolu's policy half the live terminal from inside the
// component's reactive owner, re-entered with `runWithOwner` after the font
// await (`xterm-kit/src/solid/xtermLifecycle.ts`). That is an OWNED scope: a
// signal written there must declare `ownedWrite`, or the write THROWS in a
// development build. The throw unwinds into the lifecycle's one `try/catch`,
// which is a bare `console.error` — so everything `onReady` does after the
// write simply never happens, silently, and the pane that results has no
// `__xterm` bridge, no link provider, no attach stream and no focus.
//
// Nothing caught that, because every other terminal test mocks either
// `./Terminal` or the kit. This one mounts the REAL `Terminal` around the REAL
// `@kolu/xterm-kit` `<Xterm>` and its REAL lifecycle, and asks the one question
// the e2e step "the terminal is ready" asks: did `onReady` reach its end?
//
// It is answered four ways, because a single assertion could be satisfied by a
// `onReady` that died later: the `__xterm` bridge (set near the TOP of
// `onReady`), the first focus (`Terminal.tsx`'s post-fit focus), the drag
// listeners registered AFTER it (the last statements of `onReady`), and the
// lifecycle's own `console.error` staying silent. Any owned scope write that
// hides behind an earlier one fails a later assertion.
//
// Under `@kolu/solid-test-setup` the run also fails on any Solid diagnostic at
// all, so this same mount is the zero-diagnostic proof for the kit's
// `STRICT_READ_UNTRACKED` — the whole options bag read in `<Xterm>`'s body to
// snapshot the awaited font face, now `untrack`ed.
//
// WHAT IS STOOD IN FOR, and only this: the browser facts happy-dom does not
// have (`document.fonts`, `ResizeObserver`, `OffscreenCanvas` and a 2d
// `getContext`), kolu's WIRE — the host map, the RPC, the preferences store and
// the terminal store — which is a server connection, not a terminal, and four
// surfaces that hang off the pane rather than drive it (`personInput`,
// `WorkLock`, `PrintedUrlCard` and `solid-sonner`'s toaster). Every link
// between `<Terminal>` and the xterm it drives is the production one, including
// the real `@xterm/xterm`.

import type { ITheme } from "@xterm/xterm";
import type { TerminalId } from "kolu-common/surface";
import { render } from "@solidjs/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ID = "ready-main" as TerminalId;

vi.mock("../wire", () => ({
  activeHost: () => "local",
  padiMap: { entry: () => ({ state: () => ({ kind: "connected" }) }) },
  activePadiRpc: {
    lifecycle: { sendInput: vi.fn(), resize: vi.fn() },
    scratch: { write: vi.fn() },
  },
  activePadiStreams: { terminalAttach: { unenrolled: vi.fn() } },
  preferences: () => ({ scrollLock: true, terminalRenderer: "dom" }),
}));

vi.mock("./useTerminalStore", () => ({
  useTerminalStore: () => ({
    holdsWebgl: () => false,
    getMetadata: () => undefined,
  }),
}));

vi.mock("../conductor/personInput", () => ({
  personInput: () => true,
  activeTerminalRef: () => undefined,
}));
vi.mock("../conductor/WorkLock", () => ({ default: () => <div /> }));
vi.mock("./PrintedUrlCard", () => ({ PrintedUrlCardMount: () => <div /> }));
vi.mock("solid-sonner", () => ({ toast: { error: vi.fn() } }));
// `vi.mock` factories are hoisted above this file's imports, so the component
// under test is imported after them (the idiom its sibling terminal specs use).
const { default: Terminal } = await import("./Terminal");

let dispose: (() => void) | undefined;
let host: HTMLElement | undefined;
let errors: unknown[][] = [];

const tick = (): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  return promise;
};

beforeEach(() => {
  errors = [];
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    errors.push(a);
  });
  // happy-dom has no font loading API; the lifecycle awaits it before it
  // constructs the terminal, which is the whole reason it needs an owner back.
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { load: () => Promise.resolve([]) },
  });
  // xterm's width cache takes a 2d context unconditionally and throws on a
  // null one; happy-dom paints nothing, so every `getContext("2d")` it offers
  // — on a canvas element and on its `OffscreenCanvas` alike — is null. The
  // cache only ever sets `font` and reads `measureText(...).width`, and this
  // gives it exactly that. It deliberately reports no `fontBoundingBox*`, so
  // xterm's cell measurement falls back to its own DOM strategy, which is the
  // honest answer for a document that lays nothing out.
  const fakeCtx = () =>
    ({
      font: "",
      measureText: (text: string) => ({ width: text.length * 8 }),
    }) as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    fakeCtx,
  );
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      getContext() {
        return fakeCtx();
      }
    },
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  dispose?.();
  host?.remove();
  dispose = undefined;
  host = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Mount the pane and let the lifecycle's font await resolve, so `onReady` has
 *  run by the time the assertions read the DOM. */
async function mountTerminal(): Promise<HTMLElement> {
  host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(
    () => (
      <Terminal
        terminalId={ID}
        visible={true}
        boxDecided={true}
        viewShown={true}
        focused={true}
        theme={{} as ITheme}
        searchOpen={false}
        onSearchOpenChange={() => {}}
      />
    ),
    host,
  );
  // One turn for `document.fonts.load`, one for the microtasks the construction
  // chains behind it.
  await Promise.resolve();
  await tick();
  const container = host.querySelector<HTMLElement>(
    `[data-terminal-id="${ID}"]`,
  );
  if (!container) throw new Error("the kit's mount element never rendered");
  return container;
}

describe("Terminal onReady", () => {
  it("runs to completion inside the kit's owned scope", async () => {
    const container = await mountTerminal();
    // The lifecycle's catch is a bare console.error; a thrown onReady is
    // otherwise invisible (it is not a page error). Read FIRST, so a broken
    // onReady reports its own reason rather than an undefined bridge.
    expect(errors.map((a) => a.map(String).join(" "))).toEqual([]);

    // TOP of onReady: the e2e bridge every cucumber buffer read goes through.
    expect(
      (container as HTMLElement & { __xterm?: unknown }).__xterm,
    ).toBeDefined();

    // MIDDLE of onReady: the first focus, which is what makes this the proof
    // that no owned-scope write hides behind the handle signal's.
    expect(
      document.activeElement?.classList.contains("xterm-helper-textarea"),
    ).toBe(true);

    // THE END of onReady: the file-drop listeners are the last thing it
    // registers, so a drag that highlights the pane and a leave that clears it
    // again is the proof that execution reached the final statements.
    const drag = (type: string, relatedTarget: Node | null = null): void => {
      const e = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(e, "dataTransfer", {
        value: { types: ["Files"], dropEffect: "none" },
      });
      Object.defineProperty(e, "relatedTarget", { value: relatedTarget });
      container.dispatchEvent(e);
    };
    drag("dragover");
    expect(container.dataset.dropTarget).toBe("");
    drag("dragleave");
    expect(container.dataset.dropTarget).toBeUndefined();
  });
});
