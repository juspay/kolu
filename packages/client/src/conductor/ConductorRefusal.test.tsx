// @vitest-environment happy-dom
/**
 * THE PANEL UNDER A CONDUCTOR THAT WOULD NOT COME UP — and the difference
 * between the two reasons it would not.
 *
 * An agent that said no gets *Try again*: asking again for exactly what was
 * refused is a thing that can work. A RECORD KOLU COULD NOT READ gets neither
 * *Try again* (the same file would answer the same way) nor the sentence this
 * panel used to end on — "Fix the `works` key to recover", which is kolu
 * handing its own job to somebody holding a JSON file. It gets the two things
 * kolu can do: the newest backup that reads, and starting with that record
 * empty, the unreadable value kept aside in a NAMED file the confirm says out
 * loud.
 */

import {
  type ConductorState,
  type ConductorUnreadable,
  DEFAULT_CONDUCTOR_STATE,
} from "kolu-common/conductor";
import { render } from "@solidjs/web";
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
  // WHERE IT GOES IS THE SERVER'S ANSWER. The browser quotes this rather
  // than rebuilding it out of `path` and a file-name grammar of its own —
  // which is how the confirm came to promise a file that might not exist.
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
    // *Try again* is gone: it would ask the same file the same question.
    expect(at("conductor-retry")).toBeUndefined();
    // The schema's own words are on screen for a bug report — beside the
    // sentence, not instead of it.
    expect(at("conductor-refusal-detail")?.textContent).toContain("worktree");
  });

  it("names the file the unreadable value is kept in, before emptying anything", () => {
    const { at } = mount({ unreadable: unreadable() });
    expect(at("conductor-recover-empty")?.textContent).toBe(
      "Start with no works",
    );
    // One press OPENS the confirm; it does not act.
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
        // WHETHER THE RING HOLDS IT is the host's fact, carried on the
        // refusal — never inferred in the browser from the record's name.
        inBackups: false,
      }),
    });
    // A button promising a snapshot of a file the ring never takes is a lie a
    // person finds out about by pressing it.
    expect(at("conductor-recover-backup")).toBeUndefined();
    expect(at("conductor-recover-empty")?.textContent).toBe(
      "Start with an empty transcript",
    );
    at("conductor-recover-empty")?.click();
    at("conductor-recover-empty-confirm")?.click();
    expect(verbs.recoverStore).toHaveBeenCalledWith("transcript", "empty");
  });
});
