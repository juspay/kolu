/**
 * A PR WITH MANY CHECKS IS READ RUN BY RUN, NOT ALL ON ONE SCOPE.
 *
 * The pip's tooltip names every check: its outcome's glyph and its name. Read
 * in ONE scope off a store-backed `PrInfo` — which is what a mirror hands it,
 * the whole reason this component takes the value and not a string — that is
 * three sources per run (the index leaf, `outcome`, `name`), so a monorepo PR
 * of a couple of hundred lanes puts the pip's render effect past the 200
 * sources Solid's development build judges `WIDE_SCOPE_DEPS`.
 *
 * The fixture is a PR of 250 runs, in a real store. The cases judge every
 * diagnostic Solid raised — `info` graded ones included — and the tooltip
 * itself, built here from the fixture rather than from the fold under test.
 */

import type { CheckRun, PrInfo } from "anyforge/schemas";
import { render } from "@solidjs/web";
import { createStore, flush } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { PrPip } from "./PrPip.tsx";

/** A store DRAFT's view of a record whose fields the schema declares
 *  readonly — what a write inside `setStore` is. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** More checks than one scope may hold, at the shape a monorepo PR has. */
const RUNS = 250;

const GLYPH = { pass: "✓", pending: "…", fail: "✗" } as const;

/** Every third lane is still running and every seventh is red — so the tally
 *  and the triage glyphs are all three outcomes, not one repeated. */
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

/** THE TOOLTIP A PERSON READS, built from the fixture's own numbers. */
const tooltipOf = (all: ReadonlyArray<CheckRun>): string => {
  const counts = { pass: 0, pending: 0, fail: 0 };
  for (const one of all) counts[one.outcome] += 1;
  const head = "#2438 A pull request with many lanes";
  const summary = `Checks: fail (${counts.pass}✓ ${counts.pending}… ${counts.fail}✗)`;
  const list = all
    .map((one) => `  ${GLYPH[one.outcome]} ${one.name}`)
    .join("\n");
  return `${head}\n\n${summary}\n${list}`;
};

/** EVERY DIAGNOSTIC SOLID RAISED, one line each — `info` included. */
const findings = (): ReadonlyArray<string> =>
  takeSolidDiagnostics().map(
    (event) => `[${event.severity ?? "none"}] ${event.code} ${event.message}`,
  );

let dispose: (() => void) | undefined;
let host: HTMLElement | undefined;

const mount = (pr: PrInfo): HTMLAnchorElement => {
  host = document.createElement("div");
  document.body.append(host);
  dispose = render(() => <PrPip pr={pr} />, host);
  flush();
  const link = host.querySelector<HTMLAnchorElement>(
    '[data-testid="dock-row-pr-pip"]',
  );
  if (link === null) throw new Error("the pip drew no link");
  return link;
};

afterEach(() => {
  dispose?.();
  host?.remove();
  dispose = undefined;
  host = undefined;
});

describe("a pip whose PR has hundreds of checks", () => {
  it("names every one of them without one wide scope", () => {
    const [pr] = createStore(PR());

    const link = mount(pr);

    expect(link.getAttribute("title")).toBe(tooltipOf(runs()));
    expect(findings()).toEqual([]);
  });

  it("follows one lane going red", () => {
    const [pr, setPr] = createStore(PR());
    const link = mount(pr);
    expect(findings()).toEqual([]);

    setPr((draft: PrInfo) => {
      const all = draft.checkRuns as Mutable<CheckRun>[];
      const one = all[1];
      if (one !== undefined) one.outcome = "fail";
    });
    flush();

    const after = runs().map((one, at) =>
      at === 1 ? { ...one, outcome: "fail" as const } : one,
    );
    expect(link.getAttribute("title")).toBe(tooltipOf(after));
    expect(findings()).toEqual([]);
  });
});
