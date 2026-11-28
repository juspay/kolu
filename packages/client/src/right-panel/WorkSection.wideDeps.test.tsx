// @vitest-environment happy-dom
/**
 * A PR WITH HUNDREDS OF CHECKS IS READ RUN BY RUN.
 *
 * The Work cluster's PR bundle tallies the checks and sorts them into triage
 * order. The subject it reads is the FOCUSED TERMINAL's record, which arrives
 * through a Surface mirror and is therefore a store: tallying and sorting in
 * one memo subscribes it to the list, an index and `outcome` per run, so a
 * monorepo PR of a couple of hundred lanes puts that memo past the 200 sources
 * Solid's development build judges `WIDE_SCOPE_DEPS`.
 *
 * The fixture is that terminal, in a real `createStore` — a plain object would
 * subscribe nothing and the case would pass while production went red. It
 * judges every diagnostic Solid raised, `info` graded ones included, and the
 * summary, the chip and the rows' order, each built here from the fixture's own
 * numbers.
 */

import {
  type ActiveTerminal,
  LOCAL_LOCATION,
  type TerminalMetadata,
} from "@kolu/padi-client/surface";
import type { CheckRun, PrInfo } from "anyforge/schemas";
import { type Accessor, createSignal, createStore, flush } from "solid-js";
import { render } from "@solidjs/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";

/** The section's one subscription: odu's checkout stream, which these cases
 *  never answer — what they are about is the PR facts on the record. */
vi.mock("../wire", () => ({
  activeHost: () => ({ kind: "local" }),
  interpretClientError: () => {},
  padiMap: {
    useEntry: () => ({
      odu: {
        streams: {
          checkout: {
            use: () => {
              const sub: Accessor<undefined> & {
                error: () => Error | undefined;
              } = Object.assign(() => undefined, {
                error: () => undefined,
              });
              return sub;
            },
          },
        },
      },
    }),
  },
}));
vi.mock("../time/clock", () => ({
  getClockNow: () => createSignal(1_000_000)[0],
}));

import { Shown } from "../ui/shown";
import WorkSection, { paneSubject } from "./WorkSection";

const LOCAL = { kind: "local" } as const;

/** A store DRAFT's view of a record whose fields the schema declares
 *  readonly — what a write inside `setStore` is. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** More lanes than one scope may hold, at the shape a monorepo PR has. */
const RUNS = 250;

const outcomeOf = (i: number): CheckRun["outcome"] =>
  i % 7 === 0 ? "fail" : i % 3 === 0 ? "pending" : "pass";

const runs = (): CheckRun[] =>
  Array.from({ length: RUNS }, (_, i) => ({
    name: `ci::lane-${i}`,
    outcome: outcomeOf(i),
  }));

const PR = (): PrInfo => ({
  number: 2438,
  title: "A pull request with many lanes",
  state: "open",
  url: "https://example.test/pull/2438",
  checks: "fail",
  checkRuns: runs(),
  reviewDecision: null,
  mergeStateStatus: "UNKNOWN",
  headSha: null,
  isDraft: false,
});

const CWD = "/code/r";

const terminal = (): TerminalMetadata => ({
  state: "active",
  cwd: CWD,
  git: {
    kind: "repo",
    info: {
      repoRoot: CWD,
      repoName: "r",
      worktreePath: CWD,
      branch: "many-lanes",
      isWorktree: false,
      mainRepoRoot: CWD,
      remoteUrl: null,
      isBare: false,
    },
  },
  location: LOCAL_LOCATION,
  pr: { kind: "ok", value: PR() } satisfies ActiveTerminal["pr"],
  agent: null,
  foreground: null,
  ports: { status: "unknown" },
  lastActivityAt: 0,
  promptedAt: null,
});

/** THE WORDS THE SECTION SAYS, from the fixture's own tally: the bucket counts
 *  in triage order (failed, running, passed). */
const summaryOf = (all: ReadonlyArray<CheckRun>): string => {
  const counts = { fail: 0, pending: 0, pass: 0 };
  for (const one of all) counts[one.outcome] += 1;
  return `${counts.fail} failed · ${counts.pending} running · ${counts.pass} passed`;
};

/** THE ROWS' ORDER: the exceptions first, then what is still moving, then the
 *  passes — each bucket in the order the PR lists them. */
const orderOf = (all: ReadonlyArray<CheckRun>): ReadonlyArray<string> => [
  ...all.filter((one) => one.outcome === "fail").map((one) => one.name),
  ...all.filter((one) => one.outcome === "pending").map((one) => one.name),
  ...all.filter((one) => one.outcome === "pass").map((one) => one.name),
];

const findings = (): ReadonlyArray<string> =>
  takeSolidDiagnostics().map(
    (event) => `[${event.severity ?? "none"}] ${event.code} ${event.message}`,
  );

let dispose: (() => void) | undefined;
let host: HTMLElement | undefined;

const mount = (meta: TerminalMetadata): HTMLElement => {
  host = document.createElement("div");
  document.body.append(host);
  dispose = render(
    () => (
      <Shown value={() => true}>
        <WorkSection subject={paneSubject(meta, LOCAL)} />
      </Shown>
    ),
    host,
  );
  flush();
  return host;
};

const rowNames = (el: HTMLElement): ReadonlyArray<string> =>
  [
    ...(el
      .querySelector('[data-testid="inspector-pr-checks"]')
      ?.querySelectorAll("li") ?? []),
  ].map((one) => one.textContent?.trim() ?? "");

afterEach(() => {
  dispose?.();
  host?.remove();
  dispose = undefined;
  host = undefined;
});

describe("the Work cluster over a PR with hundreds of checks", () => {
  it("tallies and sorts them without one wide scope", () => {
    const [meta] = createStore(terminal());

    const el = mount(meta);

    expect(
      el.querySelector('[data-testid="inspector-pr-checks"]'),
    ).not.toBeNull();
    expect(rowNames(el)).toEqual(orderOf(runs()));
    expect(el.textContent).toContain(summaryOf(runs()));
    expect(findings()).toEqual([]);
  });

  it("follows one lane going red", () => {
    const [meta, setMeta] = createStore(terminal());
    const el = mount(meta);
    expect(findings()).toEqual([]);

    setMeta((draft: TerminalMetadata) => {
      if (draft.pr.kind !== "ok") return;
      const one = (draft.pr.value.checkRuns as Mutable<CheckRun>[])[1];
      if (one !== undefined) one.outcome = "fail";
    });
    flush();

    const after = runs().map((one, at) =>
      at === 1 ? { ...one, outcome: "fail" as const } : one,
    );
    expect(rowNames(el)).toEqual(orderOf(after));
    expect(el.textContent).toContain(summaryOf(after));
    expect(findings()).toEqual([]);
  });
});
