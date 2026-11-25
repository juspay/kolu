// @vitest-environment happy-dom
//
// A REAL WHEEL IN THE LOOK WINDOW.
//
// `PeekTerminal.scroll.test.tsx` drives the same screen, but it reports the
// scroll input itself (`lock.armUserScrollIntent("wheel")`) — so it proves what
// the lock does once it is armed, and nothing about what arms it. This file
// closes that gap: it mounts the WHOLE Look window — the real `TerminalPeek`
// inside the real `ModalDialog`, which is corvu's
// `Dialog`/`Portal`/`Overlay`/`Content`, whose prevent-scroll listeners live on
// the shared `document` — and dispatches a REAL `WheelEvent` at the screen, the
// way a person's wheel reaches it. The arming listener is the capture, passive
// one `wireScrollIntent` puts on the screen container
// (`xterm-kit/src/solid/scrollLockWiring.ts`), and every link between the two is
// the production one.
//
// It asks: does a wheel inside an open Look window engage the lock, does the
// head say `new output below`, and does the place the reader scrolled to survive
// the output that arrives next?
//
// The window is opened BOTH WAYS, because corvu answers them differently.
// Opened while the dialog is already mounted — the app's own path — corvu's
// `createPresence` never reaches `present`, so its prevent-scroll puts NOTHING
// on the document (see the second case for the proof, and the PR for the
// report; this file does not pin that as desired behaviour). Mounted already
// open, presence starts `present`, prevent-scroll arms, and its non-passive
// document `wheel` listener is genuinely in the way of this gesture. The lock
// must engage in both.
//
// The `vi.mock` factories import inside themselves because vitest hoists them
// above this file's own imports (the same idiom as `PeekTerminal.test.tsx`).
import type * as XtermKit from "@kolu/xterm-kit/solid";
import type { Terminal as BrowserTerminal } from "@xterm/xterm";
import type { HostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { render } from "@solidjs/web";
import { flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Shown } from "../../ui/shown";

const ID = "11111111-1111-4111-8111-111111111111" as TerminalId;

/** What the test drives of the terminal core. */
interface Core {
  write(data: string, done?: () => void): void;
  scrollLines(lines: number): void;
  readonly buffer: { active: { baseY: number; viewportY: number } };
}
/** What the test reads of the scroll lock. */
interface Lock {
  isLocked(): boolean;
}

const seam = vi.hoisted(() => ({
  PROC: { name: "terminalAttach" },
  attached: [] as unknown[],
  term: undefined as Core | undefined,
  lock: undefined as Lock | undefined,
  /** The child the wheel lands on — xterm's own screen sits inside the
   *  container the kit wires its listeners to. */
  screen: undefined as HTMLElement | undefined,
  /** Hand the attach stream another frame, as the wire does. */
  send: undefined as ((frame: unknown) => void) | undefined,
}));

vi.mock("../../wire", async () => {
  const { Effect } = await import("effect");
  return {
    padiMap: {
      useEntry: (_key: () => HostKey) => ({
        streams: { terminalAttach: { unenrolled: seam.PROC } },
      }),
    },
    padiRpcOf: () => ({ lifecycle: { sendInput: () => Effect.void } }),
    preferences: () => ({ scrollLock: true }),
    // The attention engine comes along with `holdConductorScreen`, which the
    // screen states for as long as it is shown. No host is in this fleet, so
    // its per-host roots are empty and none of it is modelled here.
    hostKeys: () => [],
    interpretClientError: () => {},
  };
});

vi.mock("@kolu/surface/client", async () => {
  const { Effect, Queue, Stream } = await import("effect");
  return {
    unenrolledStreamCall: (_proc: unknown, input: unknown) => {
      seam.attached.push(input);
      return Stream.callback<unknown>((queue) =>
        Effect.sync(() => {
          // The stream stays open, as a socket does, and every later frame the
          // test hands over travels it.
          seam.send = (frame) => Queue.offerUnsafe(queue, frame);
          // The first frame arrives LATER, as it does over a socket.
          setTimeout(
            () =>
              Queue.offerUnsafe(queue, {
                kind: "snapshot",
                data: "",
                topLine: 0,
                grid: { cols: 80, rows: 24 },
              }),
            5,
          );
        }),
      );
    },
  };
});

vi.mock("@kolu/xterm-kit/solid", async () => {
  const { Terminal } = await import("@xterm/headless");
  const { getOwner, onCleanup, runWithOwner } = await import("solid-js");
  // The REAL lock and the REAL DOM wiring, through the kit's own entry — only
  // the xterm the wiring is wired AROUND is stood in for.
  const { createScrollLock, wireScrollIntent } = await vi.importActual<
    typeof XtermKit
  >("@kolu/xterm-kit/solid");
  return {
    measureGridBox: () => null,
    Xterm: (props: {
      scrollLockEnabled: () => boolean;
      onReady: (h: unknown) => void;
      "data-testid": string;
    }) => {
      // The kit's own host element, with the consumer's test id on it, and
      // xterm's screen inside it — so the wheel lands on a DESCENDANT and the
      // container's listener runs in the capture phase it was registered for.
      const container = document.createElement("div");
      container.setAttribute("data-testid", props["data-testid"]);
      const screen = document.createElement("div");
      screen.className = "xterm-screen";
      container.append(screen);

      const owner = getOwner();
      let disposed = false;
      onCleanup(() => {
        disposed = true;
      });
      // THE SHAPE THE KIT HAS: the terminal is built only after its font has
      // loaded, and everything around it — the scroll lock, the wheel wiring,
      // the consumer's `onReady` — is registered inside the component's owner,
      // re-entered after that await (`xterm-kit/solid/xtermLifecycle.ts`). A
      // listener registered on the wrong owner is a failure this models.
      void Promise.resolve().then(() => {
        if (disposed) return;
        runWithOwner(owner, () => {
          const core = new Terminal({
            cols: 80,
            rows: 24,
            scrollback: 1000,
            allowProposedApi: true,
          });
          // The lock is typed against the browser terminal; the headless core
          // has the same buffer, scroll and reset, which is all it touches.
          const term = core as unknown as BrowserTerminal;
          const scrollLock = createScrollLock(props.scrollLockEnabled);
          // The order `<Xterm>` keeps (`solid/Xterm.tsx:403-404`): the lock
          // listens to the terminal's scroll, then the DOM inputs are wired to
          // the lock, then the consumer is handed the handle.
          scrollLock.attachToTerminal(term);
          wireScrollIntent(container, scrollLock);
          // The three are stated TOGETHER, here and nowhere else, so the test
          // can never hold one screen's element beside another screen's lock:
          // a view that is built, dropped and built again hands the seam a
          // whole instance at a time.
          seam.screen = screen;
          seam.term = core;
          seam.lock = scrollLock;
          props.onReady({
            container,
            terminal: {
              reset: () => core.reset(),
              focus() {},
              blur() {},
              textarea: undefined,
              dimensions: undefined,
              onRender: () => ({ dispose() {} }),
              attachCustomKeyEventHandler() {},
            },
            // THE SAME DOOR THE KIT'S HANDLE USES, so an engaged lock holds a
            // stream-stated size behind the bytes the reader has not seen.
            resize: (grid: { cols: number; rows: number }) =>
              scrollLock.resizeInOrder(grid.cols, grid.rows),
            write: (data: string, parsed?: () => void) =>
              scrollLock.writeData(term, data, parsed),
            clearPendingOutput: () => scrollLock.dropPending(),
            scrollLock,
            recovery: { noteData() {} },
          });
        });
      });
      return container;
    },
  };
});

vi.mock("../../palette/fleetTerminals", () => ({
  fleetTerminalStanding: () => ({
    kind: "here",
    meta: {
      state: "active",
      themeName: "Tomorrow Night",
      foreground: null,
      agent: null,
    },
  }),
}));

vi.mock("../personInput", () => ({
  inputAllowedAt: () => false,
  personInputAt: () => false,
}));
vi.mock("../useWorks", () => ({
  useWorkMembers: () => () => new Map(),
  useMembership: () => () => new Map(),
  useSeen: () => () => new Map(),
}));
vi.mock("../memberNames", () => ({
  useMemberName: () => (ref: string) => `name:${ref}`,
}));
vi.mock("../useOpenTile", () => ({ useOpenTile: () => () => {} }));
vi.mock("../useConductor", () => ({
  useConductor: () => ({ takeOver: () => {}, handBack: () => {} }),
}));
vi.mock("../WorkLock", () => ({
  default: () => <div data-testid="work-lock-stub" />,
}));
vi.mock("../../useMobile", () => ({
  layoutMode: () => "desktop",
  isTouch: () => false,
}));
vi.mock("@solid-primitives/resize-observer", () => ({
  createWindowSize: () => ({ width: 1440, height: 900 }),
}));

import TerminalPeek from "./TerminalPeek";
import { closePeek, openPeek } from "./usePeek";

const wait = (ms: number): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
};

/** EVERY `wheel` LISTENER ON THE SHARED DOCUMENT — corvu's prevent-scroll puts
 *  one there (non-passive, so it can cancel) for as long as a modal's content
 *  is present, and it is the listener this file exists to have in the way.
 *  Patching `addEventListener` is the only way to see it: happy-dom keeps its
 *  listener table private, and the kit's own wheel listener is on the screen
 *  container, never here. */
const documentWheel: unknown[] = [];
type AddListener = typeof document.addEventListener;
type RemoveListener = typeof document.removeEventListener;
const realAdd: AddListener = document.addEventListener.bind(document);
const realRemove: RemoveListener = document.removeEventListener.bind(document);
document.addEventListener = ((
  type: string,
  listener: never,
  options: never,
) => {
  if (type === "wheel") documentWheel.push(listener);
  realAdd(type, listener, options);
}) as AddListener;
document.removeEventListener = ((
  type: string,
  listener: never,
  options: never,
) => {
  if (type === "wheel") documentWheel.length = 0;
  realRemove(type, listener, options);
}) as RemoveListener;

const disposers: Array<() => void> = [];

/** Open the Look window on the terminal, let its screen attach and take its
 *  first frame, and put 200 lines in it so there is something to read back.
 *
 *  `when` is WHEN THE WINDOW IS POINTED AT THE TERMINAL: `"after mount"` is the
 *  app's path (a mounted, closed `ModalDialog` that opens), `"before mount"`
 *  mounts it already open. */
const openLookWithScrollback = async (when: "before mount" | "after mount") => {
  if (when === "before mount") openPeek({ host: "local", id: ID });
  const root = document.createElement("div");
  document.body.append(root);
  const dispose = render(
    () => (
      <Shown value={() => true}>
        <TerminalPeek />
      </Shown>
    ),
    root,
  );
  disposers.push(() => {
    dispose();
    root.remove();
  });
  if (when === "after mount") {
    openPeek({ host: "local", id: ID });
    flush();
  }
  await vi.waitFor(() => expect(seam.attached).toHaveLength(1));
  await wait(30);
  const term = seam.term;
  const lock = seam.lock;
  const screen = seam.screen;
  if (!term || !lock || !screen) throw new Error("the screen never opened");
  // A wheel only reaches the document's listeners — corvu's among them — from
  // an element that is IN the document, so the whole premise is checked once
  // here rather than being read backwards out of a failed assertion.
  expect(document.contains(screen)).toBe(true);
  const { promise, resolve } = Promise.withResolvers<void>();
  term.write(
    Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\r\n"),
    resolve,
  );
  await promise;
  expect(term.buffer.active.baseY).toBeGreaterThan(0);
  expect(term.buffer.active.viewportY).toBe(term.buffer.active.baseY);
  return { term, lock, screen };
};

/** The Look window's own word for whether the reader holds the screen — what
 *  `onHeld` reports, drawn, and exactly what the e2e watch reads. */
const liveWord = () => {
  const el = document.querySelector('[data-testid="peek-live"]');
  return { phase: el?.getAttribute("data-phase"), words: el?.textContent };
};

/** One person's wheel at xterm's screen, and what xterm does with the same
 *  event synchronously after it. Answers whether anything cancelled it. */
const wheelBack = (screen: HTMLElement, term: Core): boolean => {
  const wheel = new WheelEvent("wheel", {
    deltaY: -120,
    bubbles: true,
    cancelable: true,
  });
  screen.dispatchEvent(wheel);
  term.scrollLines(-10);
  return wheel.defaultPrevented;
};

afterEach(() => {
  for (const d of disposers.splice(0)) d();
  closePeek();
  flush();
  seam.attached = [];
  seam.term = undefined;
  seam.lock = undefined;
  seam.screen = undefined;
  seam.send = undefined;
  documentWheel.length = 0;
});

describe("the Look window's wheel", () => {
  it("engages the lock and says so, and the output after stays below", async () => {
    const { term, lock, screen } = await openLookWithScrollback("after mount");
    expect({
      window: document.querySelector("[data-corvu-dialog-content]") !== null,
      live: liveWord(),
    }).toEqual({ window: true, live: { phase: "live", words: "live" } });

    wheelBack(screen, term);
    await wait(20);
    flush();

    const rowsBack = term.buffer.active.baseY - term.buffer.active.viewportY;
    expect({
      locked: lock.isLocked(),
      scrolledBack: rowsBack > 0,
      live: liveWord(),
    }).toEqual({
      locked: true,
      scrolledBack: true,
      // THE HEAD'S OWN WORD: `onHeld` reported true, and this is what the
      // reader — and the e2e watch — sees of it.
      live: { phase: "held", words: "new output below" },
    });

    // OUTPUT ARRIVES while they are reading: it is held back, and the place
    // they scrolled to does not move.
    const baseBefore = term.buffer.active.baseY;
    seam.send?.({
      kind: "delta",
      data: `${Array.from({ length: 40 }, (_, i) => `after ${i}`).join("\r\n")}\r\n`,
    });
    await wait(30);
    flush();

    expect({
      rowsBack: term.buffer.active.baseY - term.buffer.active.viewportY,
      baseMoved: term.buffer.active.baseY !== baseBefore,
      locked: lock.isLocked(),
      live: liveWord(),
    }).toEqual({
      rowsBack,
      baseMoved: false,
      locked: true,
      live: { phase: "held", words: "new output below" },
    });
  });

  it("engages it with corvu's prevent-scroll listener in the way", async () => {
    const { term, lock, screen } = await openLookWithScrollback("before mount");
    // The hazard is really present: corvu's non-passive `wheel` listener is on
    // the document this gesture travels.
    expect(documentWheel).toHaveLength(1);

    const cancelled = wheelBack(screen, term);
    await wait(20);
    flush();

    expect({
      // Corvu cancelled the wheel's default action, as it does for a wheel
      // that would scroll nothing behind the modal. Cancelling never stops
      // propagation, and the kit's listener is a CAPTURE one that has already
      // run — so the reader keeps the lock anyway.
      cancelled,
      locked: lock.isLocked(),
      scrolledBack: term.buffer.active.viewportY < term.buffer.active.baseY,
      live: liveWord(),
    }).toEqual({
      cancelled: true,
      locked: true,
      scrolledBack: true,
      live: { phase: "held", words: "new output below" },
    });
  });
});
