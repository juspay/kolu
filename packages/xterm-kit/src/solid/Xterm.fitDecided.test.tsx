/**
 * THE DECIDED-BOX MEASUREMENT REACHES ITS CONSUMER WITHOUT A TORN FRAME.
 *
 * `xtermFitDecidedBox` measures the moment the owner says the box is decided —
 * synchronously, in that same update, which is the promise the gate exists for.
 * Its measurement leaves through `wantedGrid`, and the product's consumer
 * (`Terminal.tsx`'s `observeShownPane`) is an effect over exactly that signal,
 * so an inline write from the fit effect's apply arm relays into a consumer
 * effect that has already run for the same box change — the dev lane's §4 #5
 * advisory, two sightings from `warn`.
 *
 * This is the product's own shape: the kit measures on the decided box, a
 * consumer effect reads `wantedGrid`, and the box is decided three times. The
 * assertion is that the whole drained diagnostic list is EMPTY — a tear fails at
 * its FIRST sighting here, not at the third the dev lane needs — and that the
 * consumer still sees the measurement.
 *
 * The happy-dom scaffolding (canvas stand-in, font loader) is
 * `Xterm.spread.test.tsx`'s, for the same reason: the kit's reactive wiring is
 * what runs for real here, not what xterm paints.
 */

import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { type JSX, render } from "@solidjs/web";
import { createEffect, createSignal, flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import type { TerminalGrid } from "./grid";
import { Xterm, type XtermHandle } from "./Xterm";

vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    onContextLoss(): void {}
    activate(): void {}
    dispose(): void {}
    clearTextureAtlas(): void {}
  },
}));

/** happy-dom has no layout: `getComputedStyle` reports no width, so the real
 *  `measureGridBox` returns `null` and `wantedGrid` could never move — there
 *  would be no measurement to relay, and the pin below would pass vacuously.
 *  The BOX is the browser's to provide; the kit's own arithmetic
 *  (`gridForBox`), its equality gate and its reactive wiring all run for real
 *  against it, which is what this test is about. The box changes per decided
 *  flip, the way a real re-layout does. */
const box = vi.hoisted(() => ({ width: 800 }));
vi.mock("./measureBox", () => ({
  measureGridBox: () => ({
    parentWidth: box.width,
    parentHeight: 600,
    paddingHorizontal: 0,
    paddingVertical: 0,
    scrollbarWidth: 14,
    charWidth: 8,
    letterSpacing: 0,
    deviceCellHeight: 17,
    devicePixelRatio: 1,
  }),
}));

let dispose: (() => void) | undefined;
let host: HTMLElement | undefined;
afterEach(() => {
  dispose?.();
  host?.remove();
  dispose = undefined;
  host = undefined;
});

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
(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class {
  getContext(type: string): unknown {
    return type === "2d" ? canvasContext2d : null;
  }
};
Object.defineProperty(document, "fonts", {
  configurable: true,
  value: { load: () => Promise.resolve([]) },
});
// The fit's own no-box gate reads `clientWidth`/`clientHeight`, which happy-dom
// reports as 0 for every element — the same missing layout the box stub above
// stands in for, at the one gate that reads it directly.
for (const prop of ["clientWidth", "clientHeight"]) {
  Object.defineProperty(HTMLElement.prototype, prop, {
    configurable: true,
    get: () => 600,
  });
}

/** One macrotask turn. */
function tick(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  return promise;
}

async function mount(view: () => JSX.Element): Promise<void> {
  host = document.createElement("div");
  document.body.append(host);
  dispose = render(view, host);
  await tick();
  await tick();
  flush();
}

it("hands the decided box's measurement to its consumer with no tear", async () => {
  // ONE root, as the product has it: a tile's posture decides BOTH whether this
  // pane's box is the one its layout decided and whether the pane is visible —
  // and the consumer's gate reads the visibility beside the measurement. That
  // coupling is what makes the fit effect's write a RELAY: the consumer has
  // already run for this posture when the measurement lands.
  const [posture, setPosture] = createSignal(false);
  /** What the consumer's gate saw, in order. */
  const seen: { shown: boolean; wanted: TerminalGrid | null }[] = [];

  await mount(() => (
    <Xterm
      theme={{}}
      fontSize={12}
      visible={posture()}
      boxDecided={posture()}
      webgl={() => false}
      scrollLockEnabled={() => false}
      fullRate={() => true}
      fontFamily="monospace"
      terminalOptions={{ allowProposedApi: true }}
      onData={() => {}}
      onTap={() => false}
      onReady={(handle: XtermHandle) => {
        // The consumer's gate, in the product's shape (`Terminal.tsx`'s
        // `observeShownPane`): the facts travel from the COMPUTE as values, and
        // "shown" is the measurement AND the visibility together.
        createEffect(
          () => ({
            shown: handle.wantedGrid() !== null && posture(),
            wanted: handle.wantedGrid(),
          }),
          (facts) => {
            seen.push(facts);
          },
        );
      }}
    />
  ));
  // The mount's own frame is not what this pins.
  takeSolidDiagnostics();

  // The posture moves three times, past the escalation threshold, each on a
  // genuinely different box (a re-layout the gate then measures).
  for (const [turn, next] of [true, false, true].entries()) {
    box.width = 800 + (turn + 1) * 80;
    setPosture(next);
    flush();
  }

  expect(takeSolidDiagnostics()).toEqual([]);
  // The pin only means something if the door actually MOVED: a measurement that
  // stays null writes nothing and so can never relay. At least one real grid,
  // and the gate ends up shown with it.
  expect(seen.filter((facts) => facts.wanted !== null)).not.toEqual([]);
  expect(seen.at(-1)?.shown).toBe(true);
});
