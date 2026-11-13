// @vitest-environment happy-dom
/**
 * THE WATCHED PANEL RENDERS — the list a person opens from the status line.
 *
 * It is one GROUP per piece of work (the grouping arrives from kolu-server on
 * the cell, so nothing here recomputes it) and one row per watched ref under
 * it, each row drawing the terminal's identity plus `ConductorLook`'s live
 * standing. So this mounts over the same seams `ConductorLook.test.tsx` stubs
 * (the fleet index, the padi wire, tips) and asserts the groups, the rows,
 * their Look and their remove control exist and act.
 */

import { Effect } from "effect";
import type { ConductorState } from "kolu-common/conductor";
import type { HostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  FleetTerminalRow,
  FleetTerminalStanding,
} from "../palette/fleetTerminals";

const TERMINAL = "11111111-1111-4111-8111-111111111111" as TerminalId;
const REF = `local/${TERMINAL}`;
const OTHER_TERMINAL = "22222222-2222-4222-8222-222222222222" as TerminalId;
const OTHER_REF = `local/${OTHER_TERMINAL}`;
const SPLIT_REF = "local/33333333-3333-4333-8333-333333333333";

/** One piece of work, the shape the cell publishes. */
const piece = (
  root: string,
  name: string,
  refs: readonly string[],
): ConductorState["work"][number] => ({ root, name, refs });

const [standing, setStanding] = createSignal<FleetTerminalStanding>({
  kind: "gone",
});

vi.mock("../palette/fleetTerminals", async (importOriginal) => ({
  // The grouping/keying half stays REAL — the panel's names come from the same
  // computation the `@` menu uses, and a stub there would prove nothing.
  ...(await importOriginal<typeof import("../palette/fleetTerminals")>()),
  fleetTerminalStanding: () => standing(),
  useFleetTerminalIndex: () => (): FleetTerminalRow[] => [],
}));
vi.mock("../wire", () => ({
  padiRpcOf: (_host: HostKey) => ({
    screen: { text: () => Effect.succeed("line one") },
  }),
}));
vi.mock("../settings/useTips", () => ({
  useTips: () => ({ showTipOnce: () => {} }),
}));
const verbs = vi.hoisted(() => ({ unwatch: vi.fn() }));
vi.mock("./useConductor", () => ({ useConductor: () => verbs }));

import ConductorWatchedPanel from "./ConductorWatchedPanel";
import { ConductorShown } from "./conductorShown";

/** An active terminal whose agent is working, as the fleet reports it. */
const working = (): FleetTerminalStanding => ({
  kind: "here",
  meta: {
    state: "active",
    foreground: null,
    lastActivityAt: Date.now() - 4_000,
    agent: {
      kind: "claude-code",
      state: "thinking",
      summary: "writing the plan",
    },
  } as never,
});

let dispose: (() => void) | undefined;
let root: HTMLElement | undefined;

function mount(work: ConductorState["work"]): HTMLElement {
  root = document.createElement("div");
  document.body.append(root);
  dispose = render(
    () => (
      <ConductorShown.Provider value={() => true}>
        <ConductorWatchedPanel work={work} />
      </ConductorShown.Provider>
    ),
    root,
  );
  return root;
}

const at = (testid: string): HTMLElement | undefined =>
  root?.querySelector<HTMLElement>(`[data-testid="${testid}"]`) ?? undefined;

const all = (testid: string): HTMLElement[] =>
  Array.from(
    root?.querySelectorAll<HTMLElement>(`[data-testid="${testid}"]`) ?? [],
  );

beforeEach(() => {
  verbs.unwatch.mockClear();
  setStanding(working());
});

afterEach(() => {
  dispose?.();
  root?.remove();
  dispose = undefined;
  root = undefined;
});

describe("the watched panel", () => {
  it("draws a row per watched terminal, with its agent and its clock", () => {
    mount([piece(REF, "fix-parser", [REF])]);
    const row = at("conductor-watched-row");
    expect(row).toBeDefined();
    expect(row?.dataset.ref).toBe(REF);
    expect(at("conductor-watched-agent")?.textContent).toBe("Claude Code");
    expect(at("conductor-watched-since")?.textContent).toContain("quiet");
    // The peek is the transcript's own, found under the panel's name.
    expect(at("conductor-watched-look")).toBeDefined();
  });

  it("puts a piece of work's terminals under its root's name, and two pieces side by side", () => {
    mount([
      piece(REF, "fix-parser", [REF, SPLIT_REF]),
      piece(OTHER_REF, "docs-pass", [OTHER_REF]),
    ]);
    const groups = all("conductor-watched-group");
    expect(groups.map((group) => group.dataset.root)).toEqual([REF, OTHER_REF]);
    // The head is the piece's name, and the planner's split sits under it —
    // two terminals, ONE piece of work.
    expect(
      groups[0]?.querySelector('[data-testid="conductor-watched-group-name"]')
        ?.textContent,
    ).toBe("fix-parser");
    expect(
      Array.from(
        groups[0]?.querySelectorAll('[data-testid="conductor-watched-row"]') ??
          [],
      ).map((row) => (row as HTMLElement).dataset.ref),
    ).toEqual([REF, SPLIT_REF]);
    expect(
      groups[1]?.querySelectorAll('[data-testid="conductor-watched-row"]')
        .length,
    ).toBe(1);
  });

  it("heads a piece whose root the fleet cannot name with that terminal's id", () => {
    mount([piece(REF, "", [REF])]);
    expect(at("conductor-watched-group-name")?.textContent).toBe(TERMINAL);
  });

  it("removes an entry through the conversation's own verb", () => {
    mount([piece(REF, "fix-parser", [REF])]);
    at("conductor-watched-remove")?.click();
    expect(verbs.unwatch).toHaveBeenCalledWith(REF);
  });

  it("still lists a terminal that is gone, and offers no Look at it", () => {
    setStanding({ kind: "gone" });
    mount([piece(REF, "fix-parser", [REF])]);
    expect(at("conductor-watched-row")).toBeDefined();
    expect(at("conductor-watched-look")).toBeUndefined();
    expect(at("conductor-look")?.dataset.standing).toBe("gone");
  });

  it("lists a ref it cannot resolve rather than dropping it", () => {
    mount([piece("nonsense", "", ["nonsense"])]);
    expect(at("conductor-watched-row")?.dataset.ref).toBe("nonsense");
    expect(at("conductor-watched-unresolved")).toBeDefined();
    expect(at("conductor-watched-remove")).toBeDefined();
  });

  it("says nothing is watched when there is no work at all", () => {
    mount([]);
    expect(at("conductor-watched-group")).toBeUndefined();
    expect(at("conductor-watched-row")).toBeUndefined();
  });
});
