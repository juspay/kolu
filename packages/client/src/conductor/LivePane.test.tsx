// @vitest-environment happy-dom
/**
 * THE ONE PRESS READS THE TERMINAL'S RECORD, NOT THE DRAWN SCREEN.
 *
 * While the person reads scrolled back, a resize waits behind the scroll lock,
 * so the screen can still be drawn at the old size after the terminal itself
 * has taken the size the pane asked for. Offering **Resize to fit** off the
 * drawn size would then offer a press the terminal does not need. The pane
 * hands the offer the record's size (`LivePane.tsx`, `resizeOffer.ts`); this
 * pins that binding with the screen and the record disagreeing both ways.
 *
 * Everything around the pane is a stand-in: the screen reports a drawn size
 * and a measured cell, the body has a fixed box, and the record states its
 * own size — from a STORE, as the fleet index holds it, so a resize merged
 * into the record in place is a case this file can drive.
 */

import type { TerminalGrid } from "@kolu/xterm-kit/solid";
import type { WorkRole } from "kolu-work";
import type { TerminalId } from "kolu-common/surface";
import { createSignal, createStore, flush, reconcile } from "solid-js";
import { render } from "@solidjs/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FleetTerminalStanding } from "../palette/fleetTerminals";
import { Shown } from "../ui/shown";
import { DEFAULT_FONT_SIZE } from "terminal-themes";
import { fitFontSize } from "./peek/peekSize";

const ID = "11111111-1111-4111-8111-111111111111" as TerminalId;

const seam = vi.hoisted(() => ({
  /** Whether the host's `lifecycle.resize` refuses the publish. */
  resizeFails: false,
  /** The size the stand-in screen says it is drawn at. */
  drawn: { cols: 80, rows: 24 } as { cols: number; rows: number },
  /** Report another cell measurement, as the screen does on every render. */
  report: undefined as
    | ((
        c: { width: number; height: number },
        p: { x: number; y: number },
      ) => void)
    | undefined,
  /** Report another drawn size, as the screen does when the stream resizes
   *  it — the sibling of `report` in the SAME dispatch. */
  reportGrid: undefined as
    | ((g: { cols: number; rows: number }) => void)
    | undefined,
}));

/** THE RECORD IS A STORE, as the fleet index's is: padi's metadata rides a
 *  subscription store and is reconciled leaf by leaf, so a resize somebody
 *  else asked for moves `grid.cols` in place and mints no new record. The
 *  standing AROUND it is minted per read, as the index mints it. */
const [meta, setMeta] = createStore<{
  state: "active";
  foreground: null;
  agent: null;
  grid: TerminalGrid;
}>({
  state: "active",
  foreground: null,
  agent: null,
  grid: { cols: 0, rows: 0 },
});
const [kind, setKind] = createSignal<FleetTerminalStanding["kind"]>("gone");
const standing = (): FleetTerminalStanding => {
  const now = kind();
  return now === "here"
    ? ({ kind: "here", meta } as unknown as FleetTerminalStanding)
    : ({ kind: now } as FleetTerminalStanding);
};
const recordAt = (grid: TerminalGrid) => ({ kind: "here" as const, grid });
/** How the terminal stands now — a record stated afresh, size and all. */
const setStanding = (
  next:
    | { kind: "here"; grid: TerminalGrid }
    | { kind: "gone" | "loading" | "unreachable" },
): void => {
  // RECONCILED, as the fleet index states a record: the leaves that moved
  // are the ones that notify, and the record object survives.
  if (next.kind === "here")
    setMeta(
      reconcile({
        state: "active" as const,
        foreground: null,
        agent: null,
        grid: { ...next.grid },
      }),
    );
  setKind(next.kind);
};
/** THE SAME RECORD, RESIZED IN PLACE: its leaves move and the record itself
 *  does not — what the fleet index's `reconcile` does when the PTY takes a
 *  size somebody else asked for. */
const resizeRecord = (grid: TerminalGrid): void => {
  setMeta((draft) => {
    draft.grid.cols = grid.cols;
    draft.grid.rows = grid.rows;
  });
};

vi.mock("../palette/fleetTerminals", () => ({
  fleetTerminalStanding: () => standing(),
}));
// The pane's body: 1374×900, which a 8.4×17 cell inside 26×12 of padding
// fills at 160×52 (`paneSize.test.ts`).
vi.mock("@solid-primitives/resize-observer", () => ({
  createElementSize: () => ({ width: 1374, height: 900 }),
}));
vi.mock("./peek/PeekTerminal", async () => {
  // Hoisted factory: the import cannot be static here.
  const { createEffect, createSignal, onSettled, untrack } = await import(
    "solid-js"
  );
  return {
    default: (props: {
      fontSize: number;
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
      // xterm's render callback synchronously. That is a strict-read window,
      // so a report that reads the pane's own state is a diagnostic.
      const pending: Array<() => void> = [];
      const [tick, setTick] = createSignal(0);
      createEffect(
        () => tick(),
        () => {
          // In the order they were made, as one dispatch's renders are.
          while (pending.length > 0) pending.shift()?.();
        },
      );
      const fromApplyArm = (run: () => void) => {
        pending.push(run);
        setTick((n) => n + 1);
      };
      seam.report = (c, p) => {
        // The font the screen is drawn at right now — read here, outside the
        // window, exactly as the real screen reads `terminal.options`.
        const drawn = props.fontSize;
        fromApplyArm(() => props.onCell(c, p, drawn));
      };
      seam.reportGrid = (g) => fromApplyArm(() => props.onGrid(g));
      onSettled(() => {
        // A POINT-IN-TIME SAMPLE: the font the first draw was made at, which
        // is the pane's opening font.
        const drawn = untrack(() => props.fontSize);
        props.onCell({ width: 8.4, height: 17 }, { x: 26, y: 12 }, drawn);
        props.onGrid(seam.drawn);
        props.onPhase("live");
      });
      // The font the pane hands the screen, where a test can read it back.
      return <div data-testid="live-screen" data-font={props.fontSize} />;
    },
  };
});
const toastSpy = { error: vi.fn() };
vi.mock("solid-sonner", () => ({
  toast: Object.assign(() => {}, {
    loading: () => 0,
    success: () => {},
    error: (...a: unknown[]) => toastSpy.error(...a),
    warning: () => {},
    info: () => {},
  }),
}));
vi.mock("../wire", async () => {
  const { Effect } = await import("effect");
  return {
    padiMap: { entry: () => ({ state: () => ({ kind: "connected" }) }) },
    padiRpcOf: () => ({
      lifecycle: {
        resize: () =>
          seam.resizeFails
            ? Effect.fail(new Error("the PTY is gone"))
            : Effect.void,
      },
    }),
  };
});
// A phone's pane, so the pane itself never publishes and only the offer
// speaks.
vi.mock("../useMobile", () => ({
  isDesktop: () => false,
  isTouch: () => false,
}));
vi.mock("./useWorks", () => ({
  useMembership: () => () => new Map(),
  useSeen: () => () => new Map(),
}));
vi.mock("./useConductor", () => ({
  useConductor: () => ({ takeOver() {}, handBack() {} }),
}));
vi.mock("./memberNames", () => ({ useMemberName: () => () => "pane" }));
vi.mock("./personInput", () => ({ inputAllowedAt: () => false }));
vi.mock("./useOpenTile", () => ({ useOpenTile: () => () => {} }));
vi.mock("./workListing", () => ({ inspectMember: () => {} }));
vi.mock("./WorkLock", () => ({ default: () => null }));
vi.mock("./peek/usePeek", () => ({ peekTarget: () => null }));
// The head's pip reads attention off each host's frame; nothing here asks.
vi.mock("../attention/useAttentionFacts", () => ({
  useAttentionFacts: () => ({
    attentionOf: () => ({ klass: "idle" as const, live: false }),
  }),
}));

import LivePane from "./LivePane";

const SETTLE = 750;
const ASKED = { cols: 160, rows: 52 };
const OLD = { cols: 80, rows: 24 };
/** Wider than the pane's body can draw at the base font. */
const WIDE = { cols: 212, rows: 52 };

let dispose: (() => void) | undefined;
/** The member's part in the work — the pane's `role` prop, not an ARIA one. */
const IMPLEMENTOR: WorkRole = "implementor";

function mount(): HTMLElement {
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
      </Shown>
    ),
    root,
  );
  dispose = () => {
    stop();
    root.remove();
  };
  return root;
}

const press = (el: HTMLElement) =>
  el.querySelector('[data-testid="live-resize"]');

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.useRealTimers();
});

describe("the Resize to fit offer", () => {
  it("is not offered when the record is at the pane's size, though the screen still draws the old one", () => {
    seam.drawn = OLD;
    setStanding(recordAt(ASKED));
    const el = mount();
    vi.advanceTimersByTime(SETTLE * 2);
    flush();
    expect(press(el)).toBeNull();
  });

  it("is offered when the record is not at the pane's size, though the screen draws it", () => {
    seam.drawn = ASKED;
    setStanding(recordAt(OLD));
    const el = mount();
    vi.advanceTimersByTime(SETTLE * 2);
    flush();
    expect(press(el)).not.toBeNull();
  });

  it("is offered when the record is resized in place, minting no new record", () => {
    // The pane and the terminal agree, so nothing is offered.
    seam.drawn = ASKED;
    setStanding(recordAt(ASKED));
    const el = mount();
    vi.advanceTimersByTime(SETTLE * 2);
    flush();
    expect(press(el)).toBeNull();

    // Somebody else resizes the PTY: the record's own `cols`/`rows` move and
    // the record object does not. The pane must still notice.
    resizeRecord(OLD);
    flush();
    vi.advanceTimersByTime(SETTLE * 2);
    flush();
    expect(press(el)).not.toBeNull();
  });
});

/** The font the pane handed its screen, as the stand-in drew it. */
const fontOf = (el: HTMLElement): string | null =>
  el.querySelector('[data-testid="live-screen"]')?.getAttribute("data-font") ??
  null;

describe("the base cell the pane sizes from", () => {
  it("keeps the base cell when the screen reports a cell it drew shrunken", () => {
    seam.drawn = OLD;
    setStanding(recordAt(OLD));
    const el = mount();
    flush();
    // The first report is the base one: nothing is shrinking 80 columns of
    // an 8.4px cell inside 1374px of body.
    expect(fontOf(el)).toBe(String(DEFAULT_FONT_SIZE));

    // A far wider grid, and the pane shrinks its font to fit it.
    seam.reportGrid?.(WIDE);
    flush();
    const shrunk = fitFontSize({
      cols: WIDE.cols,
      cellWidth: 8.4,
      fontSize: DEFAULT_FONT_SIZE,
      availWidth: 1374,
      padX: 26,
    });
    expect(fontOf(el)).toBe(String(shrunk));

    // The screen redraws at THAT font and reports the smaller cell it drew.
    // It is not the base cell, so the pane keeps sizing from 8.4.
    seam.report?.({ width: 7, height: 14 }, { x: 26, y: 12 });
    flush();
    expect(fontOf(el)).toBe(String(shrunk));
  });

  it("takes a cell drawn at the base font, though the grid widened in the same dispatch", () => {
    seam.drawn = OLD;
    setStanding(recordAt(OLD));
    const el = mount();
    flush();
    expect(fontOf(el)).toBe(String(DEFAULT_FONT_SIZE));

    // ONE DISPATCH, as the screen makes it: the stream states a far wider
    // grid, xterm redraws for it — still at the base font, which it keeps
    // until the pane's next font prop lands — and reports the cell. Drawn at
    // the base font, so it IS the base cell, and the pane sizes from it.
    seam.reportGrid?.(WIDE);
    seam.report?.({ width: 7, height: 14 }, { x: 26, y: 12 });
    flush();
    expect(fontOf(el)).toBe(
      String(
        fitFontSize({
          cols: WIDE.cols,
          cellWidth: 7,
          fontSize: DEFAULT_FONT_SIZE,
          availWidth: 1374,
          padX: 26,
        }),
      ),
    );
  });
});

describe("the screen the pane holds", () => {
  it("keeps its screen and its readout while the index cannot vouch for the terminal", () => {
    seam.drawn = OLD;
    setStanding(recordAt(OLD));
    const el = mount();
    flush();
    const screen = () => el.querySelector('[data-testid="live-screen"]');
    const readout = () => el.querySelector('[data-testid="live-live"]');
    const wasScreen = screen();
    const wasReadout = readout();
    expect(wasScreen).not.toBeNull();
    expect(wasReadout).not.toBeNull();

    // ONE FRAME IN WHICH THE INDEX CANNOT VOUCH — a per-key view that has
    // not had its first frame, or a host still adopting its census. It is
    // not an answer that there is no screen, and the reader's place must
    // survive it: the SAME xterm, under the same head.
    setStanding({ kind: "loading" });
    flush();
    expect(screen()).toBe(wasScreen);
    expect(readout()).toBe(wasReadout);

    setStanding(recordAt(OLD));
    flush();
    expect(screen()).toBe(wasScreen);
    expect(readout()).toBe(wasReadout);
  });

  it("drops the screen when the terminal is answered for and gone", () => {
    seam.drawn = OLD;
    setStanding(recordAt(OLD));
    const el = mount();
    flush();
    expect(el.querySelector('[data-testid="live-screen"]')).not.toBeNull();

    setStanding({ kind: "gone" });
    flush();
    expect(el.querySelector('[data-testid="live-screen"]')).toBeNull();
    expect(el.querySelector('[data-testid="live-live"]')).toBeNull();
  });

  it("tears the screen down, with its host's words, when the host is not connected", () => {
    seam.drawn = OLD;
    setStanding(recordAt(OLD));
    const el = mount();
    flush();
    expect(el.querySelector('[data-testid="live-screen"]')).not.toBeNull();

    // AN ANSWER, not a silence: the client's own host map says this host is
    // down, and it stays down for as long as the outage. Master tore the
    // screen down and said so, and the head dropped its readouts; keeping a
    // dead xterm up would leave the key bar sending keys to a host that is
    // gone.
    setStanding({ kind: "unreachable" });
    flush();
    expect(el.querySelector('[data-testid="live-screen"]')).toBeNull();
    expect(el.querySelector('[data-testid="live-live"]')).toBeNull();
    expect(el.querySelector('[data-testid="live-grid"]')).toBeNull();
    expect(el.textContent).toContain("its host is not connected");
    expect(el.textContent).toContain("There is no screen to show.");
    expect(el.querySelector("[data-connected]")).toBeNull();
  });
});

describe("the grid publish's liveness guard", () => {
  /** Offer the one press, then take it: the pane publishes the size it would
   *  ask for, and the stand-in host refuses it. */
  const pressResize = (el: HTMLElement) => {
    vi.advanceTimersByTime(SETTLE * 2);
    flush();
    const button = el.querySelector<HTMLButtonElement>(
      '[data-testid="live-resize"]',
    );
    expect(button).not.toBeNull();
    button?.click();
    flush();
  };

  it("raises no resize toast for a terminal whose record has left, though the pane still holds its screen", async () => {
    toastSpy.error.mockReset();
    seam.drawn = OLD;
    seam.resizeFails = true;
    setStanding(recordAt(OLD));
    const el = mount();
    flush();
    pressResize(el);

    // THE EXIT RACE (`publishGrid.ts`): the record has left and the roster
    // has not folded yet, so the index cannot say — and the PTY this publish
    // is aimed at is already gone. The held gate still draws the screen; the
    // publish's guard must read the INSTANTANEOUS arm, or the failure the
    // exit itself caused becomes a red toast master never raised.
    setStanding({ kind: "loading" });
    flush();
    vi.advanceTimersByTime(SETTLE);
    await Promise.resolve();
    expect(el.querySelector('[data-testid="live-screen"]')).not.toBeNull();
    expect(toastSpy.error).not.toHaveBeenCalled();
    seam.resizeFails = false;
  });

  it("raises the resize toast while the terminal is there", async () => {
    toastSpy.error.mockReset();
    seam.drawn = OLD;
    seam.resizeFails = true;
    setStanding(recordAt(OLD));
    const el = mount();
    flush();
    pressResize(el);
    vi.advanceTimersByTime(SETTLE);
    await Promise.resolve();
    expect(toastSpy.error).toHaveBeenCalledTimes(1);
    seam.resizeFails = false;
  });
});
