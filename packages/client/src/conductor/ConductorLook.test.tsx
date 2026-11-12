// @vitest-environment happy-dom
/**
 * LOOK — what an agent line reads, and when.
 *
 * The status line comes off the fleet roster and costs nothing; the tail is a
 * poll against a real machine, so WHEN it reads is the contract: only while
 * open, on screen and in a visible tab, from the terminal's own host, every
 * couple of seconds — and never for a terminal the roster no longer has. The
 * roster and the procedure face are stubbed at their module seams; the poll
 * loop, the visibility gates and the remembered open state are the real ones.
 */

import { Effect } from "effect";
import type { HostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FleetTerminalStanding } from "../palette/fleetTerminals";

const TERMINAL = "11111111-1111-4111-8111-111111111111" as TerminalId;

const seam = vi.hoisted(() => ({
  reads: [] as { host: HostKey; input: unknown }[],
  reply: (): Effect.Effect<string, Error> =>
    Effect.succeed("line one\nline two"),
}));

const [standing, setStanding] = createSignal<FleetTerminalStanding>({
  kind: "gone",
});

vi.mock("../palette/fleetTerminals", () => ({
  fleetTerminalStanding: () => standing(),
}));
vi.mock("../wire", () => ({
  padiRpcOf: (host: HostKey) => ({
    screen: {
      text: (input: unknown) => {
        seam.reads.push({ host, input });
        return seam.reply();
      },
    },
  }),
}));
vi.mock("../settings/useTips", () => ({
  useTips: () => ({ showTipOnce: () => {} }),
}));

import ConductorLook, { LOOK_EVERY_MS, LOOK_LINES } from "./ConductorLook";

/** An active terminal whose agent is working and says what on. */
const working = (): FleetTerminalStanding => ({
  kind: "here",
  meta: {
    state: "active",
    foreground: null,
    agent: {
      kind: "claude-code",
      state: "thinking",
      summary: "writing the plan",
    },
  } as never,
});

/** Whether the tail's box is in view — what the stub observer reports. */
let inView = true;
class StubObserver {
  constructor(
    private readonly callback: (entries: { isIntersecting: boolean }[]) => void,
  ) {}
  observe(): void {
    queueMicrotask(() => this.callback([{ isIntersecting: inView }]));
  }
  disconnect(): void {}
}

let dispose: (() => void) | undefined;
let root: HTMLElement | undefined;

function mount(rowId = "row-1"): HTMLElement {
  root = document.createElement("div");
  document.body.append(root);
  dispose = render(
    () => <ConductorLook rowId={rowId} host="remote:srid@zest" id={TERMINAL} />,
    root,
  );
  return root;
}

function unmount(): void {
  dispose?.();
  root?.remove();
  dispose = undefined;
  root = undefined;
}

const toggle = (el: HTMLElement) =>
  el.querySelector<HTMLButtonElement>('[data-testid="conductor-look-toggle"]');

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IntersectionObserver", StubObserver);
  inView = true;
  seam.reads = [];
  seam.reply = () => Effect.succeed("line one\nline two");
  setStanding(working());
});

afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("an agent line", () => {
  it("says the agent's state and what it is doing, and reads nothing while closed", async () => {
    const el = mount("closed");
    await vi.advanceTimersByTimeAsync(LOOK_EVERY_MS * 3);
    expect(
      el.querySelector('[data-testid="conductor-look-status"]')?.textContent,
    ).toBe("Thinking · writing the plan");
    expect(toggle(el)?.textContent).toBe("Look");
    expect(seam.reads).toEqual([]);
  });

  it("opens to the last lines, read from the terminal's OWN host", async () => {
    const el = mount("opens");
    toggle(el)?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(seam.reads).toEqual([
      {
        host: { kind: "remote", target: "srid@zest" },
        input: { id: TERMINAL, tail: LOOK_LINES },
      },
    ]);
    expect(
      el.querySelector('[data-testid="conductor-look-lines"]')?.textContent,
    ).toContain("line two");
  });

  it("re-reads while open, and stops the moment it is closed", async () => {
    const el = mount("polls");
    toggle(el)?.click();
    await vi.advanceTimersByTimeAsync(0);
    // A couple of periods, not exactly one: the loop's own scheduling adds a
    // tick, and "about every 2 s" is the claim, not the millisecond.
    await vi.advanceTimersByTimeAsync(LOOK_EVERY_MS * 2);
    const whileOpen = seam.reads.length;
    expect(whileOpen).toBeGreaterThanOrEqual(2);
    expect(whileOpen).toBeLessThanOrEqual(3);
    toggle(el)?.click();
    await vi.advanceTimersByTimeAsync(LOOK_EVERY_MS * 3);
    expect(seam.reads).toHaveLength(whileOpen);
  });

  it("reads nothing for a tail that is scrolled out of view", async () => {
    inView = false;
    const el = mount("offscreen");
    toggle(el)?.click();
    await vi.advanceTimersByTimeAsync(LOOK_EVERY_MS * 3);
    expect(seam.reads).toEqual([]);
  });

  it("says 'terminal gone' for a terminal the roster no longer has, and offers nothing", async () => {
    const el = mount("gone-later");
    toggle(el)?.click();
    await vi.advanceTimersByTimeAsync(0);
    const before = seam.reads.length;
    setStanding({ kind: "gone" });
    await vi.advanceTimersByTimeAsync(LOOK_EVERY_MS * 3);
    expect(
      el.querySelector('[data-testid="conductor-look-status"]')?.textContent,
    ).toBe("terminal gone");
    expect(toggle(el)).toBeNull();
    expect(seam.reads).toHaveLength(before);
  });

  it("shows a failed read instead of an empty box", async () => {
    seam.reply = () => Effect.fail(new Error("padi is not answering"));
    const el = mount("fails");
    toggle(el)?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(
      el.querySelector('[data-testid="conductor-look-error"]')?.textContent,
    ).toContain("padi is not answering");
  });

  it("stays open across a re-render of its row", async () => {
    const first = mount("kept");
    toggle(first)?.click();
    unmount();
    const again = mount("kept");
    expect(toggle(again)?.getAttribute("aria-expanded")).toBe("true");
    expect(toggle(again)?.textContent).toBe("Hide");
  });
});
