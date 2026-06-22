/**
 * Bun-lane render test for the live fleet board (`fleet.tsx`). Runs under `bun
 * test` (OpenTUI's renderer needs Bun's FFI), kept out of vitest's glob by the
 * `bun-test` infix. Run with `pnpm --filter pulam-tui test:render`.
 *
 * It asserts the board PAINTS each state — a host group + row, the breathing
 * alert strip, the unreachable/skew headers, the flat needs view — and that the
 * paint is a pure function of (view, frame): a different view (an agent now
 * awaiting you) and a different animation frame each produce a DIFFERENT frame.
 * That is the projection→paint half of liveness. The in-process half — a signal
 * change repainting over time — rides the exact `createSignal` + interval path
 * PR2a's header clock already proves, and is captured live (raw-PTY) in the PR
 * evidence; the OpenTUI test harness doesn't propagate a mid-test signal change
 * to the buffer, so liveness-over-time is proven there, not here.
 */

import type {
  AwarenessValue,
  GitStatusOutput,
  TerminalId,
} from "@kolu/terminal-workspace/surface";
import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { FleetBoard } from "./fleet.tsx";
import type { FleetHostState } from "./fleetTypes.ts";
import { type FleetView, projectFleet } from "./render.ts";

const id = (s: string): TerminalId => s as TerminalId;
function val(over: Partial<AwarenessValue>): AwarenessValue {
  return {
    cwd: "/repo",
    git: null,
    lastActivityAt: 0,
    pr: { kind: "pending" },
    agent: null,
    foreground: null,
    ...over,
  } as AwarenessValue;
}
const agentVal = (state: string): AwarenessValue["agent"] =>
  ({ kind: "claude-code", state }) as AwarenessValue["agent"];
const gitInfo = (repoRoot: string): AwarenessValue["git"] => ({
  repoRoot,
  repoName: "kolu",
  worktreePath: repoRoot,
  branch: "feat/x",
  isWorktree: false,
  mainRepoRoot: repoRoot,
  remoteUrl: null,
});
const makeStatus = (over: Partial<GitStatusOutput> = {}): GitStatusOutput => ({
  files: [],
  base: null,
  branch: { name: "feat/x", upstream: null, ahead: 0, behind: 0 },
  workingTree: { staged: 0, modified: 0, untracked: 0 },
  ...over,
});
const NOW = 1_700_000_000_000;

// The host states the tests author often omit `gitStatuses` (most cases don't
// exercise the git cell); inject an empty default so the literals stay terse.
type HostInput = Omit<FleetHostState, "gitStatuses"> &
  Partial<Pick<FleetHostState, "gitStatuses">>;
const viewOf = (
  states: HostInput[],
  mode: "host" | "needs" | "agent" = "host",
): FleetView =>
  projectFleet(
    states.map((s) => ({ gitStatuses: {}, ...s })),
    mode,
  );

/** Render a board to its painted character frame, then tear the renderer down.
 *  `width` drives `useTerminalDimensions()` so the responsive `repo·branch`
 *  column can be tested at different terminal widths; `sel`/`open` drive the
 *  selection cursor and drill-in pane. */
async function renderBoard(
  view: FleetView,
  frame = 0,
  width = 80,
  opts: { sel?: number; open?: boolean; height?: number } = {},
): Promise<string> {
  const t = await testRender(
    () => (
      <FleetBoard
        view={() => view}
        frame={() => frame}
        now={() => NOW}
        clock={() => "12:00:00"}
        sel={() => opts.sel ?? 0}
        open={() => opts.open ?? false}
      />
    ),
    { width, height: opts.height ?? 18 },
  );
  await t.flush();
  const out = t.captureCharFrame();
  t.renderer.destroy();
  return out;
}

const connected = { kind: "connected" } as const;

test("paints a host group, a terminal row, and the header clock", async () => {
  const frame = await renderBoard(
    viewOf([
      {
        label: "zest",
        status: connected,
        live: [],
        terminals: {
          [id("z1")]: val({
            git: {
              repoName: "kolu",
              branch: "feat/x",
            } as AwarenessValue["git"],
            agent: agentVal("thinking"),
          }),
        },
      },
    ]),
  );
  expect(frame).toContain("pulam-tui fleet");
  expect(frame).toContain("zest");
  expect(frame).toContain("kolu·feat/x");
  expect(frame).toContain("working");
  expect(frame).toContain("12:00:00");
});

test("the board reflects an agent flipping to awaiting you (calm ≠ alert)", async () => {
  const host = (state: string): FleetHostState => ({
    label: "zest",
    status: connected,
    live: [],
    terminals: { [id("z1")]: val({ agent: agentVal(state) }) },
    gitStatuses: {},
  });
  const calm = await renderBoard(viewOf([host("thinking")]));
  const alert = await renderBoard(viewOf([host("awaiting_user")]));

  // "need you" alone also appears in the always-on footer tally (`0 need you`),
  // so assert on cells unique to the alerting state.
  expect(calm).toContain("working");
  expect(calm).not.toContain("awaiting you");
  expect(alert).toContain("awaiting you"); // the row state
  expect(alert).toContain("agent need you"); // the breathing alert strip
  expect(alert).not.toBe(calm); // a delta repaints to a different frame
});

test("a working row's spinner is frame-dependent (◜ ≠ ◝)", async () => {
  const view = viewOf([
    {
      label: "a",
      status: connected,
      live: [],
      terminals: { [id("a1")]: val({ agent: agentVal("thinking") }) },
    },
  ]);
  const f0 = await renderBoard(view, 0);
  const f1 = await renderBoard(view, 1);
  expect(f0).not.toBe(f1); // the spinner glyph cycles with the animation frame
});

test("a live terminal paints the green activity dot (≠ a quiet one)", async () => {
  const board = (live: string[]): FleetHostState => ({
    label: "zest",
    status: connected,
    live,
    terminals: { [id("z1")]: val({ agent: agentVal("thinking") }) },
    gitStatuses: {},
  });
  // A working row's leading glyph is the spinner, so the only difference between
  // these two frames is the live-dot column lighting up — proving the green dot
  // paints from the `activity` set, orthogonal to the agent-state glyph.
  const quiet = await renderBoard(viewOf([board([])]));
  const loud = await renderBoard(viewOf([board(["z1"])]));
  // The dot column is the sole difference: the working row's spinner and every
  // other cell are identical, so a different frame means the dot lit up. (A bare
  // `toContain("●")` would be a false positive — the footer's "● 0 need you"
  // tally carries a dot regardless of liveness.)
  expect(loud).not.toBe(quiet);
});

test("an unreachable host renders a distinct header, not a vanished group", async () => {
  const frame = await renderBoard(
    viewOf([
      {
        label: "staging",
        status: { kind: "unreachable", reason: "ECONNREFUSED" },
        live: [],
        terminals: {},
      },
    ]),
  );
  expect(frame).toContain("staging");
  expect(frame).toContain("unreachable");
  expect(frame).toContain("ECONNREFUSED");
  expect(frame).toContain("1 host down");
});

test("a version-skew host renders the skew header", async () => {
  const frame = await renderBoard(
    viewOf([
      {
        label: "old",
        status: { kind: "skew", localVersion: "0.1", hostVersion: "9.9" },
        live: [],
        terminals: {},
      },
    ]),
  );
  expect(frame).toContain("skew 9.9≠0.1");
});

test("needs mode flattens across hosts with no per-host headers", async () => {
  const frame = await renderBoard(
    viewOf(
      [
        {
          label: "a",
          status: connected,
          live: [],
          terminals: { [id("a1")]: val({ agent: agentVal("awaiting_user") }) },
        },
        {
          label: "b",
          status: connected,
          live: [],
          terminals: { [id("b1")]: val({ agent: agentVal("thinking") }) },
        },
      ],
      "needs",
    ),
  );
  expect(frame).toContain("awaiting you");
  expect(frame).toContain("working");
  expect(frame).not.toContain("▌"); // no host group bars in the flat list
});

test("needs mode names each row's source host (no group header to carry it)", async () => {
  // Without per-host group headers, the row itself must say WHICH machine each
  // agent is on — the core fleet promise (who is blocked, and where).
  const frame = await renderBoard(
    viewOf(
      [
        {
          label: "zest",
          status: connected,
          live: [],
          terminals: { [id("z1")]: val({ agent: agentVal("awaiting_user") }) },
        },
        {
          label: "pluto",
          status: connected,
          live: [],
          terminals: { [id("p1")]: val({ agent: agentVal("thinking") }) },
        },
      ],
      "needs",
    ),
  );
  expect(frame).toContain("zest");
  expect(frame).toContain("pluto");
});

test("agent mode names each row's source host inside the urgency sections", async () => {
  const frame = await renderBoard(
    viewOf(
      [
        {
          label: "zest",
          status: connected,
          live: [],
          terminals: { [id("z1")]: val({ agent: agentVal("awaiting_user") }) },
        },
        {
          label: "pluto",
          status: connected,
          live: [],
          terminals: { [id("p1")]: val({ agent: agentVal("thinking") }) },
        },
      ],
      "agent",
    ),
  );
  // The section headers are urgency labels, not hosts; the host appears per-row.
  expect(frame).toContain("awaiting you");
  expect(frame).toContain("zest");
  expect(frame).toContain("pluto");
});

test("repo·branch absorbs a wide terminal's slack, truncates a narrow one", async () => {
  // A long branch that the old fixed 22-col `where` clipped: it must show in
  // FULL on a wide terminal (no wasted space, no clip) and ONLY truncate when
  // the terminal is genuinely narrow.
  const longBranch = "redesign/sleeping-terminals";
  const states: FleetHostState[] = [
    {
      label: "zest",
      status: connected,
      live: [],
      terminals: {
        [id("z1")]: val({
          git: {
            repoName: "kolu",
            branch: longBranch,
          } as AwarenessValue["git"],
          agent: agentVal("thinking"),
        }),
      },
      gitStatuses: {},
    },
  ];

  const wide = await renderBoard(viewOf(states), 0, 140);
  expect(wide).toContain(`kolu·${longBranch}`); // full, un-clipped
  expect(wide).not.toContain("…");

  // A narrower terminal that still fits the row: `where` shrinks and truncates
  // (with an ellipsis) instead of the full branch overflowing.
  const narrow = await renderBoard(viewOf(states), 0, 70);
  expect(narrow).not.toContain(`kolu·${longBranch}`);
  expect(narrow).toContain("…");
});

// ─── Git status: the live cell, the cursor, and the drill-in pane (R4.7) ─────

const repoHost = (gitStatuses: Record<string, GitStatusOutput>): HostInput => ({
  label: "zest",
  status: connected,
  live: [],
  terminals: {
    [id("z1")]: val({ git: gitInfo("/r/kolu"), agent: agentVal("thinking") }),
  },
  gitStatuses,
});

test("paints a row's live git cell — changed count and ahead/behind (R4.7)", async () => {
  const frame = await renderBoard(
    viewOf([
      repoHost({
        "/r/kolu": makeStatus({
          files: [
            { path: "a", status: "M" },
            { path: "b", status: "?" },
          ],
          branch: {
            name: "feat/x",
            upstream: "origin/feat/x",
            ahead: 2,
            behind: 0,
          },
        }),
      }),
    ]),
    0,
    120, // wide so the git cell isn't squeezed out of an 80-col row
  );
  expect(frame).toContain("✎2"); // two changed files
  expect(frame).toContain("↑2"); // two commits ahead of upstream
});

test("Enter opens the drill-in detail pane; it's closed by default", async () => {
  const states = [
    repoHost({
      "/r/kolu": makeStatus({
        files: [{ path: "u.md", status: "?" }],
        workingTree: { staged: 1, modified: 0, untracked: 1 },
      }),
    }),
  ];
  const closed = await renderBoard(viewOf(states), 0, 80, { open: false });
  const open = await renderBoard(viewOf(states), 0, 80, {
    sel: 0,
    open: true,
    height: 24,
  });
  expect(closed).not.toContain("staged 1"); // the summary line is the pane's
  expect(open).toContain("staged 1 · modified 0 · untracked 1");
  expect(open).not.toBe(closed); // opening the pane repaints to a new frame
});

test("the selection cursor marks the selected row and moves with sel", async () => {
  const states: HostInput[] = [
    {
      label: "zest",
      status: connected,
      live: [],
      terminals: {
        [id("z1")]: val({ agent: agentVal("thinking") }),
        [id("z2")]: val({ agent: agentVal("thinking") }),
      },
      gitStatuses: {},
    },
  ];
  const at0 = await renderBoard(viewOf(states), 0, 80, { sel: 0 });
  const at1 = await renderBoard(viewOf(states), 0, 80, { sel: 1 });
  expect(at0).toContain("▸"); // the cursor is painted
  expect(at0).not.toBe(at1); // and it sits on a different row as sel moves
});
