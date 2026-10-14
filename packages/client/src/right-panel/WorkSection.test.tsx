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
import type {
  CheckoutFrame,
  RunNode,
  RunRow,
} from "@odu/service-client/surface";
import type { OduLinkOutlet } from "./useOduLink";
import type { TerminalId } from "kolu-common/surface";
import { type Accessor, createSignal, type JSX } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assignColors,
  buildTerminalDisplayInfos,
} from "../terminal/terminalDisplay";
import { PanelShown } from "./panelShown";
import WorkSection from "./WorkSection";

/** The section's ONE subscription, as a holder the cases drive: odu's own
 *  `checkout` stream, reached through padi's odu SIBLING. The wire is mocked
 *  rather than dialled because what these cases assert is what the section
 *  PAINTS from a frame and what it ASKS for — not that a socket answers — and
 *  `checkoutInput` is what makes the second assertable: it is the live input
 *  accessor the section handed `.use()`, so a case can read the repo root the
 *  subscription is keyed by (and the `null` that is "do not subscribe"). */
const wire = vi.hoisted(() => ({
  frame: (() => undefined) as () => CheckoutFrame | undefined,
  error: (() => undefined) as () => Error | undefined,
  input: null as null | (() => { repoRoot: string } | null),
}));

vi.mock("../wire", () => ({
  activeHost: () => ({ kind: "local" }),
  interpretClientError: () => {},
  padiMap: {
    useEntry: () => ({
      odu: {
        streams: {
          checkout: {
            use: (input: () => { repoRoot: string } | null) => {
              wire.input = input;
              const sub: Accessor<CheckoutFrame | undefined> & {
                error: () => Error | undefined;
              } = Object.assign(() => wire.frame(), {
                error: () => wire.error(),
              });
              return sub;
            },
          },
        },
      },
    }),
  },
}));

let dispose: (() => void) | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  host?.remove();
  dispose = undefined;
  host = undefined;
  wire.frame = () => undefined;
  wire.error = () => undefined;
  wire.input = null;
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
      kind: "repo",
      info: {
        repoRoot: git.cwd,
        repoName: git.repoName,
        worktreePath: git.cwd,
        branch: git.branch,
        isWorktree: git.isWorktree ?? false,
        mainRepoRoot: `/home/srid/code/${git.repoName}`,
        remoteUrl: null,
      },
    },
    location: LOCAL_LOCATION,
    pr: git.pr ?? { kind: "absent" },
    agent: null,
    foreground: null,
    ports: { status: "unknown" },
    lastActivityAt: 0,
    promptedAt: null,
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

/** Render under a SHOWN panel — the section's subscription is shown-gated, so a
 *  mount without this context would ask for nothing and every odu case would
 *  pass on an empty readout. `panelShown` throws without a provider, which is
 *  what keeps that mistake from being silent. */
function paint(body: () => JSX.Element) {
  host = document.createElement("div");
  document.body.append(host);
  dispose = render(
    () => (
      <PanelShown.Provider value={() => true}>{body()}</PanelShown.Provider>
    ),
    host,
  );
}

function mount(initial: TerminalMetadata) {
  const [meta, setMeta] = createSignal(initial);
  paint(() => <WorkSection meta={meta()} />);
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
        reviewDecision: "APPROVED",
        mergeStateStatus: "CLEAN",
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
        reviewDecision: "CHANGES_REQUESTED",
        mergeStateStatus: "BLOCKED",
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

describe("WorkSection odu CI readout", () => {
  /** A board row as odu publishes it — every field the wire requires, so a
   *  schema change is a compile error in this fixture rather than a silent
   *  drift between what the tests assert and what padi sends. */
  function oduRow(overrides: Partial<RunRow> = {}): RunRow {
    return {
      runId: "run-1",
      repo: "dev/repo",
      repoRoot:
        RESIZE_BUG.git.kind === "repo" ? RESIZE_BUG.git.info.repoRoot : "",
      branch: "resize-bug",
      sha: "0123456789abcdef0123456789abcdef01234567",
      dirty: true,
      seq: 3,
      pipeline: "ci",
      createdAt: Date.now() - 90_000,
      state: "settled",
      settled: true,
      passed: false,
      outcome: "failed",
      actionable: true,
      unresolvedFailures: 1,
      scope: { selectors: [], platforms: [], noDeps: false },
      reportingDebt: 0,
      endpoint: null,
      parentRunId: null,
      cursor: "run-1:9",
      ...overrides,
    };
  }

  function oduNode(id: string, status: RunNode["status"]): RunNode {
    return {
      id,
      status,
      attempt: 1,
      exitCode: null,
      startedAt: null,
      durationMs: 1_500,
      host: "box-1",
      logKey: `run-1/linux/${id}`,
    };
  }

  /** ONE CHECKOUT as odu's own `checkout` stream publishes it: the run the
   *  checkout stands for with that run's nodes, the short history behind it, and
   *  the count of runs that history is a window onto. */
  function checkoutFrame(): CheckoutFrame {
    return {
      latest: {
        run: oduRow(),
        // The run's own schedule, NOT in triage order: the section sorts its
        // lanes, so a fixture already failures-first would assert nothing.
        nodes: [
          oduNode("ci::typecheck@x86_64-linux", "ok"),
          oduNode("ci::e2e@x86_64-linux", "failed"),
        ],
      },
      recent: [
        oduRow(),
        // An older, GREEN run: `outcome` is the word odu reads once a run has
        // one, so the fixture must state it (a default `outcome: "failed"` would
        // be the very disagreement this fold exists to prevent).
        oduRow({
          runId: "run-0",
          seq: 2,
          passed: true,
          state: "settled",
          outcome: "passed",
          dirty: false,
        }),
      ],
      total: 2,
    };
  }

  /** Mount the section over a REACTIVE frame — the Inspector is fed changing
   *  values and nothing remounts it, so the frame is a signal here for the same
   *  reason `meta` is: a value snapshotted at first render freezes. Returns the
   *  setter, so a case can land a second frame on the SAME section. */
  function mountWithOdu(
    frame: CheckoutFrame | undefined,
    odu: { link?: OduLinkOutlet; error?: Error } = {},
  ) {
    const [current, setFrame] = createSignal<CheckoutFrame | undefined>(frame);
    wire.frame = current;
    wire.error = () => odu.error;
    paint(() => <WorkSection meta={RESIZE_BUG} odu={odu.link} />);
    return setFrame;
  }

  it("paints the rollup chip, the lanes and the recent runs", () => {
    mountWithOdu(checkoutFrame());

    // The chip: the verdict's own glyph/word plus the count of RED lanes, and
    // the ref the run is known by (`+dirty` because it tested a working tree).
    expect(text("inspector-odu-chip")).toBe("✕ 1 failed 0123456#3+dirty");

    const lanes = el("inspector-odu-lanes")?.querySelectorAll("li");
    expect(lanes?.length).toBe(2);
    // The lane's own facts: the failing one, its duration and its host — and it
    // is FIRST although the run scheduled it second, which is this face's
    // triage and not the wire's order.
    expect(lanes?.[0]?.textContent).toContain("ci::e2e@x86_64-linux");
    expect(lanes?.[1]?.textContent).toContain("ci::typecheck@x86_64-linux");
    // kolu's own ladder, not a second duration formatter.
    expect(lanes?.[0]?.textContent).toContain("1s");
    expect(lanes?.[0]?.textContent).toContain("box-1");
    // The glyph is odu's own (`STATUS_META`), painted by odu's hue.
    expect(lanes?.[0]?.textContent).toContain("✗");

    const recent = el("inspector-odu-recent")?.querySelectorAll("li");
    expect(recent?.length).toBe(2);
    expect(recent?.[0]?.textContent).toContain("0123456#3+dirty");
    expect(recent?.[0]?.textContent).toContain("failed");
    // The head of the list IS the run the chip is about — said, not implied.
    expect(recent?.[0]?.textContent).toContain("current");
    expect(recent?.[1]?.textContent).toContain("0123456#2");
    expect(recent?.[1]?.textContent).toContain("passed");
    expect(recent?.[1]?.textContent).not.toContain("current");
  });

  it("renders NOTHING when odu has nothing to say", () => {
    // A checkout nobody has run CI in — and, because padi's relay answers
    // `CHECKOUT_NONE` for an absent daemon, a machine with no odu on it. The two
    // are the same frame on purpose, and this is the whole of "a non-odu user's
    // Inspector is unchanged".
    mountWithOdu({ latest: null, recent: [], total: 0 });
    expect(el("inspector-odu-chip")).toBeNull();
    expect(el("inspector-odu")).toBeNull();
    expect(el("inspector-odu-lanes")).toBeNull();
    expect(el("inspector-odu-recent")).toBeNull();
  });

  it("reads a passed run as a pass, and a lane-less running run as running", () => {
    mountWithOdu({
      latest: {
        run: oduRow({
          state: "settled",
          passed: true,
          dirty: false,
          outcome: "passed",
          unresolvedFailures: 0,
        }),
        nodes: [],
      },
      recent: [oduRow({ state: "settled", passed: true })],
      total: 1,
    });
    expect(text("inspector-odu-chip")).toBe("✓ odu passed 0123456#3");
    // No lanes yet (a run that has not placed any): the disclosure states the
    // count it has, and renders no list.
    expect(el("inspector-odu-lanes")).toBeNull();
    expect(el("inspector-odu")?.textContent).toContain("0 lanes");
  });

  it("repaints the chip, the lanes and the recent list when a NEW frame arrives", () => {
    const setFrame = mountWithOdu({
      latest: {
        run: oduRow({
          state: "running",
          settled: false,
          passed: false,
          outcome: null,
        }),
        nodes: [oduNode("ci::fmt@x86_64-linux", "running")],
      },
      recent: [oduRow({ state: "running", outcome: null })],
      total: 1,
    });
    expect(text("inspector-odu-chip")).toBe("● odu running 0123456#3+dirty");
    expect(el("inspector-odu-lanes")?.textContent).toContain(
      "ci::fmt@x86_64-linux",
    );

    // The run settles: the same section, one new frame, no remount.
    setFrame({
      latest: {
        run: oduRow({ state: "settled", passed: false, outcome: "failed" }),
        nodes: [oduNode("ci::fmt@x86_64-linux", "failed")],
      },
      recent: [oduRow({ state: "settled", outcome: "failed" })],
      total: 1,
    });
    expect(text("inspector-odu-chip")).toBe("✕ 1 failed 0123456#3+dirty");
    // A lane's status is its glyph (painted by odu's hue) and its title, not a
    // word: the row says what the lane IS, and the chip above states the verdict.
    const lane = el("inspector-odu-lanes")?.querySelector("li");
    expect(lane?.textContent).toContain("✗");
    expect(lane?.querySelector("span")?.getAttribute("title")).toBe("failed");
  });

  it("reads a torn-down run as INCOMPLETE, not failed (odu's own precedence)", () => {
    // `passed: false` with `outcome: "incomplete"` is a cancel or an interrupt.
    // odu's schema says painting it `failed` sends an operator looking for a
    // test that broke, so the fold reads the OUTCOME once there is one.
    mountWithOdu({
      latest: {
        run: oduRow({
          state: "settled",
          passed: false,
          outcome: "incomplete",
          unresolvedFailures: 0,
        }),
        nodes: [oduNode("ci::fmt@x86_64-linux", "cancelled")],
      },
      recent: [oduRow({ state: "settled", outcome: "incomplete" })],
      total: 1,
    });
    expect(text("inspector-odu-chip")).toBe("● odu incomplete 0123456#3+dirty");
    expect(el("inspector-odu-recent")?.textContent).toContain("incomplete");
  });

  it("opens the lanes by DEFAULT — a run is the thing being watched", () => {
    // The disclosure is not an exception-driven fold: a run IS the work in
    // progress, so its lanes are open for a green run, a red one and an
    // interrupted one alike (and it can still be collapsed by hand).
    mountWithOdu(checkoutFrame());
    expect(el("inspector-odu")?.hasAttribute("open")).toBe(true);
  });

  it("opens the run's page from a recent row and from the chip", () => {
    // Every odu surface in the section reaches odu web through ONE outlet: the
    // fragment is the caller's (odu's own `runHash`), so a row and the chip it
    // belongs to address the same page.
    mountWithOdu(checkoutFrame(), {
      link: {
        act: (hash) => ({
          kind: "address",
          href: `http://pureintent:61003/${hash}`,
        }),
        open: () => {},
      },
    });
    const rows = el("inspector-odu-recent")?.querySelectorAll(
      "[data-testid='inspector-odu-run-link']",
    );
    expect(rows?.length).toBe(2);
    expect(rows?.[0]?.getAttribute("href")).toBe(
      "http://pureintent:61003/#/run/run-1",
    );
    // The CHIP is the same surface for the head run: it marks itself (so a
    // reader finds it either way) and the element AROUND it is the real anchor,
    // with the same address — ⌘-click and copy work on it too.
    const chip = el("inspector-odu-chip");
    expect(chip?.tagName).toBe("SPAN");
    expect(chip?.closest("a")?.getAttribute("href")).toBe(
      "http://pureintent:61003/#/run/run-1",
    );
    expect(chip?.closest("button")).toBeNull();
  });

  it("leaves a recent row a BUTTON until a door is listening", () => {
    // The same wrapper as a lane row: with no address yet there is nothing to
    // copy, so the click opens the door first.
    const opened: string[] = [];
    mountWithOdu(checkoutFrame(), {
      link: {
        act: () => ({ kind: "door" }),
        open: (hash) => opened.push(hash),
      },
    });
    const row = el("inspector-odu-recent")?.querySelector(
      "[data-testid='inspector-odu-run-link']",
    );
    expect(row?.tagName).toBe("BUTTON");
    expect(row?.getAttribute("href")).toBeNull();
    (row as HTMLElement).click();
    expect(opened).toEqual(["#/run/run-1"]);
  });

  it("names odu in its heading, and points at odu's site", () => {
    // A reader who has never heard of odu cannot tell what a lane list is made
    // of, so the heading says whose CI this is and opens its site in a new tab.
    mountWithOdu(checkoutFrame());
    const heading = el("inspector-odu-link");
    expect(heading?.textContent).toBe("CI by odu ↗");
    expect(heading?.getAttribute("href")).toBe("https://juspay.github.io/odu/");
    expect(heading?.getAttribute("target")).toBe("_blank");
    expect(heading?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(heading?.getAttribute("title")).toBe(
      "odu: the CI runner for this checkout",
    );
  });

  /** The disclosure's summary line — the lane count, the exceptions, and the
   *  run's scope, which is where a selection stops being read as the whole
   *  pipeline. Exact, because "contains ci::unit" passes with the scope deleted
   *  (the lane ids carry that word too). */
  const summary = (): string =>
    el("inspector-odu")?.querySelector("summary")?.textContent?.trim() ?? "";

  /** One run and its nodes, scoped however the case needs. */
  function scopedFrame(
    scope: RunRow["scope"],
    nodes: RunNode[] = [
      oduNode("ci::unit@x86_64-linux", "ok"),
      oduNode("ci::install@x86_64-linux", "ok"),
    ],
  ): CheckoutFrame {
    return {
      latest: { run: oduRow({ scope }), nodes },
      recent: [oduRow({ scope })],
      total: 1,
    };
  }

  it("states the run's SCOPE, in odu's own words", () => {
    // `2 lanes` over a `selectors: ["ci::unit"]` run reads as two lanes of a DAG
    // that never started: those lanes say nothing about the rest of the pipeline.
    mountWithOdu(
      scopedFrame({ selectors: ["ci::unit"], platforms: [], noDeps: false }),
    );
    expect(summary()).toBe("CI by odu ↗ · 2 lanes · ci::unit");
    expect(el("inspector-odu-recent")?.textContent).toContain("ci::unit");
  });

  it("says nothing extra for a whole-pipeline run", () => {
    // The full DAG has no qualifier to state — the fixture's own scope — and a
    // suffix saying so would be noise on every row of every run.
    mountWithOdu(scopedFrame({ selectors: [], platforms: [], noDeps: false }));
    expect(summary()).toBe("CI by odu ↗ · 2 lanes");
    expect(el("inspector-odu-recent")?.textContent).not.toContain(
      "whole pipeline",
    );
  });

  it("names a platform slice, --no-deps and --root, which are scope too", () => {
    // Each of the three is part of what the run covered, so each rides the same
    // qualifier a selection does.
    mountWithOdu(
      scopedFrame({
        selectors: [],
        platforms: ["x86_64-linux"],
        noDeps: false,
      }),
    );
    expect(summary()).toBe("CI by odu ↗ · 2 lanes · x86_64-linux");

    mountWithOdu(scopedFrame({ selectors: [], platforms: [], noDeps: true }));
    expect(summary()).toBe("CI by odu ↗ · 2 lanes · no deps");

    // A run rooted at a NAMEPATH expanded the DAG under it, so its lanes say as
    // little about the rest of the pipeline as a selection's do.
    mountWithOdu(
      scopedFrame({
        selectors: [],
        platforms: [],
        noDeps: false,
        root: "ci::install",
      }),
    );
    expect(summary()).toBe("CI by odu ↗ · 2 lanes · under ci::install");
    expect(el("inspector-odu-recent")?.textContent).toContain(
      "under ci::install",
    );
  });

  it("does not count lanes it cannot see: a failed run with no red lanes", () => {
    // The nodes stream failed, or the lanes have not arrived. `✕ 0 failed`
    // reads as a claim about the lanes; the verdict alone is what is true.
    mountWithOdu({
      latest: { run: oduRow(), nodes: [] },
      recent: [oduRow()],
      total: 1,
    });
    expect(text("inspector-odu-chip")).toBe("✕ odu failed 0123456#3+dirty");
    expect(summary()).toBe("CI by odu ↗ · 0 lanes");
  });

  it("keeps the scope in the summary when the run has exceptions", () => {
    // The count of red lanes and the scope are both about the SAME list, so the
    // line states them together — and the scope comes last, as the qualifier
    // for the whole line.
    mountWithOdu(
      scopedFrame({ selectors: ["ci::unit"], platforms: [], noDeps: false }, [
        oduNode("ci::unit@x86_64-linux", "failed"),
        oduNode("ci::install@x86_64-linux", "ok"),
      ]),
    );
    expect(summary()).toBe("CI by odu ↗ · 2 lanes · 1 failed · ci::unit");
  });

  it("makes each lane a link to its own log page in odu web", () => {
    // The row IS the way out: long output is read in odu's own page. With an
    // address in hand the wrapper is a REAL anchor, so ⌘-click, copy and "open
    // in new tab" are the browser's own.
    const opened: string[] = [];
    mountWithOdu(checkoutFrame(), {
      link: {
        act: () => ({
          kind: "address",
          href: "http://pureintent:61003/#/run/run-1/linux/2",
        }),
        open: () => opened.push("open"),
      },
    });
    const link = el("inspector-odu-lane-link");
    expect(link?.tagName).toBe("A");
    expect(link?.getAttribute("href")).toBe(
      "http://pureintent:61003/#/run/run-1/linux/2",
    );
    expect(link?.getAttribute("title")).toBe("open in odu");
    // Two lanes, two links.
    expect(
      el("inspector-odu-lanes")?.querySelectorAll(
        "[data-testid='inspector-odu-lane-link']",
      ).length,
    ).toBe(2);
  });

  it("makes a lane whose address needs a door a BUTTON, not a link", () => {
    // There is nothing to copy until a relay is listening, so the row is a
    // button — and the click is what opens the door.
    const opened: string[] = [];
    mountWithOdu(checkoutFrame(), {
      link: { act: () => ({ kind: "door" }), open: () => opened.push("x") },
    });
    const button = el("inspector-odu-lane-link");
    expect(button?.tagName).toBe("BUTTON");
    expect(button?.getAttribute("href")).toBeNull();
    (button as HTMLElement).click();
    expect(opened).toEqual(["x"]);
  });

  it("leaves a lane inert when nothing offers a way out", () => {
    // No outlet (a test rendering this section bare): a lane is still shown.
    mountWithOdu(checkoutFrame());
    expect(el("inspector-odu-lane-link")).toBeNull();
    expect(el("inspector-odu-lanes")?.textContent).toContain(
      "ci::e2e@x86_64-linux",
    );
  });

  it("draws an explicit row when the READOUT failed — never a blank", () => {
    // Absence is not this row: an absent odu answers a frame and draws nothing.
    // This is the subscription itself failing — a frame this client could not
    // decode, a member the relay could not open — which is an install to go and
    // look at rather than a quiet machine.
    mountWithOdu(undefined, {
      error: new Error(
        "the odu daemon at /tmp/x.sock speaks service contract 9.9",
      ),
    });
    expect(text("inspector-odu-error")).toContain("odu CI unavailable");
    expect(text("inspector-odu-error")).toContain("9.9");
    // A failure is not "nothing to show": the chip and the disclosure are absent
    // (there is no frame), and the row is what stands in for them.
    expect(el("inspector-odu-chip")).toBeNull();
    expect(el("inspector-odu")).toBeNull();
  });

  it("keys the subscription by the FOCUSED terminal's own checkout", () => {
    // The input is the repo root of the terminal in front of you, so a switch to
    // a terminal in another checkout re-keys the readout rather than leaving it
    // describing the checkout that happened to paint first.
    const [meta, setMeta] = createSignal(RESIZE_BUG);
    paint(() => <WorkSection meta={meta()} />);
    expect(wire.input?.()).toEqual({
      repoRoot: "/home/srid/code/kolu/.worktrees/resize-bug",
    });

    setMeta(PI);
    expect(wire.input?.()).toEqual({
      repoRoot: "/home/srid/code/AI/.worktrees/pi",
    });
  });

  it("subscribes to NOTHING for a terminal outside a repo", () => {
    // No checkout, no question to ask — and `null` is what keeps padi from
    // dialling odu for a shell that has nothing to report.
    paint(() => (
      <WorkSection meta={{ ...RESIZE_BUG, git: { kind: "none" } }} />
    ));
    expect(wire.input?.()).toBeNull();
  });

  it("asks for nothing while the panel is HIDDEN", () => {
    // The Inspector tab stays MOUNTED while hidden, and padi's re-serve dials
    // odu for the first subscriber and lets the link go a grace after the last
    // one leaves — so the gate is what keeps a closed panel from holding an odu
    // link open on every host it ever visited.
    const [shown, setShown] = createSignal(false);
    host = document.createElement("div");
    document.body.append(host);
    dispose = render(
      () => (
        <PanelShown.Provider value={shown}>
          <WorkSection meta={RESIZE_BUG} />
        </PanelShown.Provider>
      ),
      host,
    );
    expect(wire.input?.()).toBeNull();

    setShown(true);
    expect(wire.input?.()).toEqual({
      repoRoot: "/home/srid/code/kolu/.worktrees/resize-bug",
    });
  });
});
