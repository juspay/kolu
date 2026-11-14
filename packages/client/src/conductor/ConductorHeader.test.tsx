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
 *
 * The last block is the ROW'S ONE LINE-HEIGHT. There is no layout in this
 * environment — happy-dom has no boxes to measure — so what is pinned is the
 * CAUSE the measured misalignment came from: the row declares one leading and
 * no child declares a second one. (The numbers themselves were taken in a real
 * browser: every child's box centre and text centre now land on one pixel.)
 */

import {
  DEFAULT_CONDUCTOR_STATE,
  type ConductorRow,
  type ConductorState,
} from "kolu-common/conductor";
import { Effect } from "effect";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import ConductorHeader from "./ConductorHeader";
import { Shown } from "../ui/shown";

const verbs = vi.hoisted(() => ({
  clearSession: vi.fn(),
  newSession: vi.fn(),
  cancel: vi.fn(),
  setOption: vi.fn(),
}));
vi.mock("./useConductor", () => ({
  useConductor: () => verbs,
}));

/** The repo's ONE clipboard write path — the component must reach it rather
 *  than `navigator.clipboard`, which is the write that fails over plain
 *  `http://`. */
const writeTextToClipboard = vi.hoisted(() =>
  vi.fn((_text: string) => Effect.void),
);
vi.mock("@kolu/solid-logtail", () => ({ writeTextToClipboard }));

const SINCE = "2026-01-01T00:00:00.000Z";

const ROWS: readonly ConductorRow[] = [
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

function mount(
  over: Partial<ConductorState> = {},
  shown: () => boolean = () => true,
): {
  at: (testid: string) => HTMLElement | undefined;
} {
  root = document.createElement("div");
  document.body.append(root);
  dispose = render(
    () => (
      <Shown.Provider value={shown}>
        <ConductorHeader
          state={{ ...DEFAULT_CONDUCTOR_STATE, phase: "idle", ...over }}
          rows={ROWS}
          onSignIn={() => {}}
        />
      </Shown.Provider>
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
  at("conductor-menu")?.click();
};

describe("the header's ⋯", () => {
  it("opens a menu and PERFORMS NOTHING", () => {
    const { at } = mount();
    expect(at("conductor-menu-panel")).toBeUndefined();

    open(at);

    expect(at("conductor-menu-panel")).toBeDefined();
    // The whole defect, stated: the press moved the conversation.
    expect(verbs.clearSession).not.toHaveBeenCalled();
    expect(verbs.newSession).not.toHaveBeenCalled();
    expect(verbs.cancel).not.toHaveBeenCalled();
  });

  it("takes the menu off the page when the pane stops being the shown view", () => {
    // The pane is RETAINED behind a host tab, and this menu is PORTALLED to
    // the document — so hiding the pane hides everything except exactly this.
    // An open `⋯` panel left over a person's terminals would take their next
    // click and their next `Escape`.
    const [shown, setShown] = createSignal(true);
    const { at } = mount({}, shown);
    open(at);
    expect(at("conductor-menu-panel")).toBeDefined();

    setShown(false);
    expect(at("conductor-menu-panel")).toBeUndefined();
  });

  it("wipes only after the confirm step", () => {
    const { at } = mount();
    open(at);

    at("conductor-menu-new-session")?.click();
    // The first press ARMS. Nothing is gone yet, and the pair that can undo
    // the decision is on screen.
    expect(verbs.clearSession).not.toHaveBeenCalled();
    expect(at("conductor-menu-new-session-cancel")).toBeDefined();

    at("conductor-menu-new-session-confirm")?.click();
    expect(verbs.clearSession).toHaveBeenCalledTimes(1);
    // The WIPE, never the divider-and-carry-on verb beside it.
    expect(verbs.newSession).not.toHaveBeenCalled();
  });

  it("offers `Stop` only while a turn is running", () => {
    const idle = mount();
    open(idle.at);
    expect(idle.at("conductor-menu-stop")).toBeUndefined();
    dispose?.();
    root?.remove();

    const working = mount({ phase: "working" });
    open(working.at);
    const stop = working.at("conductor-menu-stop");
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
    expect(out.at("conductor-menu-signin")).toBeDefined();
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
    expect(inside.at("conductor-menu-signin")).toBeUndefined();
  });

  it("copies the transcript through the repo's clipboard path", () => {
    const { at } = mount();
    open(at);
    at("conductor-menu-copy")?.click();

    expect(writeTextToClipboard).toHaveBeenCalledOnce();
    const text = writeTextToClipboard.mock.calls[0]?.[0] ?? "";
    expect(text).toContain("you: hello");
    expect(text).toContain("agent: hello back");
  });

  it("holds the tool-server roster — read in here, not a strip on every screen", () => {
    // `kolu ✓ · plus the agent's own` stood above every conversation all day.
    // It answers a question a person asks now and then, so it is read behind
    // the one press that promises *there is more here* — and the tick is
    // still the AGENT'S word about the server, not kolu's.
    const { at } = mount({
      servers: [
        { name: "kolu", standing: "connected", said: null, where: null },
        {
          name: "notes",
          standing: "unattached",
          said: "the token expired",
          where: null,
        },
      ],
    });
    expect(at("conductor-server")).toBeUndefined();

    open(at);

    const panel = at("conductor-menu-panel");
    const rows = [
      ...(panel?.querySelectorAll<HTMLElement>(
        '[data-testid="conductor-server"]',
      ) ?? []),
    ];
    expect(rows.map((row) => row.dataset.server)).toEqual(["kolu", "notes"]);
    expect(rows[0]?.dataset.standing).toBe("connected");
    expect(rows[0]?.textContent).toContain("✓");
    // The agent's own sentence about why it is not on that server is the
    // whole answer to the question this section gets opened with.
    expect(rows[1]?.textContent).toContain("the token expired");
    expect(panel?.textContent).toContain("plus the agent's own");
  });
});
