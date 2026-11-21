// @vitest-environment happy-dom
/**
 * The line under a work's title wears the Dock's identity colours — the same
 * hue for the same repository and branch as the Dock's own display projection
 * gives a terminal there — and carries the Dock's PR pip only while a member's
 * record has the PR live.
 */

import { LOCAL_LOCATION } from "@kolu/padi-client/surface";
import type { TerminalMetadata } from "@kolu/padi-client/surface";
import type { PrInfo } from "anyforge/schemas";
import type { TerminalId } from "kolu-common/surface";
import type { Work } from "kolu-work";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";
import { buildTerminalDisplayInfos } from "../terminal/terminalDisplay";
import WorkSubtitle from "./WorkSubtitle";

const work = (key: Work["key"]): Work => ({
  key,
  title: "Add CSV export",
  events: [],
  decisions: [],
  startedAt: "2026-01-01T09:00:00.000Z",
  state: { kind: "open" },
});

const BRANCH_WORK = work({
  kind: "branch",
  host: "local",
  repo: "/srv/code/tidepool",
  branch: "feat/csv-export",
});

const PR: PrInfo = {
  number: 412,
  title: "Add CSV export",
  state: "open",
  url: "https://example.test/pull/412",
  checks: "pending",
  checkRuns: [],
  reviewDecision: null,
  mergeStateStatus: "UNKNOWN",
  headSha: null,
  isDraft: false,
};

/** A terminal in the same repository on the same branch, as the Dock sees it. */
const DOCK_TERMINAL: TerminalMetadata = {
  state: "active",
  cwd: "/srv/code/tidepool",
  git: {
    kind: "repo",
    info: {
      repoRoot: "/srv/code/tidepool",
      repoName: "tidepool",
      worktreePath: "/srv/code/tidepool",
      branch: "feat/csv-export",
      isWorktree: false,
      mainRepoRoot: "/srv/code/tidepool",
      remoteUrl: null,
      isBare: false,
    },
  },
  location: LOCAL_LOCATION,
  pr: { kind: "absent" },
  agent: null,
  foreground: null,
  ports: { status: "unknown" },
  lastActivityAt: 0,
  promptedAt: null,
} as TerminalMetadata;

let dispose: (() => void) | undefined;
afterEach(() => dispose?.());

function mount(one: Work, livePr: PrInfo | null): HTMLElement {
  const host = document.createElement("div");
  dispose = render(() => <WorkSubtitle work={one} livePr={livePr} />, host);
  return host;
}

const part = (el: HTMLElement, id: string) =>
  el.querySelector<HTMLElement>(`[data-testid="${id}"]`);

describe("the line under a work's title", () => {
  it("paints the repository and branch in the hues the Dock gives them", () => {
    const id = "t" as TerminalId;
    const dock = buildTerminalDisplayInfos(
      [id],
      () => DOCK_TERMINAL,
      () => [id],
    ).get(id);
    const el = mount(BRANCH_WORK, null);
    expect(part(el, "work-branch")?.textContent).toBe("feat/csv-export");
    expect(
      part(el, "work-branch")?.style.getPropertyValue("--annotation-color"),
    ).toBe(dock?.annotationColor);
    expect(
      part(el, "work-repo-monogram")?.style.getPropertyValue("--repo-color"),
    ).toBe(dock?.repoColor);
  });

  it("carries the PR pip only while the PR is live", () => {
    expect(part(mount(BRANCH_WORK, null), "dock-row-pr-pip")).toBeNull();
    dispose?.();
    const pip = part(mount(BRANCH_WORK, PR), "dock-row-pr-pip");
    expect(pip?.getAttribute("href")).toBe("https://example.test/pull/412");
  });

  it("says a watch is a watch, with no repository to paint", () => {
    const el = mount(work({ kind: "watch", terminal: "local/a" }), null);
    expect(part(el, "work-repo-monogram")).toBeNull();
    expect(part(el, "work-branch")).toBeNull();
    expect(part(el, "work-subtitle")?.textContent).toContain("watching");
  });
});
