// @vitest-environment happy-dom
/**
 * The Work cluster must repaint when the ACTIVE TERMINAL changes.
 *
 * The Inspector is mounted ONCE and fed a changing `meta` prop — `RightPanel`
 * keeps both tabs alive and only `display:none`s the inactive one, so nothing
 * ever remounts this section on a terminal switch. Every chip therefore has to
 * read its value reactively; a value snapshotted into a `const` at first render
 * freezes for the life of the panel.
 *
 * That is exactly what shipped: `Show when={git && colors()}` narrowed to the
 * colours and the body then did `const git = props.meta.git!`, so branch + repo
 * pinned to whichever terminal painted first and never moved again, while the
 * directory line right beneath them (read inline in JSX) kept updating.
 *
 * So these tests switch the terminal and assert the chips CHANGED. The existing
 * e2e seam asserts only that `inspector-branch` is non-empty, which stale text
 * satisfies — non-emptiness is not the property that broke.
 */

import {
  type ActiveTerminal,
  LOCAL_LOCATION,
  type TerminalMetadata,
} from "@kolu/padi-client/surface";
import type { TerminalId } from "kolu-common/surface";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";
import {
  assignColors,
  buildTerminalDisplayInfos,
} from "../terminal/terminalDisplay";
import WorkSection from "./WorkSection";

let dispose: (() => void) | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  host?.remove();
  dispose = undefined;
  host = undefined;
});

type ActivePr = ActiveTerminal["pr"];

function terminal(git: {
  repoName: string;
  branch: string;
  isWorktree?: boolean;
  cwd: string;
  pr?: ActivePr;
}): TerminalMetadata {
  return {
    state: "active",
    cwd: git.cwd,
    git: {
      repoRoot: git.cwd,
      repoName: git.repoName,
      worktreePath: git.cwd,
      branch: git.branch,
      isWorktree: git.isWorktree ?? false,
      mainRepoRoot: `/home/srid/code/${git.repoName}`,
      remoteUrl: null,
    },
    location: LOCAL_LOCATION,
    pr: git.pr ?? { kind: "absent" },
    agent: null,
    foreground: null,
    ports: { status: "unknown" },
    lastActivityAt: 0,
  };
}

/** The two terminals from the field report: the Inspector painted `resize-bug`
 *  / `kolu` first, then kept showing it while the user switched to `pi`. */
const RESIZE_BUG = terminal({
  repoName: "kolu",
  branch: "resize-bug",
  isWorktree: true,
  cwd: "/home/srid/code/kolu/.worktrees/resize-bug",
});
const PI = terminal({
  repoName: "AI",
  branch: "docs/pesu-chat-rewrite",
  cwd: "/home/srid/code/AI/.worktrees/pi",
});

function mount(initial: TerminalMetadata) {
  const [meta, setMeta] = createSignal(initial);
  host = document.createElement("div");
  document.body.append(host);
  dispose = render(() => <WorkSection meta={meta()} />, host);
  return { setMeta };
}

const el = (testid: string) =>
  host?.querySelector<HTMLElement>(`[data-testid="${testid}"]`);

const text = (testid: string) => el(testid)?.textContent?.trim();

/** `--chip-hue` sits on the chip FRAME: `inspector-branch` is itself the frame,
 *  and the repo frame is `inspector-repo-chip`. */
const hue = (testid: string) =>
  el(testid)?.style.getPropertyValue("--chip-hue");

describe("WorkSection identity chips", () => {
  it("repaints branch, repo, and directory when the terminal switches", () => {
    const { setMeta } = mount(RESIZE_BUG);

    expect(text("inspector-branch")).toBe("resize-bug");
    expect(text("inspector-repo")).toBe("kolu");
    expect(text("inspector-directory")).toBe(
      "/home/srid/code/kolu/.worktrees/resize-bug",
    );

    setMeta(PI);

    // The directory is read inline in JSX and has always updated — assert it
    // FIRST so a harness that simply never re-rendered fails here rather than
    // letting the chip assertions below pass for the wrong reason.
    expect(text("inspector-directory")).toBe(
      "/home/srid/code/AI/.worktrees/pi",
    );
    expect(text("inspector-branch")).toBe("docs/pesu-chat-rewrite");
    expect(text("inspector-repo")).toBe("AI");
  });

  /** The glyph lives OUTSIDE the `inspector-repo` testid, so no assertion above
   *  can see it — snapshot `RepoMonogram`'s `group` and they all stay green
   *  while the visible letter sits on the previous repo. */
  it("repaints the repo monogram glyph when the terminal switches", () => {
    const { setMeta } = mount(RESIZE_BUG);

    expect(text("inspector-repo-monogram")).toBe("K");

    setMeta(PI);

    expect(text("inspector-repo-monogram")).toBe("A");
  });

  it("drops the worktree glyph when switching to a non-worktree terminal", () => {
    const { setMeta } = mount(RESIZE_BUG);
    const branch = () => el("inspector-branch");

    expect(branch()?.getAttribute("title")).toBe("worktree");
    expect(branch()?.querySelector("svg")).not.toBeNull();

    setMeta(PI);

    expect(branch()?.getAttribute("title")).toBeNull();
    expect(branch()?.querySelector("svg")).toBeNull();
  });

  /** Paint is derived from the git NAMES alone (`assignColors`, a pure function
   *  of the key string) — the same derivation the dock's fleet-wide projection
   *  feeds on, which is the stated justification for the Inspector holding no
   *  store read at all.
   *
   *  So assert the EXACT expected hue, computed from `assignColors` itself, not
   *  merely that the values look like `oklch(...)` and moved. A shape-only
   *  assertion stays green if the two `color=` props are swapped — branch chip
   *  wearing the repo hue and vice versa — which is precisely the
   *  chips-disagree-with-the-dock failure this file claims to defend against. */
  it("paints each chip the exact fleet hue for its own git name", () => {
    const expected = (repo: string, branch: string) => {
      const colors = assignColors([repo, branch]);
      return { repo: colors.get(repo), branch: colors.get(branch) };
    };

    const { setMeta } = mount(RESIZE_BUG);
    const kolu = expected("kolu", "resize-bug");
    expect(hue("inspector-repo-chip")).toBe(kolu.repo);
    expect(hue("inspector-branch")).toBe(kolu.branch);

    setMeta(PI);

    const ai = expected("AI", "docs/pesu-chat-rewrite");
    expect(hue("inspector-repo-chip")).toBe(ai.repo);
    expect(hue("inspector-branch")).toBe(ai.branch);
    // BOTH must have moved. The bug pinned the first terminal's pair for the
    // life of the panel, so a single-hue assertion would not have caught it.
    expect(ai.repo).not.toBe(kolu.repo);
    expect(ai.branch).not.toBe(kolu.branch);
  });

  /** The Inspector's chips are supposed to wear the SAME hue the dock paints
   *  for the same terminal — that equality is why this component reads no store.
   *  Nothing pinned it, so a change to `terminalKey`'s git arm, or to which key
   *  `buildTerminalDisplayInfos` colours by, would drift the two apart silently.
   *  Assert against the dock's own projection rather than restating its rule. */
  it("wears the same hues the dock projection paints for that terminal", () => {
    const id = "t1" as TerminalId;
    const dock = buildTerminalDisplayInfos(
      [id],
      () => RESIZE_BUG,
      () => [],
    ).get(id);
    if (!dock) throw new Error("no display info built for the fixture");

    mount(RESIZE_BUG);

    expect(hue("inspector-repo-chip")).toBe(dock.repoColor);
    expect(hue("inspector-branch")).toBe(dock.annotationColor);
  });
});

/** The PR/CI half of the cluster reaches through the same one-memo-one-accessor
 *  shape the git half does, so it can freeze the same way — and the identity
 *  tests above would stay green while it did, because every fixture there has
 *  `pr: absent`. These pin the whole PR path across a switch: link, number,
 *  title, rollup, and the per-check list. */
describe("WorkSection PR and CI", () => {
  const GREEN = terminal({
    repoName: "kolu",
    branch: "resize-bug",
    cwd: "/home/srid/code/kolu/.worktrees/resize-bug",
    pr: {
      kind: "ok",
      value: {
        number: 2037,
        title: "Repo identity paints the same way across Kolu",
        state: "open",
        url: "https://github.test/pull/2037",
        checks: "pass",
        checkRuns: [
          { name: "ci::biome", outcome: "pass" },
          { name: "ci::nix", outcome: "pass" },
        ],
      },
    },
  });
  const RED = terminal({
    repoName: "AI",
    branch: "docs/pesu-chat-rewrite",
    cwd: "/home/srid/code/AI/.worktrees/pi",
    pr: {
      kind: "ok",
      value: {
        number: 2072,
        title: "Inspector chips follow the terminal you're on",
        state: "open",
        url: "https://github.test/pull/2072",
        checks: "fail",
        // Deliberately NOT in triage order — a fixture authored as
        // fail/pending/pass would make the ordering assertion below echo its
        // own input and stay green with the production sort deleted.
        checkRuns: [
          { name: "ci::biome", outcome: "pass" },
          { name: "ci::typecheck", outcome: "fail" },
          { name: "ci::e2e", outcome: "pending" },
        ],
      },
    },
  });

  // By testid, not `a[href]` — `ProviderUnavailableContent` also renders an
  // anchor, so a bare tag query silently retargets the moment it appears.
  const prLink = () => el("inspector-pr-link") as HTMLAnchorElement | undefined;
  const checkNames = () =>
    [
      ...(host?.querySelectorAll('[data-testid="inspector-pr-checks"] li') ??
        []),
    ]
      .map((li) => li.textContent?.trim())
      .filter(Boolean);

  it("repaints link, number, title, rollup, and check list on a switch", () => {
    const { setMeta } = mount(GREEN);

    expect(prLink()?.getAttribute("href")).toBe(
      "https://github.test/pull/2037",
    );
    expect(prLink()?.textContent).toContain("#2037");
    expect(text("inspector-ci")).toBe("✓ 2 passed");
    expect(checkNames()).toEqual(["ci::biome", "ci::nix"]);

    setMeta(RED);

    expect(prLink()?.getAttribute("href")).toBe(
      "https://github.test/pull/2072",
    );
    expect(prLink()?.textContent).toContain("#2072");
    // The rollup's VERDICT and its COUNT come out of one read, so they can
    // never describe two different PRs — a green tally under a red verdict.
    expect(text("inspector-ci")).toBe("✕ 1 failed");
    // Exceptions sort first.
    expect(checkNames()).toEqual(["ci::typecheck", "ci::e2e", "ci::biome"]);
    expect(host?.textContent).toContain(
      "Inspector chips follow the terminal you're on",
    );
    expect(host?.textContent).not.toContain(
      "Repo identity paints the same way",
    );
  });

  it("clears the whole PR cluster when switching to a terminal without one", () => {
    const { setMeta } = mount(GREEN);
    expect(el("inspector-ci")).not.toBeNull();

    setMeta(PI);

    expect(prLink()).toBeNull();
    expect(el("inspector-ci")).toBeNull();
    expect(el("inspector-pr-checks")).toBeNull();
    expect(host?.textContent).not.toContain(
      "Repo identity paints the same way",
    );
    // The identity half must still have followed the switch.
    expect(text("inspector-branch")).toBe("docs/pesu-chat-rewrite");
  });
});
