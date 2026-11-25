// @vitest-environment happy-dom
/**
 * A WORK'S WORKTREE PART hands the Right panel's Work section the work's own
 * facts: the repository and branch from its key, the folder git last named
 * for that key, whether that folder is a linked worktree (it is not the
 * repository's root), and the work's own pull request. No member is asked:
 * the part takes none.
 */

import type { PrInfo } from "anyforge/schemas";
import { Option } from "effect";
import { ABOUT_WORK, type Work } from "kolu-work";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkSubject } from "../right-panel/WorkSection";
import { type WorkPr, workPrOf } from "./workPr";

const handed = vi.hoisted(() => ({ subject: null as unknown }));

// The section itself is the Right panel's, tested where it lives; what is
// pinned here is WHAT this part hands it.
vi.mock("../right-panel/WorkSection", () => ({
  default: (props: { subject: unknown }) => {
    handed.subject = props.subject;
    return <span data-testid="work-section-stub" />;
  },
}));
vi.mock("../right-panel/useOduLink", () => ({ useOduLink: () => undefined }));

import WorkWorktree from "./WorkWorktree";

const REPO = "/srv/code/tidepool";
const WORKTREE = "/srv/code/tidepool/.worktrees/csv";

const work = (worktree: Work["worktree"]): Work => ({
  key: {
    kind: "branch",
    host: "local",
    repo: REPO,
    branch: "feat/csv-export",
    repoBy: { kind: "git" },
  },
  title: "Add CSV export",
  events: [],
  decisions: [],
  startedAt: "2026-01-01T09:00:00.000Z",
  state: { kind: "open" },
  worktree,
});

const INFO: PrInfo = {
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

/** #412 as the work's own PR — its timeline names it. */
const PR: WorkPr = Option.getOrThrow(
  workPrOf(
    {
      ...work({ kind: "unread" }),
      events: [
        {
          at: "2026-01-01T09:00:00.000Z",
          by: "kolu",
          kind: "pr-opened",
          about: ABOUT_WORK,
          pr: 412,
          title: "Add CSV export",
          url: { kind: "link", href: INFO.url },
          draft: "ready",
        },
      ],
    },
    { kind: "ok", value: INFO },
  ),
);

let dispose: (() => void) | undefined;
let host: HTMLElement;
afterEach(() => {
  dispose?.();
  handed.subject = null;
});

function mount(one: Work, pr: Option.Option<WorkPr>): WorkSubject {
  host = document.createElement("div");
  dispose = render(() => <WorkWorktree work={one} pr={pr} />, host);
  return handed.subject as WorkSubject;
}

describe("a work's worktree part", () => {
  it("draws the key's branch in the folder git named, a linked worktree when it is not the root", () => {
    const subject = mount(work({ kind: "at", path: WORKTREE }), Option.none());
    expect(subject.directory).toBe(WORKTREE);
    expect(subject.git?.branch).toBe("feat/csv-export");
    expect(subject.git?.mainRepoRoot).toBe(REPO);
    expect(subject.git?.isWorktree).toBe(true);
    expect(subject.pr).toBeNull();
  });

  it("says the main checkout is not a linked worktree", () => {
    const subject = mount(work({ kind: "at", path: REPO }), Option.none());
    expect(subject.git?.isWorktree).toBe(false);
  });

  it("hands over the work's own PR", () => {
    const subject = mount(
      work({ kind: "at", path: WORKTREE }),
      Option.some(PR),
    );
    expect(subject.pr).toEqual({ kind: "ok", value: PR });
  });

  it("says so when the branch is checked out nowhere, and when git has not been asked", () => {
    mount(work({ kind: "absent" }), Option.none());
    expect(
      host.querySelector('[data-testid="work-worktree-absent"]'),
    ).not.toBeNull();
    expect(handed.subject).toBeNull();
    dispose?.();
    mount(work({ kind: "unread" }), Option.none());
    expect(
      host.querySelector('[data-testid="work-worktree-unread"]'),
    ).not.toBeNull();
  });
});
