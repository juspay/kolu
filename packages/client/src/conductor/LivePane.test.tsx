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
  /** The size the stand-in screen says it is drawn at. */
  drawn: { cols: 80, rows: 24 } as { cols: number; rows: number },
  /** Report another cell measurement, as the screen does on every render. */
  report: undefined as
    | ((
        c: { width: number; height: number },
        p: { x: number; y: number },
      ) => void)
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
vi.mock("../wire", async () => {
  const { Effect } = await import("effect");
  return {
    padiMap: { entry: () => ({ state: () => ({ kind: "connected" }) }) },
    padiRpcOf: () => ({ lifecycle: { resize: () => Effect.void } }),
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
});
