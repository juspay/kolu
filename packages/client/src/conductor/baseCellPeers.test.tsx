// @vitest-environment happy-dom
/**
 * TWO VIEWS OF ONE TERMINAL, EACH LATCHING ITS OWN BASE CELL.
 *
 * A live pane and the peek window can be up on the SAME terminal at once,
 * and both hand the screen an `onCell` callback. The report runs in one
 * direction only — the screen calls UP into the view that mounted it, and
 * the view reads nothing back out of the screen — so two peers of one
 * terminal cannot drive each other, in either order.
 *
 * The base cell is a CAPTURED INPUT: a measurement kept past the dispatch it
 * arrived in. It is keyed to the screen that produced it by the component
 * that owns it — the pane for its terminal, and the peek's keyed
 * `<Show when={peekTarget()} keyed>` for the terminal in the window — so a
 * peek moved to another terminal starts with no cell of the previous one.
 */

import type { TerminalGrid } from "@kolu/xterm-kit/solid";
import type { WorkRole } from "kolu-work";
import type { TerminalId } from "kolu-common/surface";
import { flush } from "solid-js";
import { render } from "@solidjs/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FleetTerminalStanding } from "../palette/fleetTerminals";
import { Shown } from "../ui/shown";
import { DEFAULT_FONT_SIZE } from "terminal-themes";
import { fitFontSize } from "./peek/peekSize";
import { closePeek, openPeek } from "./peek/usePeek";
import { setFitWidth } from "./fitWidth";

const ID = "11111111-1111-4111-8111-111111111111" as TerminalId;
const OTHER = "22222222-2222-4222-8222-222222222222" as TerminalId;
const WIDE = { cols: 212, rows: 52 };
const IMPLEMENTOR: WorkRole = "implementor";

type Screen = {
  /** The font this screen is drawn at, as the view last handed it. */
  font: () => number;
  /** Report a measurement, from the apply arm the real screen reports in. */
  report: (
    c: { width: number; height: number },
    p: { x: number; y: number },
  ) => void;
  /** State a size, the sibling of `report` in the same dispatch. */
  reportGrid: (g: TerminalGrid) => void;
};

const seam = vi.hoisted(() => ({
  screens: new Map<string, unknown>(),
}));
const screenAt = (testId: string): Screen => {
  const screen = seam.screens.get(testId);
  if (screen === undefined) throw new Error(`no ${testId} is mounted`);
  return screen as Screen;
};

vi.mock("./peek/PeekTerminal", async () => {
  // Hoisted factory: the import cannot be static here.
  const { createEffect, createSignal, onCleanup } = await import("solid-js");
  return {
    default: (props: {
      fontSize: number;
      testId: string;
      onGrid: (g: TerminalGrid) => void;
      onCell: (
        c: { width: number; height: number },
        p: { x: number; y: number },
        drawnFont: number | undefined,
      ) => void;
      onPhase: (p: "live") => void;
    }) => {
      // THE REPORTS ARRIVE FROM AN EFFECT'S APPLY ARM, as the real screen's
      // do: the attach effect's apply arm resizes the screen, which re-enters
      // xterm's render callback synchronously.
      const pending: Array<() => void> = [];
      const [tick, setTick] = createSignal(0);
      createEffect(
        () => tick(),
        () => {
          while (pending.length > 0) pending.shift()?.();
        },
      );
      const fromApplyArm = (run: () => void) => {
        pending.push(run);
        setTick((n) => n + 1);
      };
      const mine: Screen = {
        font: () => props.fontSize,
        report: (c, p) => {
          const drawn = props.fontSize;
          fromApplyArm(() => props.onCell(c, p, drawn));
        },
        reportGrid: (g: TerminalGrid) => fromApplyArm(() => props.onGrid(g)),
      };
      seam.screens.set(props.testId, mine);
      // A window moved to another terminal mints its successor BEFORE this
      // one is torn down, so only the screen still registered is removed.
      onCleanup(() => {
        if (seam.screens.get(props.testId) === mine)
          seam.screens.delete(props.testId);
      });
      return <div data-testid={props.testId} data-font={props.fontSize} />;
    },
  };
});

/** Both views are of one live terminal, and it stands still here: what moves
 *  in these cases is what each screen reports. */
const STANDING: FleetTerminalStanding = {
  kind: "here",
  meta: {
    state: "active",
    foreground: null,
    agent: null,
    grid: { cols: 80, rows: 24 },
  } as never,
};
vi.mock("../palette/fleetTerminals", () => ({
  fleetTerminalStanding: () => STANDING,
}));
// The pane's body, and the window's.
vi.mock("@solid-primitives/resize-observer", () => ({
  createElementSize: () => ({ width: 1374, height: 900 }),
  createWindowSize: () => ({ width: 1440, height: 900 }),
}));
vi.mock("../useMobile", () => ({
  isDesktop: () => false,
  isTouch: () => false,
  layoutMode: () => "desktop",
}));
vi.mock("../wire", async () => {
  // Hoisted factory: the import cannot be static here.
  const { Effect } = await import("effect");
  return {
    padiMap: { entry: () => ({ state: () => ({ kind: "connected" }) }) },
    padiRpcOf: () => ({ lifecycle: { resize: () => Effect.void } }),
  };
});
vi.mock("solid-sonner", () => ({
  toast: Object.assign(() => {}, {
    loading: () => 0,
    success: () => {},
    error: () => {},
    warning: () => {},
    info: () => {},
  }),
}));
vi.mock("./useWorks", () => ({
  useMembership: () => () => new Map(),
  useSeen: () => () => new Map(),
  useWorkMembers: () => () => new Map(),
}));
vi.mock("./useConductor", () => ({
  useConductor: () => ({ takeOver() {}, handBack() {} }),
}));
vi.mock("./memberNames", () => ({ useMemberName: () => () => "member" }));
vi.mock("./personInput", () => ({
  inputAllowedAt: () => false,
  personInputAt: () => false,
}));
vi.mock("./useOpenTile", () => ({ useOpenTile: () => () => {} }));
vi.mock("./workListing", () => ({ inspectMember: () => {} }));
vi.mock("./WorkLock", () => ({ default: () => null }));
vi.mock("../attention/useAttentionFacts", () => ({
  useAttentionFacts: () => ({
    attentionOf: () => ({ klass: "idle" as const, live: false }),
  }),
}));
vi.mock("../ui/ModalDialog", () => ({
  default: (props: { children: unknown }) => (
    <div>{props.children as never}</div>
  ),
}));
vi.mock("@corvu-next/dialog", () => ({
  default: { Content: (props: Record<string, unknown>) => <div {...props} /> },
}));

import LivePane from "./LivePane";
import TerminalPeek from "./peek/TerminalPeek";

let dispose: (() => void) | undefined;
/** The pane and the window, both up on the same terminal. */
const mountBoth = (): void => {
  const root = document.createElement("div");
  document.body.append(root);
  const stop = render(
    () => (
      <Shown value={() => true}>
        <LivePane
          host="local"
          id={ID}
          role={IMPLEMENTOR}
          connected={true}
          height="600px"
        />
        <TerminalPeek />
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
  closePeek();
  dispose?.();
  dispose = undefined;
  seam.screens.clear();
  setFitWidth(true);
});

describe("a pane and a peek of one terminal", () => {
  it("each latch their own base cell, in either order and with no cycle", () => {
    setFitWidth(true);
    openPeek({ host: "local", id: ID });
    mountBoth();
    flush();
    expect(screenAt("live-screen").font()).toBe(DEFAULT_FONT_SIZE);
    expect(screenAt("peek-screen").font()).toBe(DEFAULT_FONT_SIZE);

    // The PANE's screen alone states a far wider grid and reports the cell it
    // drew at the base font.
    screenAt("live-screen").reportGrid(WIDE);
    screenAt("live-screen").report({ width: 7, height: 14 }, { x: 26, y: 12 });
    flush();
    const paneFont = fitFontSize({
      cols: WIDE.cols,
      cellWidth: 7,
      fontSize: DEFAULT_FONT_SIZE,
      availWidth: 1374,
      padX: 26,
    });
    expect(screenAt("live-screen").font()).toBe(paneFont);
    // The window heard nothing: the report goes UP into the view that
    // mounted the screen, and no further.
    expect(screenAt("peek-screen").font()).toBe(DEFAULT_FONT_SIZE);

    // Now the WINDOW's screen, with its own measurement.
    screenAt("peek-screen").reportGrid(WIDE);
    screenAt("peek-screen").report(
      { width: 8.4, height: 17 },
      { x: 26, y: 12 },
    );
    flush();
    expect(screenAt("peek-screen").font()).toBe(
      fitFontSize({
        cols: WIDE.cols,
        cellWidth: 8.4,
        fontSize: DEFAULT_FONT_SIZE,
        // The window is 1280 wide, less the border it draws.
        availWidth: 1278,
        padX: 26,
      }),
    );
    expect(screenAt("live-screen").font()).toBe(paneFont);

    // Settled: a further flush moves neither, so neither peer is feeding the
    // other.
    flush();
    expect(screenAt("live-screen").font()).toBe(paneFont);
  });

  it("gives the window no cell of the terminal it was moved off", () => {
    setFitWidth(true);
    openPeek({ host: "local", id: ID });
    mountBoth();
    flush();
    screenAt("peek-screen").reportGrid(WIDE);
    screenAt("peek-screen").report(
      { width: 8.4, height: 17 },
      { x: 26, y: 12 },
    );
    flush();
    expect(screenAt("peek-screen").font()).not.toBe(DEFAULT_FONT_SIZE);

    // Another terminal in the window: a window of its own, with no cell and
    // no size until its own screen reports.
    openPeek({ host: "local", id: OTHER });
    flush();
    expect(screenAt("peek-screen").font()).toBe(DEFAULT_FONT_SIZE);
  });
});
