// @vitest-environment happy-dom

import {
  type ConductorState,
  type ConductorUnreadable,
  DEFAULT_CONDUCTOR_STATE,
} from "kolu-common/conductor";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import ConductorRefusal from "./ConductorRefusal";

const verbs = vi.hoisted(() => ({
  newSession: vi.fn(),
  recoverStore: vi.fn(),
}));
vi.mock("./useConductor", () => ({ useConductor: () => verbs }));

let dispose: (() => void) | undefined;
let root: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  root?.remove();
  dispose = undefined;
  root = undefined;
  for (const verb of Object.values(verbs)) verb.mockClear();
});

const unreadable = (
  over: Partial<ConductorUnreadable> = {},
): ConductorUnreadable => ({
  key: "works",
  path: "/home/me/.config/kolu/config.json",
  keepsAt: "/home/me/.config/kolu/conductor/unreadable-works-2026-01-01.json",
  inBackups: true,
  detail: 'SchemaError(Missing key at [0]["members"][0]["worktree"])',
  ...over,
});

function mount(over: Partial<ConductorState>): {
  at: (testid: string) => HTMLElement | undefined;
} {
  root = document.createElement("div");
  document.body.append(root);
  const state: ConductorState = {
    ...DEFAULT_CONDUCTOR_STATE,
    refusal: "kolu could not read the Conductor's saved works — …",
    ...over,
  };
  dispose = render(() => <ConductorRefusal state={state} />, root);
  return {
    at: (testid) =>
      document.querySelector<HTMLElement>(`[data-testid="${testid}"]`) ??
      undefined,
  };
}

describe("a conversation the AGENT refused", () => {
  it("offers exactly one thing: asking again", () => {
    const { at } = mount({ refusal: "the agent would not open a session" });
    at("conductor-retry")?.click();
    expect(verbs.newSession).toHaveBeenCalledTimes(1);
    expect(at("conductor-recover-backup")).toBeUndefined();
    expect(at("conductor-recover-empty")).toBeUndefined();
  });
});

describe("a RECORD kolu could not read", () => {
  it("offers the newest backup that reads, and asks nobody to edit anything", () => {
    const { at } = mount({ unreadable: unreadable() });
    const backup = at("conductor-recover-backup");
    expect(backup?.textContent).toBe("Restore the newest backup that reads");
    backup?.click();
    expect(verbs.recoverStore).toHaveBeenCalledWith("works", "backup");
    expect(at("conductor-retry")).toBeUndefined();
    expect(at("conductor-refusal-detail")?.textContent).toContain("worktree");
  });

  it("names the file the unreadable value is kept in, before emptying anything", () => {
    const { at } = mount({ unreadable: unreadable() });
    expect(at("conductor-recover-empty")?.textContent).toBe(
      "Start with no works",
    );
    at("conductor-recover-empty")?.click();
    expect(verbs.recoverStore).not.toHaveBeenCalled();
    const copy = at("conductor-recover-empty-confirm")?.parentElement
      ?.parentElement?.textContent;
    expect(copy).toContain(
      "/home/me/.config/kolu/conductor/unreadable-works-2026-01-01.json",
    );
    expect(copy).toContain("nothing is deleted");
    at("conductor-recover-empty-confirm")?.click();
    expect(verbs.recoverStore).toHaveBeenCalledWith("works", "empty");
  });

  it("offers NO backup for a record no backup holds — the refusal says so", () => {
    const { at } = mount({
      unreadable: unreadable({
        key: "transcript",
        path: "/home/me/.config/kolu/conductor/transcript.json",
        keepsAt:
          "/home/me/.config/kolu/conductor/unreadable-transcript-2026-01-01.json",
        inBackups: false,
      }),
    });
    expect(at("conductor-recover-backup")).toBeUndefined();
    expect(at("conductor-recover-empty")?.textContent).toBe(
      "Start with an empty transcript",
    );
    at("conductor-recover-empty")?.click();
    at("conductor-recover-empty-confirm")?.click();
    expect(verbs.recoverStore).toHaveBeenCalledWith("transcript", "empty");
  });
});
