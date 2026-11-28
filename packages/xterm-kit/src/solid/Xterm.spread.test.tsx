/**
 * THE MOUNT DIV'S ATTRIBUTES, AND WHO OWNS THE RENDERER ONE.
 *
 * `<Xterm>` applies every attribute a consumer hands it as ONE render effect
 * (the spread of `rest`). `hasWebgl` is written from the WebGL attach/detach
 * effect, a flush AFTER the box change that caused the re-attach — so a
 * consumer attribute derived from it made that single spread run twice for one
 * box change, painting the layout-derived attributes first with the stale
 * renderer and again with the new one (`EFFECT_RELAY_TEAR`).
 *
 * The first test is the product's shape: the kit binds `data-renderer` itself,
 * the consumer passes only layout-derived attributes, and driving the box three
 * times raises nothing. The second test keeps the hazard legible: a consumer
 * that routes the kit's own `hasWebgl` back through the spread tears, and the
 * test PRINTS the name of the relayed write Solid reports.
 */

import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { type JSX, render } from "@solidjs/web";
import { createSignal, flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import { Xterm, type XtermHandle } from "./Xterm";

// A WebGL addon that always loads. happy-dom has no WebGL context, so the real
// addon throws inside `attachWebGL`'s `try` and `hasWebgl` would never move —
// there would be no effect-written fact to relay. Everything this stands in for
// is xterm's and the GPU's; the kit's own wiring (load on the gate, unload off
// it, the signal that reports it) is what runs for real here.
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    onContextLoss(): void {}
    activate(): void {}
    dispose(): void {}
    clearTextureAtlas(): void {}
  },
}));

let dispose: (() => void) | undefined;
let host: HTMLElement | undefined;
afterEach(() => {
  dispose?.();
  host?.remove();
  dispose = undefined;
  host = undefined;
});

// happy-dom has no canvas 2d context, and xterm's glyph width cache refuses to
// construct without one. A recording stand-in with a fixed advance width is
// enough for `term.open()` to complete — this test is about the kit's reactive
// wiring on the mount div, not about what xterm paints.
const canvasContext2d = new Proxy(
  { measureText: () => ({ width: 8 }) } as Record<string, unknown>,
  {
    get: (target, key) =>
      key in target ? target[key as string] : () => undefined,
    set: (target, key, value) => {
      target[key as string] = value;
      return true;
    },
  },
);
HTMLCanvasElement.prototype.getContext = ((type: string) =>
  type === "2d" ? canvasContext2d : null) as HTMLCanvasElement["getContext"];
// xterm's width cache prefers an `OffscreenCanvas` when the global exists;
// happy-dom's returns no context either, so it gets the same stand-in.
(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class {
  getContext(type: string): unknown {
    return type === "2d" ? canvasContext2d : null;
  }
};

// happy-dom ships no `document.fonts`, and the lifecycle awaits the terminal
// face before constructing. One loader that resolves is the whole of what the
// kit needs from it here.
Object.defineProperty(document, "fonts", {
  configurable: true,
  value: { load: () => Promise.resolve([]) },
});

/** One macrotask turn. */
function tick(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  return promise;
}

/** Mount `<Xterm>` and wait for its asynchronous construction (the font await)
 *  to have run `onReady`. */
async function mount(view: () => JSX.Element): Promise<void> {
  host = document.createElement("div");
  document.body.append(host);
  dispose = render(view, host);
  // The lifecycle awaits `document.fonts.load` before constructing; two
  // macrotask turns are enough for that promise and the synchronous setup that
  // follows it.
  await tick();
  await tick();
  flush();
}

const ownProps = (
  webgl: () => boolean,
  onReady: (handle: XtermHandle) => void,
) =>
  ({
    theme: {},
    fontSize: 12,
    visible: true,
    boxDecided: true,
    webgl,
    scrollLockEnabled: () => false,
    fullRate: () => true,
    fontFamily: "monospace",
    // The kit loads the unicode11 addon, which refuses to activate without it.
    terminalOptions: { allowProposedApi: true },
    onData: () => {},
    onReady,
    onTap: () => false,
  }) as const;

/** EVERYTHING Solid raised, taken off the judge so this file can assert it
 *  itself. The whole list, never a filtered one: taking the events empties the
 *  judge, so a finding this file does not filter for is a finding nobody would
 *  ever see. Tests that are about one code filter THIS list. */
function drainDiagnostics(): {
  code: string;
  severity?: string;
  wrote: unknown;
}[] {
  return takeSolidDiagnostics().map((event) => {
    const data = event.data;
    const wrote =
      data && typeof data === "object" && "wrote" in data
        ? data.wrote
        : undefined;
    // PRINTED, because the name of a relayed write is the whole address of
    // that finding and the report's own reduction drops it.
    console.info(
      `${event.code} [${event.severity}] wrote=${String(wrote)}: ${event.message}`,
    );
    return { code: event.code, wrote, severity: event.severity };
  });
}

it("binds the renderer attribute itself, so a box change paints once", async () => {
  // ONE ROOT WRITE drives both a layout-derived attribute on the spread and the
  // WebGL budget gate, which is the product's coupling: a re-fit re-attaches the
  // renderer, and the attach effect's write lands in the next flush.
  const [box, setBox] = createSignal(0);

  await mount(() => (
    <Xterm
      {...ownProps(
        () => box() % 2 === 0,
        () => {},
      )}
      data-box={String(box())}
    />
  ));

  const div = host?.querySelector<HTMLDivElement>("[data-box]");
  expect(div).toBeTruthy();
  // The kit owns it: nothing was passed in, and the attribute is there.
  expect(div?.getAttribute("data-renderer")).toBe("webgl");

  // Past the threshold, not at it: `EFFECT_RELAY_TEAR` escalates to `warn` on
  // the third sighting.
  for (const next of [1, 2, 3]) {
    setBox(next);
    flush();
  }

  expect(div?.getAttribute("data-box")).toBe("3");
  expect(div?.getAttribute("data-renderer")).toBe("dom");
  // The WHOLE drained list, not the tears in it: this test's claim is that the
  // mount raised NOTHING, and filtering here would swallow every other code.
  expect(drainDiagnostics()).toEqual([]);
});

it("tears when a consumer routes the renderer fact back through the spread", async () => {
  // The shape the fix removes, kept here so the hazard stays legible: the kit's
  // own effect-written `hasWebgl`, read back out of the handle and handed to the
  // kit as one more attribute on the shared spread.
  const [box, setBox] = createSignal(0);
  // `ownedWrite`: `onReady` runs inside the component's own owner, which is
  // where the product publishes the handle too.
  const [handle, setHandle] = createSignal<XtermHandle | null>(null, {
    name: "xtermSpreadTestHandle",
    ownedWrite: true,
  });

  await mount(() => (
    <Xterm
      {...ownProps(
        () => box() % 2 === 0,
        (h) => setHandle(h),
      )}
      data-box={String(box())}
      data-consumer-renderer={
        (handle()?.webgl.hasWebgl() ?? false) ? "webgl" : "dom"
      }
    />
  ));

  for (const next of [1, 2, 3]) {
    setBox(next);
    flush();
  }

  const drained = drainDiagnostics();
  // This test is about one code, so it filters — but it filters the WHOLE
  // drained list and then asserts nothing else was in it, so a second finding
  // raised by this shape fails here rather than disappearing with the drain.
  const tears = drained.filter((event) => event.code === "EFFECT_RELAY_TEAR");
  expect(drained.filter((event) => event.code !== "EFFECT_RELAY_TEAR")).toEqual(
    [],
  );
  expect(tears.length).toBeGreaterThan(0);
  // The relayed write is the kit's own renderer fact, named by the compiler
  // from its factory and its variable.
  expect(tears.map((tear) => tear.wrote)).toContain("attachWebGL.hasWebgl");
  expect(tears.some((tear) => tear.severity === "warn")).toBe(true);
});
