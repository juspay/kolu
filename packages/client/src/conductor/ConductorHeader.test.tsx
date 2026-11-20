// @vitest-environment happy-dom

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
  signIn: vi.fn(),
}));
vi.mock("./useConductor", () => ({
  useConductor: () => verbs,
}));

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
          onSignIn={() => verbs.signIn()}
        />
      </Shown.Provider>
    ),
    root,
  );
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
    expect(verbs.clearSession).not.toHaveBeenCalled();
    expect(verbs.newSession).not.toHaveBeenCalled();
    expect(verbs.cancel).not.toHaveBeenCalled();
  });

  it("takes the menu off the page when the pane stops being the shown view", () => {
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
    expect(verbs.clearSession).not.toHaveBeenCalled();
    expect(at("conductor-menu-new-session-cancel")).toBeDefined();

    at("conductor-menu-new-session-confirm")?.click();
    expect(verbs.clearSession).toHaveBeenCalledTimes(1);
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

  it("always offers a sign-in, named `Sign in again…` while signed in, and asks the harness", () => {
    const out = mount({
      identity: {
        kind: "none",
        label: "not signed in",
        detail: null,
        account: null,
      },
    });
    open(out.at);
    expect(out.at("conductor-menu-signin")?.textContent).toBe("Sign in…");
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
    const door = inside.at("conductor-menu-signin");
    expect(door?.textContent).toBe("Sign in again…");
    door?.click();
    expect(verbs.signIn).toHaveBeenCalledTimes(1);
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
    expect(rows[1]?.textContent).toContain("the token expired");
    expect(panel?.textContent).toContain("plus the agent's own");
  });
});
