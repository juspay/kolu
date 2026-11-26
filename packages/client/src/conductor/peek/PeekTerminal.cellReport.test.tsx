// @vitest-environment happy-dom
/**
 * THE CELL REPORT CARRIES THE FONT IT WAS DRAWN AT.
 *
 * A view latches its BASE cell — what one character takes when the screen is
 * drawn at the base font — from these reports, and a report is made inside
 * xterm's render callback, which the screen's own resize re-enters from an
 * effect's apply arm. Nothing there may read the view's own state, so the
 * screen states the font it drew at and the view judges the measurement by
 * it rather than re-deriving one.
 */

import type { TerminalId } from "kolu-common/surface";
import { createSignal } from "solid-js";
import { render } from "@solidjs/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Shown } from "../../ui/shown";
import type { PeekCell, PeekPad } from "./peekSize";

const ID = "11111111-1111-4111-8111-111111111111" as TerminalId;

const seam = vi.hoisted(() => ({
  /** xterm's own render callback, as the screen subscribed to it. */
  rendered: undefined as (() => void) | undefined,
  /** The terminal's options bag — the font it is drawn at lives here. */
  options: { fontSize: 14 } as { fontSize: number | undefined },
  /** What the renderer measured one cell at, in CSS pixels. */
  cell: { width: 8.4, height: 17 },
  reports: [] as Array<{
    cell: PeekCell;
    pad: PeekPad;
    drawnFont: number | undefined;
  }>,
}));

vi.mock("../../wire", async () => {
  // Hoisted factory: the import cannot be static here.
  const { Effect } = await import("effect");
  return {
    padiMap: {
      useEntry: () => ({
        streams: { terminalAttach: { unenrolled: { name: "terminalAttach" } } },
      }),
    },
    padiRpcOf: () => ({
      lifecycle: { sendInput: () => Effect.void },
    }),
    preferences: () => ({ scrollLock: true }),
  };
});

vi.mock("@kolu/surface/client", async () => {
  // Hoisted factory: the import cannot be static here.
  const { Stream } = await import("effect");
  return { unenrolledStreamCall: () => Stream.never };
});

vi.mock("@kolu/xterm-kit/solid", async () => {
  // Hoisted factory: the import cannot be static here.
  const { createSignal } = await import("solid-js");
  const [locked, setLocked] = createSignal(false);
  const handle = {
    container: document.createElement("div"),
    terminal: {
      reset() {},
      focus() {},
      blur() {},
      textarea: document.createElement("textarea"),
      get options() {
        return seam.options;
      },
      get dimensions() {
        return { css: { cell: seam.cell } };
      },
      onRender: (fn: () => void) => {
        seam.rendered = fn;
        return { dispose() {} };
      },
      attachCustomKeyEventHandler: () => {},
    },
    resize: () => {},
    write: (_data: string, parsed?: () => void) => parsed?.(),
    clearPendingOutput() {},
    scrollLock: { reset: () => setLocked(false), isLocked: () => locked() },
    recovery: { noteData() {} },
  };
  return {
    // The pad the screen reports: 20 + 6 across, 12 down.
    measureGridBox: () => ({
      paddingHorizontal: 20,
      paddingVertical: 12,
      scrollbarWidth: 6,
    }),
    Xterm: (props: { onReady: (h: unknown) => void }) => {
      props.onReady(handle);
      return <div data-testid="peek-screen" />;
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

const [fontSize, setFontSize] = createSignal(14);

let dispose: (() => void) | undefined;
const mount = (): void => {
  const root = document.createElement("div");
  document.body.append(root);
  const stop = render(
    () => (
      <Shown value={() => true}>
        <PeekTerminal
          host="remote:nix@example"
          id={ID}
          fontSize={fontSize()}
          mayType={() => false}
          onGrid={() => {}}
          onCell={(cell, pad, drawnFont) =>
            seam.reports.push({ cell, pad, drawnFont })
          }
          onPhase={() => {}}
          onHeld={() => {}}
          onFocus={() => {}}
          onHandle={() => {}}
          testId="peek-screen"
        />
      </Shown>
    ),
    root,
  );
  dispose = () => {
    stop();
    root.remove();
  };
};

afterEach(() => {
  dispose?.();
  dispose = undefined;
  seam.rendered = undefined;
  seam.reports = [];
  seam.cell = { width: 8.4, height: 17 };
  seam.options = { fontSize: 14 };
  setFontSize(14);
});

describe("the screen's cell report", () => {
  it("states the font the measurement was drawn at", () => {
    mount();
    seam.rendered?.();
    expect(seam.reports).toEqual([
      {
        cell: { width: 8.4, height: 17 },
        pad: { x: 26, y: 12 },
        drawnFont: 14,
      },
    ]);
  });

  it("states the SHRUNKEN font when the screen redraws at one", () => {
    mount();
    seam.rendered?.();
    // Fit width shrinks the font: xterm redraws, measures a smaller cell,
    // and holds the font it drew it at.
    seam.options.fontSize = 9;
    seam.cell = { width: 5.4, height: 11 };
    seam.rendered?.();
    expect(seam.reports.at(-1)).toEqual({
      cell: { width: 5.4, height: 11 },
      pad: { x: 26, y: 12 },
      drawnFont: 9,
    });
  });

  it("says nothing when a render changes neither the cell nor the pad", () => {
    mount();
    seam.rendered?.();
    seam.rendered?.();
    expect(seam.reports).toHaveLength(1);
  });
});
