// @vitest-environment happy-dom
//
// Scrolling back in a Conductor screen must stay where it was scrolled.
//
// `PeekTerminal` is the one screen behind a work's live pane and the Look
// window. This drives it over the REAL scroll lock (`createScrollLock`) and a
// REAL xterm buffer core (`@xterm/headless`), and stands in only for the DOM
// half of `<Xterm>`. It asks one question: when a person scrolls back, does
// the screen keep its one attach — or open a second, which resets the
// terminal and repaints it at the bottom?
//
// The `vi.mock` factories import inside themselves because vitest hoists them
// above this file's own imports (the same idiom as `PeekTerminal.test.tsx`).
import type * as XtermKit from "@kolu/xterm-kit/solid";
import type { Terminal as BrowserTerminal } from "@xterm/xterm";
import type { HostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { render } from "@solidjs/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Shown } from "../../ui/shown";

const ID = "11111111-1111-4111-8111-111111111111" as TerminalId;

/** What the test drives of the terminal core. */
interface Core {
  write(data: string, done?: () => void): void;
  scrollLines(lines: number): void;
  readonly buffer: { active: { baseY: number; viewportY: number } };
}
/** What the test drives of the scroll lock. */
interface Lock {
  armUserScrollIntent(source: "wheel"): void;
  isLocked(): boolean;
}

const seam = vi.hoisted(() => ({
  PROC: { name: "terminalAttach" },
  attached: [] as unknown[],
  resets: 0,
  term: undefined as Core | undefined,
  lock: undefined as Lock | undefined,
  scrollLockEnabled: true,
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
    preferences: () => ({ scrollLock: seam.scrollLockEnabled }),
  };
});

vi.mock("@kolu/surface/client", async () => {
  const { Effect, Stream } = await import("effect");
  return {
    unenrolledStreamCall: (_proc: unknown, input: unknown) => {
      seam.attached.push(input);
      // The first frame arrives LATER, as it does over a socket. A frame
      // handed over in the same turn as the subscribe would be painted
      // inside the caller's own reactive scope, which no wire ever does.
      return Stream.concat(
        Stream.fromEffect(
          Effect.sleep("5 millis").pipe(
            Effect.as({
              kind: "snapshot",
              data: "",
              topLine: 0,
              grid: { cols: 80, rows: 24 },
            }),
          ),
        ),
        Stream.never,
      );
    },
  };
});

vi.mock("@kolu/xterm-kit/solid", async () => {
  const { onMount } = await import("solid-js");
  const { Terminal } = await import("@xterm/headless");
  // The real lock, through the kit's own entry — only the DOM half of
  // `<Xterm>` is stood in for.
  const { createScrollLock } = await vi.importActual<typeof XtermKit>(
    "@kolu/xterm-kit/solid",
  );
  return {
    measureGridBox: () => null,
    Xterm: (props: {
      scrollLockEnabled: () => boolean;
      onReady: (h: unknown) => void;
    }) => {
      const core = new Terminal({
        cols: 80,
        rows: 24,
        scrollback: 1000,
        allowProposedApi: true,
      });
      // The lock is typed against the browser terminal; the headless core has
      // the same buffer, scroll and reset, which is all the lock touches here.
      const term = core as unknown as BrowserTerminal;
      const scrollLock = createScrollLock(props.scrollLockEnabled);
      onMount(() => {
        // The order `<Xterm>` keeps: the lock listens to the terminal's
        // scroll first, the consumer is handed the handle second
        // (`xterm-kit/src/solid/Xterm.tsx:366,464`).
        scrollLock.attachToTerminal(term);
        seam.term = core;
        seam.lock = scrollLock;
        props.onReady({
          container: document.createElement("div"),
          terminal: {
            reset: () => {
              seam.resets += 1;
              core.reset();
            },
            focus() {},
            blur() {},
            textarea: undefined,
            dimensions: undefined,
            onRender: () => ({ dispose() {} }),
            attachCustomKeyEventHandler() {},
          },
          resize: (grid: { cols: number; rows: number }) =>
            core.resize(grid.cols, grid.rows),
          write: (data: string, parsed?: () => void) =>
            scrollLock.writeData(term, data, parsed),
          clearPendingOutput: () => scrollLock.dropPending(),
          scrollLock,
          recovery: { noteData() {} },
        });
      });
      return <div data-testid="live-screen" />;
    },
  };
});

vi.mock("../../palette/fleetTerminals", () => ({
  fleetTerminalStanding: () => ({
    kind: "here",
    meta: { state: "active", themeName: "Tomorrow Night" },
  }),
}));

vi.mock("../personInput", () => ({ personInputAt: () => true }));

import PeekTerminal from "./PeekTerminal";

const wait = (ms: number): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
};

const mount = (mayType: boolean) => {
  const root = document.createElement("div");
  document.body.append(root);
  return render(
    () => (
      <Shown value={() => true}>
        <PeekTerminal
          host="local"
          id={ID}
          fontSize={14}
          mayType={() => mayType}
          onGrid={() => {}}
          onCell={() => {}}
          onPhase={() => {}}
          onHeld={() => {}}
          onFocus={() => {}}
          onHandle={() => {}}
          testId="live-screen"
        />
      </Shown>
    ),
    root,
  );
};

/** Mount, wait for the one attach and its first frame, and put 200 lines in
 *  the terminal so there is something to scroll back through. */
const mountWithScrollback = async (mayType: boolean) => {
  const dispose = mount(mayType);
  await vi.waitFor(() => expect(seam.attached).toHaveLength(1));
  await wait(30);
  const term = seam.term;
  const lock = seam.lock;
  if (!term || !lock) throw new Error("the screen never became ready");
  const { promise, resolve } = Promise.withResolvers<void>();
  term.write(
    Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\r\n"),
    resolve,
  );
  await promise;
  expect(term.buffer.active.baseY).toBeGreaterThan(0);
  expect(term.buffer.active.viewportY).toBe(term.buffer.active.baseY);
  return { dispose, term, lock };
};

afterEach(() => {
  seam.attached = [];
  seam.resets = 0;
  seam.term = undefined;
  seam.lock = undefined;
  seam.scrollLockEnabled = true;
});

describe("scrolling back in a Conductor screen", () => {
  it.each([
    { name: "while the Conductor drives it (read-only)", mayType: false },
    { name: "after Take over", mayType: true },
  ])("keeps the one attach and the place scrolled to, $name", async (at) => {
    const { dispose, term, lock } = await mountWithScrollback(at.mayType);
    const resetsBefore = seam.resets;

    // A wheel scroll: the capture listener reports it, then xterm scrolls.
    lock.armUserScrollIntent("wheel");
    term.scrollLines(-10);
    await wait(20);

    expect({
      attaches: seam.attached.length,
      resetsSinceScroll: seam.resets - resetsBefore,
      scrolledBack: term.buffer.active.viewportY < term.buffer.active.baseY,
      locked: lock.isLocked(),
    }).toEqual({
      attaches: 1,
      resetsSinceScroll: 0,
      scrolledBack: true,
      locked: true,
    });
    dispose();
  });

  it("CONTROL: with the scroll lock turned off, the same scroll stays put", async () => {
    seam.scrollLockEnabled = false;
    const { dispose, term } = await mountWithScrollback(false);
    const resetsBefore = seam.resets;

    term.scrollLines(-10);
    await wait(20);

    expect({
      attaches: seam.attached.length,
      resetsSinceScroll: seam.resets - resetsBefore,
      scrolledBack: term.buffer.active.viewportY < term.buffer.active.baseY,
    }).toEqual({ attaches: 1, resetsSinceScroll: 0, scrolledBack: true });
    dispose();
  });
});
