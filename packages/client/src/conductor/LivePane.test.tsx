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
 * own size.
 */

import type { TerminalGrid } from "@kolu/xterm-kit/solid";
import type { WorkRole } from "kolu-work";
import type { TerminalId } from "kolu-common/surface";
import { createSignal, flush } from "solid-js";
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

const [standing, setStanding] = createSignal<FleetTerminalStanding>({
  kind: "gone",
} as never);
const recordAt = (grid: TerminalGrid): FleetTerminalStanding => ({
  kind: "here",
  meta: { state: "active", foreground: null, agent: null, grid } as never,
});

vi.mock("../palette/fleetTerminals", () => ({
  fleetTerminalStanding: () => standing(),
}));
// The pane's body: 1374×900, which a 8.4×17 cell inside 26×12 of padding
// fills at 160×52 (`paneSize.test.ts`).
vi.mock("@solid-primitives/resize-observer", () => ({
  createElementSize: () => ({ width: 1374, height: 900 }),
}));
vi.mock("./peek/PeekTerminal", async () => {
  const { onSettled } = await import("solid-js");
  return {
    default: (props: {
      fontSize: number;
      onGrid: (g: TerminalGrid) => void;
      onCell: (
        c: { width: number; height: number },
        p: { x: number; y: number },
      ) => void;
      onPhase: (p: "live") => void;
    }) => {
      seam.report = (c, p) => props.onCell(c, p);
      seam.reportGrid = (g) => props.onGrid(g);
      onSettled(() => {
        props.onCell({ width: 8.4, height: 17 }, { x: 26, y: 12 });
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
});

/** The font the pane handed its screen, as the stand-in drew it. */
const fontOf = (el: HTMLElement): string | null =>
  el.querySelector('[data-testid="live-screen"]')?.getAttribute("data-font") ??
  null;

describe("the base cell the pane sizes from", () => {
  it("keeps the base cell when a report is drawn at a shrunken font", () => {
    seam.drawn = OLD;
    setStanding(recordAt(OLD));
    const el = mount();
    flush();
    // The first report is the base one: nothing is shrinking 80 columns of
    // an 8.4px cell inside 1374px of body.
    expect(fontOf(el)).toBe(String(DEFAULT_FONT_SIZE));

    // The screen reports a smaller cell inside far more padding. At THAT pad
    // Fit width is drawing below the base font, so the cell is not the base
    // one and must not be latched as it — the pane keeps sizing from 8.4.
    seam.report?.({ width: 7, height: 14 }, { x: 1000, y: 12 });
    flush();
    expect(fontOf(el)).toBe(
      String(
        fitFontSize({
          cols: OLD.cols,
          cellWidth: 8.4,
          fontSize: DEFAULT_FONT_SIZE,
          availWidth: 1374,
          padX: 1000,
        }),
      ),
    );
  });

  it("judges the report against the grid the same dispatch reported", () => {
    seam.drawn = OLD;
    setStanding(recordAt(OLD));
    const el = mount();
    flush();
    expect(fontOf(el)).toBe(String(DEFAULT_FONT_SIZE));

    // ONE DISPATCH, as the screen makes it: the stream states a far wider
    // grid, and the render that follows reports the cell it was drawn at.
    // At 212 columns of 8.4px the pane is already drawing below the base
    // font, so the 7px cell is NOT the base one — judged against the grid
    // just reported, not the one before it, which is still staged.
    seam.reportGrid?.(WIDE);
    seam.report?.({ width: 7, height: 14 }, { x: 300, y: 12 });
    flush();
    expect(fontOf(el)).toBe(
      String(
        fitFontSize({
          cols: WIDE.cols,
          cellWidth: 8.4,
          fontSize: DEFAULT_FONT_SIZE,
          availWidth: 1374,
          padX: 300,
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
