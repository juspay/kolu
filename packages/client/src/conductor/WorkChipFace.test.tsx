// @vitest-environment happy-dom
/**
 * A WORK'S CHIP, wherever it is drawn: the dot, the title, and the
 * repository's name — the word the card's subtitle says — after it. A watch
 * has no repository, so its chip names none.
 */

import type { Work } from "kolu-work";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";
import WorkChipFace from "./WorkChipFace";

const work = (key: Work["key"], title: string): Work => ({
  key,
  title,
  events: [],
  decisions: [],
  startedAt: "2026-01-01T09:00:00.000Z",
  state: { kind: "open" },
  worktree: { kind: "unread" },
});

let dispose: (() => void) | undefined;
afterEach(() => dispose?.());

function mount(one: Work): HTMLElement {
  const host = document.createElement("div");
  dispose = render(() => <WorkChipFace work={one} />, host);
  return host;
}

const part = (el: HTMLElement, id: string) =>
  el.querySelector<HTMLElement>(`[data-testid="${id}"]`);

describe("a work's chip", () => {
  it("names a branch work's repository after its title", () => {
    const el = mount(
      work(
        {
          kind: "branch",
          host: "local",
          repo: "/srv/code/tidepool/",
          branch: "feat/csv-export",
          repoBy: { kind: "git" },
        },
        "Add CSV export",
      ),
    );
    expect(part(el, "work-chip-repo")?.textContent).toBe("tidepool");
    expect(part(el, "work-chip-face")?.textContent).toBe(
      "Add CSV exporttidepool",
    );
  });

  it("names no repository for a watch", () => {
    const el = mount(
      work({ kind: "watch", host: "local", id: "a" }, "Keep an eye on it"),
    );
    expect(part(el, "work-chip-repo")).toBeNull();
    expect(part(el, "work-chip-face")?.textContent).toBe("Keep an eye on it");
  });
});
