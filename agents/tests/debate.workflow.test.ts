// Unit tests for the lens-debate Workflow engine
// (.apm/skills/lens-debate/debate.workflow.js).
//
// The Workflow runtime evaluates the script as a module-less async body with
// injected globals (agent/parallel/pipeline/phase/log/args), so the script
// cannot import — and cannot BE imported. These tests therefore run the engine
// the same way the runtime does: strip the `export` off `meta`, wrap the source
// in an AsyncFunction with stubbed globals, and drive it with scripted agent()
// responses keyed by each call's label. What's under test is the engine's real
// decision logic — reconciliation, the real-only rule, objection settling,
// thread grouping/settle-lock, the escalation valve, apply-gap accounting and
// the rendered comment — with zero live agents.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// biome-ignore lint/correctness/noUndeclaredDependencies: vitest resolves from the workspace ROOT devDependencies by design — agents/ must stay dependency-free so pnpm never creates agents/node_modules (`apm install` vendors agents/ as a path package and aborts on symlinks escaping the package root; see pnpm-workspace.yaml).
import { describe, expect, it } from "vitest";

const SCRIPT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../.apm/skills/lens-debate/debate.workflow.js",
);
const source = readFileSync(SCRIPT_PATH, "utf8");
// The runtime requires `export const meta` as the first statement; inside a
// function body `export` is illegal, so strip exactly that one keyword.
const body = source.replace(/^export const meta/m, "const meta");

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
  ...args: string[]
) => (...fnArgs: unknown[]) => Promise<Result>;

type Call = { prompt: string; opts: { label?: string; [k: string]: unknown } };
type Dispatch = (call: Call) => unknown;

interface Result {
  status: string;
  rounds: number;
  settled: Record<string, unknown>[];
  unresolved: Record<string, unknown>[];
  applied: { id: string; commit: string | null }[];
  applyGaps: { id: string; reason: string }[];
  fixes: Record<string, unknown>[];
  escalations: {
    file: string;
    findingIds: string[];
    rounds: number;
    resolved: boolean;
  }[];
  turns: Record<string, number>;
  history: { thread: string; round: number }[];
  comment?: string;
  note?: string;
}

async function runEngine(args: Record<string, unknown>, dispatch: Dispatch) {
  const calls: Call[] = [];
  const logs: string[] = [];
  const agent = async (prompt: string, opts: Call["opts"] = {}) => {
    const call = { prompt, opts };
    calls.push(call);
    return dispatch(call);
  };
  // Mirrors the runtime's contract: a throwing thunk resolves to null, the
  // parallel() call itself never rejects.
  const parallel = (thunks: (() => Promise<unknown>)[]) =>
    Promise.all(thunks.map((t) => t().catch(() => null)));
  const pipeline = async (
    items: unknown[],
    ...stages: ((x: unknown) => unknown)[]
  ) =>
    Promise.all(
      items.map(async (item) => {
        let acc: unknown = item;
        for (const stage of stages) acc = await stage(acc);
        return acc;
      }),
    );
  const fn = new AsyncFunction(
    "args",
    "agent",
    "parallel",
    "pipeline",
    "phase",
    "log",
    "budget",
    "workflow",
    body,
  );
  const result = await fn(
    // The harness JSON-encodes args before the script sees it — reproduce that.
    JSON.stringify(args),
    agent,
    parallel,
    pipeline,
    () => {},
    (m: string) => logs.push(m),
    { total: null, spent: () => 0, remaining: () => Number.POSITIVE_INFINITY },
    async () => {
      throw new Error("nested workflow() is not available");
    },
  );
  return { result, calls, logs };
}

// --- scripted-response helpers ----------------------------------------------

type Finding = {
  title: string;
  location: string;
  problem: string;
  suggestion: string;
  disposition: "fix" | "drop";
  severity: "minor" | "major";
};

const finding = (over: Partial<Finding> & { location: string }): Finding => ({
  title: `issue at ${over.location}`,
  problem: "a structural problem",
  suggestion: "a concrete change",
  disposition: "fix",
  severity: "major",
  ...over,
});

const label = (c: Call) => c.opts.label ?? "";

/** Base dispatcher: merge-base + hunks resolved mechanically; everything else per-scenario. */
function dispatcher(
  handlers: Record<string, Dispatch>,
  fallback?: Dispatch,
): Dispatch {
  return (call) => {
    const l = label(call);
    if (l === "resolve:merge-base") return { sha: "abc123def456" };
    if (l === "reconcile:hunks") {
      // Echo an excerpt for every requested id (parsed from the prompt list).
      const ids = [...call.prompt.matchAll(/^- ([\w:.-]+): /gm)].map(
        (m) => m[1],
      );
      return { hunks: ids.map((id) => ({ id, excerpt: `hunk-for-${id}` })) };
    }
    for (const [prefix, h] of Object.entries(handlers)) {
      if (l === prefix || l.startsWith(prefix)) return h(call);
    }
    if (fallback) return fallback(call);
    throw new Error(`unexpected agent call: ${l}`);
  };
}

/** Parse `lowy:<file>:r<N>` / `hickey:<file>:r<N>` thread-turn labels. */
function threadTurn(c: Call) {
  const m = label(c).match(/^(lowy|hickey):(.+):r(\d+)$/);
  return m ? { lens: m[1], file: m[2], round: Number(m[3]) } : null;
}

const noMatches = () => ({ matches: [] });
const noObjections = (c: Call) => ({
  checks: [...c.prompt.matchAll(/^### ([\w-]+) /gm)].map((m) => ({
    id: m[1],
    objects: false,
    reasoning: "no objection",
  })),
});

// --- scenarios ---------------------------------------------------------------

describe("lens-debate engine", () => {
  it("settles a compatible cross-lens pair at reconciliation — zero debate turns", async () => {
    const { result, calls } = await runEngine(
      { repoPath: "/repo" },
      dispatcher({
        "review:lowy": () => ({
          findings: [
            finding({
              location: "src/a.ts:10",
              suggestion: "extract the helper",
            }),
          ],
        }),
        "review:hickey": () => ({
          findings: [
            finding({
              location: "src/a.ts:12",
              suggestion: "pull the helper out",
            }),
          ],
        }),
        "reconcile:match": () => ({
          matches: [
            {
              a: "lowy-1",
              b: "hickey-1",
              compatible: true,
              plan: "extract the helper",
              reason: "same issue",
            },
          ],
        }),
        "apply:all": () => ({
          applied: [
            {
              id: "lowy-1",
              summary: "done",
              filesChanged: ["src/a.ts"],
              commit: "feedc0ffee",
            },
          ],
        }),
      }),
    );
    expect(result.status).toBe("consensus");
    expect(result.rounds).toBe(0);
    expect(result.turns.debate).toBe(0);
    expect(result.turns.objection).toBe(0);
    expect(result.fixes).toHaveLength(1);
    expect(result.fixes[0]).toMatchObject({
      id: "lowy-1",
      plan: "extract the helper",
      pairedWith: "hickey-1",
    });
    const secondary = result.settled.find((s) => s.id === "hickey-1");
    expect(secondary).toMatchObject({
      agreed: true,
      via: "reconciled",
      duplicateOf: "lowy-1",
    });
    expect(result.comment).toContain("zero debate turns");
    expect(result.comment).toContain("≡");
    // The matcher must only run AFTER both independent reviews.
    const order = calls.map(label);
    expect(order.indexOf("reconcile:match")).toBeGreaterThan(
      order.indexOf("review:lowy"),
    );
    expect(order.indexOf("reconcile:match")).toBeGreaterThan(
      order.indexOf("review:hickey"),
    );
  });

  it("auto-settles a minor solo finding in a file the other lens never flagged (real-only rule)", async () => {
    const { result, calls } = await runEngine(
      { repoPath: "/repo" },
      dispatcher({
        "review:lowy": () => ({
          findings: [
            finding({
              location: "src/only-lowy.ts:5",
              severity: "minor",
              suggestion: "rename x to y",
            }),
          ],
        }),
        "review:hickey": () => ({ findings: [] }),
        "apply:all": () => ({
          applied: [
            {
              id: "lowy-1",
              summary: "renamed",
              filesChanged: ["src/only-lowy.ts"],
              commit: "abc",
            },
          ],
        }),
      }),
    );
    expect(result.status).toBe("consensus");
    expect(result.settled[0]).toMatchObject({
      via: "auto-minor",
      agreed: true,
      plan: "rename x to y",
    });
    // One lens raised nothing → the matcher is skipped, and nothing queues for
    // objection, so the whole Reconcile phase costs zero lens turns.
    expect(calls.map(label)).not.toContain("reconcile:match");
    expect(result.turns.match).toBe(0);
    expect(result.turns.objection).toBe(0);
    expect(result.turns.debate).toBe(0);
  });

  it("a MAJOR solo finding does not auto-settle: it takes the objection check", async () => {
    const { result } = await runEngine(
      { repoPath: "/repo", apply: false },
      dispatcher({
        "review:lowy": () => ({
          findings: [finding({ location: "src/solo.ts:5", severity: "major" })],
        }),
        "review:hickey": () => ({ findings: [] }),
        "objection:hickey": noObjections,
      }),
    );
    expect(result.status).toBe("consensus");
    expect(result.turns.objection).toBe(1);
    expect(result.settled[0]).toMatchObject({
      via: "no-objection",
      agreed: true,
    });
    expect(result.turns.debate).toBe(0);
  });

  it("a minor solo finding in a file the other lens DID flag still gets checked", async () => {
    const { result } = await runEngine(
      { repoPath: "/repo", apply: false },
      dispatcher({
        "review:lowy": () => ({
          findings: [
            finding({ location: "src/shared.ts:5", severity: "minor" }),
          ],
        }),
        "review:hickey": () => ({
          findings: [
            finding({
              location: "src/shared.ts:40",
              severity: "major",
              disposition: "drop",
            }),
          ],
        }),
        "reconcile:match": noMatches,
        "objection:lowy": noObjections,
        "objection:hickey": noObjections,
      }),
    );
    const lowySolo = result.settled.find((s) => s.id === "lowy-1");
    expect(lowySolo).toMatchObject({ via: "no-objection" }); // not auto-minor
  });

  it("an objection promotes the finding into a debate thread; concession settles it", async () => {
    const { result, calls } = await runEngine(
      { repoPath: "/repo", apply: false },
      dispatcher(
        {
          "review:lowy": () => ({
            findings: [
              finding({ location: "src/hot.ts:9", disposition: "fix" }),
            ],
          }),
          "review:hickey": () => ({
            findings: [
              finding({
                location: "src/other.ts:1",
                severity: "minor",
                disposition: "drop",
              }),
            ],
          }),
          "reconcile:match": noMatches,
          "objection:hickey": (c) => ({
            checks: [...c.prompt.matchAll(/^### ([\w-]+) /gm)].map((m) => ({
              id: m[1],
              objects: true,
              disposition: "drop",
              reasoning: "not worth it in this PR",
            })),
          }),
        },
        (c) => {
          const t = threadTurn(c);
          if (!t) throw new Error(`unexpected: ${label(c)}`);
          // Both lenses converge on drop in round 1 (lowy concedes).
          return {
            positions: [
              {
                id: "lowy-1",
                disposition: "drop",
                reasoning: "conceding: hickey is right",
              },
            ],
          };
        },
      ),
    );
    expect(result.status).toBe("consensus");
    expect(result.rounds).toBe(1);
    expect(result.turns.debate).toBe(2);
    expect(result.settled.find((s) => s.id === "lowy-1")).toMatchObject({
      via: "debated",
      disposition: "drop",
    });
    expect(result.escalations).toHaveLength(0);
    // Scoped turns: the debate prompt carries the extracted hunk and is NOT a
    // full-diff read; the independent reviews are.
    const turn = calls.find((c) => threadTurn(c));
    expect(turn?.prompt).toContain("hunk-for-lowy-1");
    expect(turn?.prompt).toContain("SCOPED");
    expect(turn?.prompt).not.toContain("Inspect the FULL change");
    const review = calls.find((c) => label(c) === "review:lowy");
    expect(review?.prompt).toContain("Inspect the FULL change");
    expect(review?.prompt).toContain("INDEPENDENTLY");
  });

  it("contested findings in different files debate in separate threads; a >3-round thread escalates but never exits", async () => {
    const settleAt: Record<string, number> = {
      "src/deep.ts": 5,
      "src/quick.ts": 1,
    };
    const { result } = await runEngine(
      { repoPath: "/repo", apply: false },
      dispatcher(
        {
          "review:lowy": () => ({
            findings: [
              finding({ location: "src/deep.ts:1", disposition: "fix" }),
              finding({ location: "src/quick.ts:1", disposition: "fix" }),
            ],
          }),
          "review:hickey": () => ({
            findings: [
              finding({ location: "src/deep.ts:2", disposition: "drop" }),
              finding({ location: "src/quick.ts:2", disposition: "drop" }),
            ],
          }),
          "reconcile:match": () => ({
            matches: [
              {
                a: "lowy-1",
                b: "hickey-1",
                compatible: false,
                reason: "same issue, dispositions differ",
              },
              {
                a: "lowy-2",
                b: "hickey-2",
                compatible: false,
                reason: "same issue, dispositions differ",
              },
            ],
          }),
        },
        (c) => {
          const t = threadTurn(c);
          if (!t) throw new Error(`unexpected: ${label(c)}`);
          const converge = t.round >= settleAt[t.file];
          return {
            positions: [
              {
                id: t.file === "src/deep.ts" ? "lowy-1" : "lowy-2",
                disposition: converge
                  ? "drop"
                  : t.lens === "lowy"
                    ? "fix"
                    : "drop",
                reasoning: converge ? "conceding" : "holding position",
              },
            ],
          };
        },
      ),
    );
    expect(result.status).toBe("consensus");
    expect(result.rounds).toBe(5); // deepest thread
    expect(
      result.history.filter((h) => h.thread === "src/quick.ts"),
    ).toHaveLength(1);
    expect(result.escalations).toHaveLength(1);
    expect(result.escalations[0]).toMatchObject({
      file: "src/deep.ts",
      rounds: 5,
      resolved: true,
      findingIds: ["lowy-1", "hickey-1"],
    });
    expect(result.comment).toContain("Escalated threads");
  });

  it("hitting the per-thread backstop reports unresolved (never deadlock), pairs counted once", async () => {
    const { result } = await runEngine(
      { repoPath: "/repo", apply: false, maxRounds: 2 },
      dispatcher(
        {
          "review:lowy": () => ({
            findings: [
              finding({ location: "src/stuck.ts:1", disposition: "fix" }),
            ],
          }),
          "review:hickey": () => ({
            findings: [
              finding({ location: "src/stuck.ts:2", disposition: "drop" }),
            ],
          }),
          "reconcile:match": () => ({
            matches: [
              {
                a: "lowy-1",
                b: "hickey-1",
                compatible: false,
                reason: "disagree",
              },
            ],
          }),
        },
        (c) => {
          const t = threadTurn(c);
          if (!t) throw new Error(`unexpected: ${label(c)}`);
          return {
            positions: [
              {
                id: "lowy-1",
                disposition: t.lens === "lowy" ? "fix" : "drop",
                reasoning: "holding",
              },
            ],
          };
        },
      ),
    );
    expect(result.status).toBe("unresolved");
    expect(result.unresolved).toHaveLength(1); // the pair appears once
    expect(result.unresolved[0]).toMatchObject({
      id: "lowy-1",
      pairedWith: "hickey-1",
    });
    expect(JSON.stringify(result)).not.toContain("deadlock");
    expect(result.comment).toContain("Unresolved — needs human");
  });

  it("a fix pair 'compatible' without a canonical plan is demoted to contested, never settled", async () => {
    const { result } = await runEngine(
      { repoPath: "/repo", apply: false },
      dispatcher(
        {
          "review:lowy": () => ({
            findings: [finding({ location: "src/p.ts:1", disposition: "fix" })],
          }),
          "review:hickey": () => ({
            findings: [finding({ location: "src/p.ts:3", disposition: "fix" })],
          }),
          "reconcile:match": () => ({
            // compatible claimed, but no `plan` — settling would hand Apply an
            // arbitrary edit as "agreed".
            matches: [
              { a: "lowy-1", b: "hickey-1", compatible: true, reason: "same" },
            ],
          }),
        },
        (c) => {
          const t = threadTurn(c);
          if (!t) throw new Error(`unexpected: ${label(c)}`);
          return {
            positions: [
              {
                id: "lowy-1",
                disposition: "fix",
                plan: "the converged plan",
                agreesWithPlan: t.lens === "hickey",
                reasoning: "agreed",
              },
            ],
          };
        },
      ),
    );
    expect(result.status).toBe("consensus");
    expect(result.turns.debate).toBe(2); // it debated
    expect(result.fixes[0]).toMatchObject({
      id: "lowy-1",
      plan: "the converged plan",
      via: "debated",
    });
  });

  it("rejects matcher pairs with unknown or reused ids; the findings fall through safely", async () => {
    const { result } = await runEngine(
      { repoPath: "/repo", apply: false },
      dispatcher({
        "review:lowy": () => ({
          findings: [finding({ location: "src/a.ts:1" })],
        }),
        "review:hickey": () => ({
          findings: [finding({ location: "src/b.ts:1", disposition: "drop" })],
        }),
        "reconcile:match": () => ({
          matches: [
            {
              a: "lowy-99",
              b: "hickey-1",
              compatible: true,
              reason: "bogus id",
            },
            {
              a: "hickey-1",
              b: "lowy-1",
              compatible: true,
              reason: "wrong origins",
            },
          ],
        }),
        "objection:lowy": noObjections,
        "objection:hickey": noObjections,
      }),
    );
    expect(result.status).toBe("consensus");
    for (const s of result.settled) expect(s.via).toBe("no-objection");
  });

  it("an objection check missing from the batch does NOT settle the finding (absence ≠ agreement)", async () => {
    const { result } = await runEngine(
      { repoPath: "/repo", apply: false },
      dispatcher(
        {
          "review:lowy": () => ({
            findings: [
              finding({ location: "src/m.ts:1", disposition: "drop" }),
            ],
          }),
          "review:hickey": () => ({
            findings: [
              finding({
                location: "src/m.ts:9",
                disposition: "drop",
                severity: "minor",
              }),
            ],
          }),
          "reconcile:match": noMatches,
          // hickey's batch omits lowy-1 entirely; lowy has hickey-1 to check.
          "objection:hickey": () => ({ checks: [] }),
          "objection:lowy": noObjections,
        },
        (c) => {
          const t = threadTurn(c);
          if (!t) throw new Error(`unexpected: ${label(c)}`);
          return {
            positions: [
              { id: "lowy-1", disposition: "drop", reasoning: "agreed drop" },
            ],
          };
        },
      ),
    );
    expect(result.settled.find((s) => s.id === "lowy-1")).toMatchObject({
      via: "debated",
    });
  });

  it("with police: a police finding settles only when NEITHER debater objects", async () => {
    const { result } = await runEngine(
      { repoPath: "/repo", apply: false, withPolice: true },
      dispatcher({
        "review:lowy": () => ({ findings: [] }),
        "review:hickey": () => ({ findings: [] }),
        "review:code-police": () => ({
          findings: [
            finding({
              location: "src/cop.ts:1",
              disposition: "fix",
              suggestion: "guard the null",
            }),
          ],
        }),
        "objection:lowy": noObjections,
        "objection:hickey": noObjections,
      }),
    );
    expect(result.status).toBe("consensus");
    expect(result.settled[0]).toMatchObject({
      via: "no-objection",
      plan: "guard the null",
    });
    expect(result.turns.objection).toBe(2);
  });

  it("flags apply gaps: changed-but-uncommitted downgrades consensus to apply-incomplete", async () => {
    const { result } = await runEngine(
      { repoPath: "/repo" },
      dispatcher({
        "review:lowy": () => ({
          findings: [finding({ location: "src/g.ts:1", severity: "minor" })],
        }),
        "review:hickey": () => ({ findings: [] }),
        "apply:all": () => ({
          applied: [
            {
              id: "lowy-1",
              summary: "changed",
              filesChanged: ["src/g.ts"],
              commit: "",
            },
          ],
        }),
      }),
    );
    expect(result.status).toBe("apply-incomplete");
    expect(result.applyGaps).toEqual([{ id: "lowy-1", reason: "uncommitted" }]);
    expect(result.comment).toContain("Apply incomplete");
  });

  it("aborts with merge-base-error instead of falling back to the raw base ref", async () => {
    const { result, calls } = await runEngine(
      { repoPath: "/repo", base: "origin/typo" },
      (c) => {
        if (label(c) === "resolve:merge-base")
          return { sha: "", error: "fatal: bad ref" };
        throw new Error(`unexpected: ${label(c)}`);
      },
    );
    expect(result.status).toBe("merge-base-error");
    expect(result.note).toContain("fatal: bad ref");
    expect(calls).toHaveLength(1);
  });

  it("returns clean when every lens finds nothing", async () => {
    const { result } = await runEngine(
      { repoPath: "/repo" },
      dispatcher({
        "review:lowy": () => ({ findings: [] }),
        "review:hickey": () => ({ findings: [] }),
      }),
    );
    expect(result.status).toBe("clean");
    expect(result.comment).toContain("Clean");
    expect(result.turns.review).toBe(2);
  });
});
