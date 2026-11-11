// @vitest-environment happy-dom
/**
 * THE `⋯` IS A MENU, AND THE MENU ASKS BEFORE IT DESTROYS ANYTHING.
 *
 * The defect these pin landed on a real conversation: the `⋯` in the header
 * started a new session on the press. A `⋯` promises *there is more here* and
 * promises nothing about what, so it is pressed to LOOK — and what came back
 * was a conversation that had moved on without being asked.
 *
 * So the first test is about what the button does NOT do, and it asserts on
 * the verbs rather than on the pixels: a menu that opened and also acted would
 * look exactly right.
 *
 * The rest are the menu's own rules — one confirm in front of the wipe, and
 * rows that exist only while they mean something (`Stop` needs a running turn,
 * `Sign in…` needs an agent that is not signed in). Absent rather than
 * disabled: a greyed row is still a row a person reaches for.
 */

import {
  DEFAULT_ORCHESTRATOR_STATE,
  type OrchestratorRow,
  type OrchestratorState,
} from "kolu-common/orchestrator";
import { Effect } from "effect";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import OrchestratorHeader from "./OrchestratorHeader";

const verbs = vi.hoisted(() => ({
  clearSession: vi.fn(),
  newSession: vi.fn(),
  cancel: vi.fn(),
  setOption: vi.fn(),
}));
vi.mock("./useOrchestrator", () => ({
  useOrchestrator: () => verbs,
}));

/** The repo's ONE clipboard write path — the component must reach it rather
 *  than `navigator.clipboard`, which is the write that fails over plain
 *  `http://`. */
const writeTextToClipboard = vi.hoisted(() =>
  vi.fn((_text: string) => Effect.void),
);
vi.mock("@kolu/solid-logtail", () => ({ writeTextToClipboard }));

const SINCE = "2026-01-01T00:00:00.000Z";

const ROWS: readonly OrchestratorRow[] = [
  {
    id: "user:1",
    seq: 1,
    since: SINCE,
    kind: "user",
    text: "hello",
    attachments: [],
  },
  { id: "agent:2", seq: 2, since: SINCE, kind: "agent", text: "hello back" },
];

let dispose: (() => void) | undefined;
let root: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  root?.remove();
  dispose = undefined;
  root = undefined;
  for (const verb of Object.values(verbs)) verb.mockClear();
  writeTextToClipboard.mockClear();
});

function mount(over: Partial<OrchestratorState> = {}): {
  at: (testid: string) => HTMLElement | undefined;
} {
  root = document.createElement("div");
  document.body.append(root);
  dispose = render(
    () => (
      <OrchestratorHeader
        state={{ ...DEFAULT_ORCHESTRATOR_STATE, phase: "idle", ...over }}
        rows={ROWS}
        onSignIn={() => {}}
      />
    ),
    root,
  );
  // The panel is PORTALLED — it lives on `document.body`, beside the mount
  // point rather than inside it, so the whole document is the search.
  return {
    at: (testid) =>
      document.querySelector<HTMLElement>(`[data-testid="${testid}"]`) ??
      undefined,
  };
}

const open = (at: (testid: string) => HTMLElement | undefined): void => {
  at("orchestrator-menu")?.click();
};

describe("the header's ⋯", () => {
  it("opens a menu and PERFORMS NOTHING", () => {
    const { at } = mount();
    expect(at("orchestrator-menu-panel")).toBeUndefined();

    open(at);

    expect(at("orchestrator-menu-panel")).toBeDefined();
    // The whole defect, stated: the press moved the conversation.
    expect(verbs.clearSession).not.toHaveBeenCalled();
    expect(verbs.newSession).not.toHaveBeenCalled();
    expect(verbs.cancel).not.toHaveBeenCalled();
  });

  it("wipes only after the confirm step", () => {
    const { at } = mount();
    open(at);

    at("orchestrator-menu-new-session")?.click();
    // The first press ARMS. Nothing is gone yet, and the pair that can undo
    // the decision is on screen.
    expect(verbs.clearSession).not.toHaveBeenCalled();
    expect(at("orchestrator-menu-new-session-cancel")).toBeDefined();

    at("orchestrator-menu-new-session-confirm")?.click();
    expect(verbs.clearSession).toHaveBeenCalledTimes(1);
    // The WIPE, never the divider-and-carry-on verb beside it.
    expect(verbs.newSession).not.toHaveBeenCalled();
  });

  it("offers `Stop` only while a turn is running", () => {
    const idle = mount();
    open(idle.at);
    expect(idle.at("orchestrator-menu-stop")).toBeUndefined();
    dispose?.();
    root?.remove();

    const working = mount({ phase: "working" });
    open(working.at);
    const stop = working.at("orchestrator-menu-stop");
    expect(stop).toBeDefined();
    stop?.click();
    expect(verbs.cancel).toHaveBeenCalledTimes(1);
  });

  it("offers `Sign in…` only while the agent is not signed in", () => {
    const out = mount({
      identity: {
        kind: "none",
        label: "not signed in",
        detail: null,
        account: null,
      },
    });
    open(out.at);
    expect(out.at("orchestrator-menu-signin")).toBeDefined();
    dispose?.();
    root?.remove();

    const inside = mount({
      identity: {
        kind: "account",
        label: "srid",
        detail: null,
        account: null,
      },
    });
    open(inside.at);
    expect(inside.at("orchestrator-menu-signin")).toBeUndefined();
  });

  it("copies the transcript through the repo's clipboard path", () => {
    const { at } = mount();
    open(at);
    at("orchestrator-menu-copy")?.click();

    expect(writeTextToClipboard).toHaveBeenCalledOnce();
    const text = writeTextToClipboard.mock.calls[0]?.[0] ?? "";
    expect(text).toContain("you: hello");
    expect(text).toContain("agent: hello back");
  });
});
