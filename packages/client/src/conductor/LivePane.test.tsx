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
import { createSignal } from "solid-js";
import { render } from "@solidjs/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FleetTerminalStanding } from "../palette/fleetTerminals";
import { Shown } from "../ui/shown";

const ID = "11111111-1111-4111-8111-111111111111" as TerminalId;

const seam = vi.hoisted(() => ({
  /** The size the stand-in screen says it is drawn at. */
  drawn: { cols: 80, rows: 24 } as { cols: number; rows: number },
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
      onGrid: (g: TerminalGrid) => void;
      onCell: (
        c: { width: number; height: number },
        p: { x: number; y: number },
      ) => void;
      onPhase: (p: "live") => void;
    }) => {
      onSettled(() => {
        props.onCell({ width: 8.4, height: 17 }, { x: 26, y: 12 });
        props.onGrid(seam.drawn);
        props.onPhase("live");
      });
      return <div data-testid="live-screen" />;
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
    expect(press(el)).toBeNull();
  });

  it("is offered when the record is not at the pane's size, though the screen draws it", () => {
    seam.drawn = ASKED;
    setStanding(recordAt(OLD));
    const el = mount();
    vi.advanceTimersByTime(SETTLE * 2);
    expect(press(el)).not.toBeNull();
  });
});
