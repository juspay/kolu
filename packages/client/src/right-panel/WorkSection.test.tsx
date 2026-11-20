// @vitest-environment happy-dom

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
import { SurfaceUpstreamRefused } from "@kolu/surface/errors";
import { type Accessor, createSignal, type JSX } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assignColors,
  buildTerminalDisplayInfos,
} from "../terminal/terminalDisplay";
import { Shown } from "../ui/shown";
import WorkSection from "./WorkSection";

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

const clock = vi.hoisted(() => {
  const START = 1_000_000;
  let now = START;
  const subs = new Set<() => void>();
  return {
    START,
    read: () => now,
    advance(ms: number) {
      now += ms;
      for (const s of [...subs]) s();
    },
    subscribe(fn: () => void) {
      subs.add(fn);
    },
    reset() {
      now = START;
      subs.clear();
    },
  };
});

vi.mock("../time/clock", () => ({
  getClockNow: () => {
    const [n, setN] = createSignal(clock.read());
    clock.subscribe(() => setN(clock.read()));
    return n;
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
  clock.reset();
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
        isBare: false,
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

function paint(body: () => JSX.Element) {
  host = document.createElement("div");
  document.body.append(host);
  dispose = render(
    () => <Shown.Provider value={() => true}>{body()}</Shown.Provider>,
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

    expect(text("inspector-directory")).toBe(
      "/home/srid/code/AI/.worktrees/pi",
    );
    expect(text("inspector-branch")).toBe("docs/pesu-chat-rewrite");
    expect(text("inspector-repo")).toBe("AI");
  });

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
    expect(ai.repo).not.toBe(kolu.repo);
    expect(ai.branch).not.toBe(kolu.branch);
  });

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
        headSha: null,
        isDraft: false,
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
        checkRuns: [
          { name: "ci::biome", outcome: "pass" },
          { name: "ci::typecheck", outcome: "fail" },
          { name: "ci::e2e", outcome: "pending" },
        ],
        reviewDecision: "CHANGES_REQUESTED",
        mergeStateStatus: "BLOCKED",
        headSha: null,
        isDraft: false,
      },
    },
  });

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
    expect(text("inspector-ci")).toBe("✕ 1 failed");
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
    expect(text("inspector-branch")).toBe("docs/pesu-chat-rewrite");
  });
});

describe("WorkSection odu CI readout", () => {
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
      createdAt: clock.START - 90_000,
      finishedAt: clock.START - 45_000,
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

  function checkoutFrame(): CheckoutFrame {
    return {
      latest: {
        run: oduRow(),
        nodes: [
          oduNode("ci::typecheck@x86_64-linux", "ok"),
          oduNode("ci::e2e@x86_64-linux", "failed"),
        ],
      },
      recent: [
        oduRow(),
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

  const took = (): string[] =>
    [
      ...document.querySelectorAll<HTMLElement>(
        '[data-testid="inspector-odu-run-took"]',
      ),
    ].map((cell) => cell.textContent ?? "");

  const laneRows = (): HTMLElement[] => [
    ...(el("inspector-odu-lanes")?.querySelectorAll<HTMLElement>(
      'li:not([data-testid="inspector-odu-lane-axis"])',
    ) ?? []),
  ];

  it("paints the rollup chip, the lanes and the recent runs", () => {
    mountWithOdu(checkoutFrame());

    expect(text("inspector-odu-chip")).toBe("✕ 1 failed 0123456#3+dirty");

    const lanes = laneRows();
    expect(lanes?.length).toBe(2);
    expect(lanes?.[0]?.textContent).toContain("ci::e2e@x86_64-linux");
    expect(lanes?.[1]?.textContent).toContain("ci::typecheck@x86_64-linux");
    expect(lanes?.[0]?.textContent).toContain("1s");
    expect(lanes?.[0]?.textContent).toContain("box-1");
    expect(lanes?.[0]?.textContent).toContain("✗");

    const recent = el("inspector-odu-recent")?.querySelectorAll("li");
    expect(recent?.length).toBe(2);
    expect(recent?.[0]?.textContent).toContain("0123456#3+dirty");
    expect(recent?.[0]?.textContent).toContain("failed");
    expect(recent?.[0]?.textContent).toContain("current");
    expect(recent?.[1]?.textContent).toContain("0123456#2");
    expect(recent?.[1]?.textContent).toContain("passed");
    expect(recent?.[1]?.textContent).not.toContain("current");
    expect(took()).toEqual(["45s", "45s"]);
    clock.advance(30_000);
    expect(took()).toEqual(["45s", "45s"]);
  });

  it("ticks the duration of the run that has not finished", () => {
    const live = oduRow({
      state: "running",
      settled: false,
      passed: false,
      outcome: null,
      createdAt: clock.START - 30_000,
      finishedAt: null,
    });
    mountWithOdu({
      latest: {
        run: live,
        nodes: [oduNode("ci::unit@x86_64-linux", "running")],
      },
      recent: [live],
      total: 1,
    });

    expect(took()).toEqual(["30s"]);
    clock.advance(25_000);
    expect(took()).toEqual(["55s"]);
  });

  it("renders NOTHING when odu has nothing to say", () => {
    mountWithOdu({ latest: null, recent: [], total: 0 });
    expect(el("inspector-odu-chip")).toBeNull();
    expect(el("inspector-odu")).toBeNull();
    expect(el("inspector-odu-lanes")).toBeNull();
    expect(el("inspector-odu-recent")).toBeNull();
  });

  it("draws each lane WHERE it ran, and grows the one still going", () => {
    const live = oduRow({
      state: "running",
      settled: false,
      passed: false,
      outcome: null,
      createdAt: clock.START - 100_000,
      finishedAt: null,
    });
    const lane = (
      id: string,
      status: RunNode["status"],
      over: Partial<RunNode>,
    ): RunNode => ({ ...oduNode(id, status), ...over });
    mountWithOdu({
      latest: {
        run: live,
        nodes: [
          lane("ci::install@x86_64-linux", "ok", {
            startedAt: clock.START - 100_000,
            durationMs: 50_000,
          }),
          lane("ci::unit@x86_64-linux", "running", {
            startedAt: clock.START - 50_000,
            durationMs: null,
          }),
          lane("ci::e2e@x86_64-linux", "pending", {
            startedAt: null,
            durationMs: null,
          }),
          lane("ci::fmt@x86_64-linux", "ok", {
            startedAt: clock.START - 50_000,
            durationMs: 0,
          }),
        ],
      },
      recent: [live],
      total: 1,
    });

    const bars = (): ({ left: string; width: string } | null)[] =>
      laneRows().map((row) => {
        const bar = row.querySelector<HTMLElement>(
          '[data-testid="inspector-odu-lane-bar"]',
        );
        return bar === null
          ? null
          : { left: bar.style.left, width: bar.style.width };
      });

    expect(bars()).toEqual([
      { left: "50%", width: "50%" },
      { left: "0%", width: "50%" },
      null,
      { left: "50%", width: "0%" },
    ]);

    clock.advance(100_000);
    expect(bars()).toEqual([
      { left: "25%", width: "75%" },
      { left: "0%", width: "25%" },
      null,
      { left: "25%", width: "0%" },
    ]);
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

    setFrame({
      latest: {
        run: oduRow({ state: "settled", passed: false, outcome: "failed" }),
        nodes: [oduNode("ci::fmt@x86_64-linux", "failed")],
      },
      recent: [oduRow({ state: "settled", outcome: "failed" })],
      total: 1,
    });
    expect(text("inspector-odu-chip")).toBe("✕ 1 failed 0123456#3+dirty");
    const lane = laneRows()[0];
    expect(lane?.textContent).toContain("✗");
    expect(lane?.querySelector("span")?.getAttribute("title")).toBe("failed");
  });

  it("reads a torn-down run as INCOMPLETE, not failed (odu's own precedence)", () => {
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
    mountWithOdu(checkoutFrame());
    expect(el("inspector-odu")?.hasAttribute("open")).toBe(true);
  });

  it("opens the run's page from a recent row and from the chip", () => {
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
    const chip = el("inspector-odu-chip");
    expect(chip?.tagName).toBe("SPAN");
    expect(chip?.closest("a")?.getAttribute("href")).toBe(
      "http://pureintent:61003/#/run/run-1",
    );
    expect(chip?.closest("button")).toBeNull();
  });

  it("leaves a recent row a BUTTON until a door is listening", () => {
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

  const summary = (): string =>
    el("inspector-odu")?.querySelector("summary")?.textContent?.trim() ?? "";

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
    mountWithOdu(
      scopedFrame({ selectors: ["ci::unit"], platforms: [], noDeps: false }),
    );
    expect(summary()).toBe("CI by odu ↗ · 2 lanes · ci::unit");
    expect(el("inspector-odu-recent")?.textContent).toContain("ci::unit");
  });

  it("says nothing extra for a whole-pipeline run", () => {
    mountWithOdu(scopedFrame({ selectors: [], platforms: [], noDeps: false }));
    expect(summary()).toBe("CI by odu ↗ · 2 lanes");
    expect(el("inspector-odu-recent")?.textContent).not.toContain(
      "whole pipeline",
    );
  });

  it("names a platform slice, --no-deps and --root, which are scope too", () => {
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
    mountWithOdu({
      latest: { run: oduRow(), nodes: [] },
      recent: [oduRow()],
      total: 1,
    });
    expect(text("inspector-odu-chip")).toBe("✕ odu failed 0123456#3+dirty");
    expect(summary()).toBe("CI by odu ↗ · 0 lanes");
  });

  it("keeps the scope in the summary when the run has exceptions", () => {
    mountWithOdu(
      scopedFrame({ selectors: ["ci::unit"], platforms: [], noDeps: false }, [
        oduNode("ci::unit@x86_64-linux", "failed"),
        oduNode("ci::install@x86_64-linux", "ok"),
      ]),
    );
    expect(summary()).toBe("CI by odu ↗ · 2 lanes · 1 failed · ci::unit");
  });

  it("makes each lane a link to its own log page in odu web", () => {
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
    expect(
      el("inspector-odu-lanes")?.querySelectorAll(
        "[data-testid='inspector-odu-lane-link']",
      ).length,
    ).toBe(2);
  });

  it("makes a lane whose address needs a door a BUTTON, not a link", () => {
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
    mountWithOdu(checkoutFrame());
    expect(el("inspector-odu-lane-link")).toBeNull();
    expect(el("inspector-odu-lanes")?.textContent).toContain(
      "ci::e2e@x86_64-linux",
    );
  });

  it("draws an explicit row when the daemon REFUSES — never a blank", () => {
    mountWithOdu(undefined, {
      error: new SurfaceUpstreamRefused({
        reason:
          "the odu service at /tmp/x.sock serves the ci row at 9.9; this build reads ci 2.4 — upgrade the daemon (`odu web --upgrade`) or this build.",
      }),
    });
    expect(text("inspector-odu-error")).toContain("odu CI unavailable");
    expect(text("inspector-odu-error")).toContain("ci row at 9.9");
    expect(el("inspector-odu-chip")).toBeNull();
    expect(el("inspector-odu")).toBeNull();
  });

  it("keys the subscription by the FOCUSED terminal's own checkout", () => {
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
    paint(() => (
      <WorkSection meta={{ ...RESIZE_BUG, git: { kind: "none" } }} />
    ));
    expect(wire.input?.()).toBeNull();
  });

  it("asks for nothing while the panel is HIDDEN", () => {
    const [shown, setShown] = createSignal(false);
    host = document.createElement("div");
    document.body.append(host);
    dispose = render(
      () => (
        <Shown.Provider value={shown}>
          <WorkSection meta={RESIZE_BUG} />
        </Shown.Provider>
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
