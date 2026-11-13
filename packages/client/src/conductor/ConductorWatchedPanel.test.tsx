// @vitest-environment happy-dom
/**
 * THE WATCHED PANEL RENDERS — the list a person opens from `watching N`.
 *
 * It is one row per watched ref, and each row draws the terminal's identity
 * plus `ConductorLook`'s live standing, so this mounts over the same seams
 * `ConductorLook.test.tsx` stubs (the fleet index, the padi wire, tips) and
 * asserts the row, its Look and its remove control exist and act.
 */

import { Effect } from "effect";
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

function mount(watched: readonly string[]): HTMLElement {
  root = document.createElement("div");
  document.body.append(root);
  dispose = render(
    () => (
      <ConductorShown.Provider value={() => true}>
        <ConductorWatchedPanel watched={watched} />
      </ConductorShown.Provider>
    ),
    root,
  );
  return root;
}

const at = (testid: string): HTMLElement | undefined =>
  root?.querySelector<HTMLElement>(`[data-testid="${testid}"]`) ?? undefined;

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
    mount([REF]);
    const row = at("conductor-watched-row");
    expect(row).toBeDefined();
    expect(row?.dataset.ref).toBe(REF);
    expect(at("conductor-watched-agent")?.textContent).toBe("Claude Code");
    expect(at("conductor-watched-since")?.textContent).toContain("quiet");
    // The peek is the transcript's own, found under the panel's name.
    expect(at("conductor-watched-look")).toBeDefined();
  });

  it("removes an entry through the conversation's own verb", () => {
    mount([REF]);
    at("conductor-watched-remove")?.click();
    expect(verbs.unwatch).toHaveBeenCalledWith(REF);
  });

  it("still lists a terminal that is gone, and offers no Look at it", () => {
    setStanding({ kind: "gone" });
    mount([REF]);
    expect(at("conductor-watched-row")).toBeDefined();
    expect(at("conductor-watched-look")).toBeUndefined();
    expect(at("conductor-look")?.dataset.standing).toBe("gone");
  });

  it("lists a ref it cannot resolve rather than dropping it", () => {
    mount(["nonsense"]);
    expect(at("conductor-watched-row")?.dataset.ref).toBe("nonsense");
    expect(at("conductor-watched-unresolved")).toBeDefined();
    expect(at("conductor-watched-remove")).toBeDefined();
  });
});
