// @vitest-environment happy-dom
/**
 * A TERMINAL'S HEAD — what it offers, and in a live pane, that it keeps one
 * height.
 *
 * THE FIT WIDTH BUTTON. With the choice on by default, a terminal that already
 * fits must not offer the button: pressing it would turn the choice off for
 * every pane and then disappear from this one, leaving no way back here. The
 * button belongs to a terminal that pans at its own size, whatever the choice
 * says.
 *
 * THE FACTS ROW. A desktop pane sizes its terminal from the body under its
 * head, so a head that grew a row when an agent started would resize the
 * terminal as the agent starts and again when it quits. In a live pane the
 * row is there with an agent and without.
 *
 * THE ONE PRESS. In a live pane the size readout becomes a button while the
 * pane offers it (when is `conductor/resizeOffer.ts`'s call). Never in Look.
 */

import type { TerminalGrid } from "@kolu/xterm-kit/solid";
import type { TerminalId } from "kolu-common/surface";
import { createSignal } from "solid-js";
import { render } from "@solidjs/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FleetTerminalStanding } from "../../palette/fleetTerminals";
import { Shown } from "../../ui/shown";
import {
  type HeadKind,
  TerminalControls,
  TerminalStatusLine,
} from "./TerminalHead";

const ID = "00000000-0000-4000-8000-000000000001" as TerminalId;

/** A live terminal as its record states it: an agent or none, a grid or
 *  none. */
const here = (opts: {
  agent: boolean;
  grid?: TerminalGrid;
}): FleetTerminalStanding => ({
  kind: "here",
  meta: {
    state: "active",
    foreground: null,
    agent: opts.agent
      ? {
          kind: "claude-code",
          state: "thinking",
          summary: "writing the plan",
          taskProgress: null,
        }
      : null,
    ...(opts.grid ? { grid: opts.grid } : {}),
  } as never,
});

const [standing, setStanding] = createSignal<FleetTerminalStanding>(
  here({ agent: false }),
);

vi.mock("../../palette/fleetTerminals", () => ({
  fleetTerminalStanding: () => standing(),
}));
vi.mock("../useWorks", () => ({
  useSeen: () => () => new Map(),
}));
vi.mock("../useConductor", () => ({
  useConductor: () => ({ takeOver() {}, handBack() {} }),
}));

let dispose: (() => void) | undefined;
let root: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  root?.remove();
  dispose = undefined;
  root = undefined;
  setStanding(here({ agent: false }));
});

function mountControls(pans: boolean, fit: boolean): HTMLElement {
  root = document.createElement("div");
  document.body.append(root);
  dispose = render(
    () => (
      <TerminalControls
        kind="live"
        host="local"
        id={ID}
        pans={pans}
        fit={fit}
        onFit={() => {}}
        onOpenTile={() => {}}
      />
    ),
    root,
  );
  return root;
}

function mountStatus(opts: {
  kind: HeadKind;
  drawn?: TerminalGrid;
  /** The ONE gate, as the view that owns the screen answers it. */
  lookable?: boolean;
  resize?: { offered: boolean; onPress: () => void };
}): HTMLElement {
  root = document.createElement("div");
  document.body.append(root);
  dispose = render(
    () => (
      <Shown value={() => true}>
        <TerminalStatusLine
          kind={opts.kind}
          lookable={opts.lookable ?? true}
          host="local"
          id={ID}
          terminal={`local/${ID}`}
          driver="conductor"
          grid={opts.drawn ?? { cols: 80, rows: 24 }}
          phase="live"
          held={false}
          resize={opts.resize}
        />
      </Shown>
    ),
    root,
  );
  return root;
}

const fitButton = (el: HTMLElement): HTMLElement | null =>
  el.querySelector('[data-testid="live-fit"]');

describe("the Fit width button", () => {
  it("is drawn for a terminal that pans, lit by the choice", () => {
    expect(
      fitButton(mountControls(true, true))?.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      fitButton(mountControls(true, false))?.getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("is not drawn for a terminal that already fits, whatever the choice", () => {
    expect(fitButton(mountControls(false, true))).toBeNull();
    expect(fitButton(mountControls(false, false))).toBeNull();
  });
});

describe("the agent's facts row", () => {
  const facts = (el: HTMLElement, kind: HeadKind) =>
    el.querySelector(`[data-testid="${kind}-facts"]`);

  it("keeps its place in a live pane with an agent and without", () => {
    setStanding(here({ agent: true }));
    expect(facts(mountStatus({ kind: "live" }), "live")).not.toBeNull();
    dispose?.();
    root?.remove();
    setStanding(here({ agent: false }));
    expect(facts(mountStatus({ kind: "live" }), "live")).not.toBeNull();
  });

  it("is drawn in Look only for an agent", () => {
    setStanding(here({ agent: false }));
    expect(facts(mountStatus({ kind: "peek" }), "peek")).toBeNull();
  });
});

describe("the one press to take the size", () => {
  const press = (el: HTMLElement, kind: HeadKind) =>
    el.querySelector<HTMLButtonElement>(`[data-testid="${kind}-resize"]`);

  it("is the readout, as a button, while a live pane offers it", () => {
    const onPress = vi.fn();
    const button = press(
      mountStatus({ kind: "live", resize: { offered: true, onPress } }),
      "live",
    );
    expect(button?.textContent).toBe("80×24 · Resize to fit");
    button?.click();
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("is the plain readout while the pane does not offer it", () => {
    const el = mountStatus({
      kind: "live",
      resize: { offered: false, onPress: () => {} },
    });
    expect(press(el, "live")).toBeNull();
    expect(el.querySelector('[data-testid="live-grid"]')?.textContent).toBe(
      "80×24",
    );
  });

  it("is never drawn in Look", () => {
    expect(
      press(
        mountStatus({
          kind: "peek",
          resize: { offered: true, onPress: () => {} },
        }),
        "peek",
      ),
    ).toBeNull();
  });
});

describe("the one gate, handed down", () => {
  it("reads the screen out for a head created while its pane holds one through a non-answer", () => {
    // THE TWO-LATCH BUG. The pane has drawn this screen for minutes and is
    // holding it across a frame the fleet index cannot answer. A head built
    // in THAT frame, with a latch of its own, would start from nothing and
    // draw a screen with no readout over it — the `NOT_YET` sample. There is
    // one gate per screen, so it reads the pane's answer.
    setStanding({ kind: "loading" });
    const el = mountStatus({ kind: "live", lookable: true });
    expect(el.querySelector('[data-testid="live-grid"]')?.textContent).toBe(
      "80×24",
    );
    expect(el.querySelector('[data-testid="live-live"]')).not.toBeNull();
  });

  it("draws no readout when its view says there is no screen", () => {
    setStanding(here({ agent: false }));
    const el = mountStatus({ kind: "live", lookable: false });
    expect(el.querySelector('[data-testid="live-grid"]')).toBeNull();
    expect(el.querySelector('[data-testid="live-live"]')).toBeNull();
  });
});
