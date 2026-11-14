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
import { agentVocab } from "kolu-agents/vocab";
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
import { Shown } from "../ui/shown";

/** An active terminal whose agent is working and says what on. The agent
 *  record is the WIRE's shape — `taskProgress` is a field every agent
 *  publishes, `null` for one that keeps no task list — so a case can turn it
 *  on without the fixture growing a second shape. */
const working = (
  agent: Record<string, unknown> = {},
): FleetTerminalStanding => ({
  kind: "here",
  meta: {
    state: "active",
    foreground: null,
    agent: {
      kind: "claude-code",
      state: "thinking",
      summary: "writing the plan",
      taskProgress: null,
      ...agent,
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

/** Is the conductor pane the shown view? The pane is retained across a tab
 *  switch, so this is the fact — not the element's geometry — that decides
 *  whether Look is allowed to read a machine's screen. */
const [shown, setShown] = createSignal(true);

function mount(rowId = "row-1"): HTMLElement {
  root = document.createElement("div");
  document.body.append(root);
  dispose = render(
    () => (
      <Shown.Provider value={shown}>
        <ConductorLook rowId={rowId} host="remote:srid@zest" id={TERMINAL} />
      </Shown.Provider>
    ),
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
  setShown(true);
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

  it("says how far through its own task list the agent is, when it keeps one", async () => {
    setStanding(working({ taskProgress: { completed: 7, total: 12 } }));
    const el = mount("progress");
    await vi.advanceTimersByTimeAsync(0);
    // Beside the state, ahead of what it is doing — the same fraction the
    // tile's meta line and the Inspector's card print.
    expect(
      el.querySelector('[data-testid="conductor-look-progress"]')?.textContent,
    ).toBe("7/12");
    expect(
      el.querySelector('[data-testid="conductor-look-status"]')?.textContent,
    ).toBe("Thinking · 7/12 · writing the plan");
  });

  it("says nothing about tasks for an agent that keeps no list", async () => {
    const el = mount("no-tasks");
    await vi.advanceTimersByTimeAsync(0);
    expect(el.querySelector('[data-testid="conductor-look-progress"]')).toBe(
      null,
    );
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

  it("offers no Look on a sleeping terminal — there is no live screen to read", async () => {
    setStanding({ kind: "here", meta: { state: "sleeping" } as never });
    const el = mount("asleep");
    await vi.advanceTimersByTimeAsync(LOOK_EVERY_MS * 3);
    expect(
      el.querySelector('[data-testid="conductor-look-status"]')?.textContent,
    ).toBe("asleep");
    expect(toggle(el)).toBeNull();
    expect(seam.reads).toEqual([]);
  });

  it("says the agent is STARTING when its own binary is in front and nothing is detected yet", async () => {
    // The row used to read "no agent · running omp", which says both halves
    // of a contradiction at once. The binary is recognised through the agent
    // registry (`cli.basename`), and the words it is named by come from the
    // same registry — this test holds no list of its own.
    const omp = agentVocab("omp");
    setStanding({
      kind: "here",
      meta: {
        state: "active",
        agent: null,
        foreground: { name: omp.cli.basename, title: null, shell: false },
      } as never,
    });
    const el = mount("starting");
    await vi.advanceTimersByTimeAsync(0);
    expect(
      el.querySelector('[data-testid="conductor-look-status"]')?.textContent,
    ).toBe(`starting ${omp.displayName}`);
  });

  it("still says 'no agent' for a program that is none of ours, and for the shell", async () => {
    setStanding({
      kind: "here",
      meta: {
        state: "active",
        agent: null,
        foreground: { name: "vim", title: null, shell: false },
      } as never,
    });
    const el = mount("plain");
    await vi.advanceTimersByTimeAsync(0);
    expect(
      el.querySelector('[data-testid="conductor-look-status"]')?.textContent,
    ).toBe("no agent · running vim");

    unmount();
    setStanding({
      kind: "here",
      meta: {
        state: "active",
        agent: null,
        foreground: { name: "bash", title: null, shell: true },
      } as never,
    });
    const shell = mount("shell");
    await vi.advanceTimersByTimeAsync(0);
    expect(
      shell.querySelector('[data-testid="conductor-look-status"]')?.textContent,
    ).toBe("no agent · at the shell");
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

  it("reads nothing while the pane is hidden, and picks up when it is shown again", async () => {
    // THE RETAINED PANE'S CONTRACT. Leaving for a host tab does not unmount
    // this Look — it stays open, which is the whole point — so the only thing
    // standing between a conversation somebody left an hour ago and a poll
    // against a real machine every two seconds is `shown()`.
    setShown(false);
    const el = mount("hidden");
    toggle(el)?.click();
    await vi.advanceTimersByTimeAsync(LOOK_EVERY_MS * 3);
    expect(seam.reads).toEqual([]);
    // Still OPEN while hidden: the toggle was not undone, only the work was.
    expect(toggle(el)?.textContent).toBe("Hide");

    setShown(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(seam.reads).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(LOOK_EVERY_MS * 2);
    expect(seam.reads.length).toBeGreaterThanOrEqual(2);

    // And it stops again on the way out, rather than only starting.
    setShown(false);
    const whileShown = seam.reads.length;
    await vi.advanceTimersByTimeAsync(LOOK_EVERY_MS * 3);
    expect(seam.reads).toHaveLength(whileShown);
  });

  it("keeps the SAME element across the trip, open tail and all", async () => {
    // Element identity, the way `/solidjs` asks for it: a marker put on the
    // node by hand cannot survive a rebuild, so finding it afterwards is proof
    // that nothing was re-created — and the open tail's own lines are proof
    // that the view came back as it was left rather than re-fetched.
    const el = mount("identity");
    toggle(el)?.click();
    await vi.advanceTimersByTimeAsync(0);
    const before = el.querySelector('[data-testid="conductor-look"]');
    const tailBefore = el.querySelector('[data-testid="conductor-look-tail"]');
    expect(before).not.toBeNull();
    expect(tailBefore).not.toBeNull();
    (before as HTMLElement & { marker?: string }).marker = "same node";

    setShown(false);
    await vi.advanceTimersByTimeAsync(LOOK_EVERY_MS);
    setShown(true);
    await vi.advanceTimersByTimeAsync(0);

    const after = el.querySelector('[data-testid="conductor-look"]');
    expect(after).toBe(before);
    expect((after as HTMLElement & { marker?: string }).marker).toBe(
      "same node",
    );
    expect(el.querySelector('[data-testid="conductor-look-tail"]')).toBe(
      tailBefore,
    );
    expect(
      el.querySelector('[data-testid="conductor-look-lines"]')?.textContent,
    ).toContain("line two");
  });
});
