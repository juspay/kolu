// @vitest-environment happy-dom
/** A dock row's three value folds — the display pairing, the state pip and the
 *  recency cell — against the dock's own re-rank.
 *
 *  Every re-rank hands a row a FRESH row object through the keyed `<For>`'s item
 *  signal, so all three memos re-run with the terminal's facts unchanged. Each
 *  one returns a freshly allocated bag of already-stable parts, so without an
 *  equality gate each re-run publishes a new-but-equivalent value and wakes the
 *  row's attribute effect and its recency cell for nothing — which Solid's dev
 *  attribution reports as UNSTABLE_MEMO_OUTPUT (`@kolu/solid-test-setup`'s
 *  `afterEach` fails the test on it) once four consecutive runs do it. */

import type { ActiveTerminal } from "@kolu/padi-client/surface";
import { LOCAL_LOCATION } from "@kolu/padi-client/surface";
import type { TerminalId } from "kolu-common/surface";
import { createRenderEffect, createRoot, createSignal, flush } from "solid-js";
import { expect, it, vi } from "vitest";
import type { TerminalDisplayInfo } from "../../terminal/terminalDisplay";

const META: ActiveTerminal = {
  state: "active",
  cwd: "/tmp/repo",
  git: { kind: "none" },
  location: LOCAL_LOCATION,
  pr: { kind: "absent" },
  agent: null,
  foreground: null,
  ports: { status: "unknown" },
  lastActivityAt: null,
  promptedAt: null,
};

const INFO: TerminalDisplayInfo = {
  repoColor: "oklch(0.7 0.1 10)",
  annotationColor: "oklch(0.7 0.1 40)",
  subCount: 0,
  key: { group: "repo", label: "main" },
};

// The store's two projections are IDENTITY-STABLE, as the real keyed store
// projections are: an unchanged record keeps its reference. That is what makes
// the pairing memo's re-run equal-but-new rather than genuinely changed.
vi.mock("../../terminal/useTerminalStore", () => ({
  useTerminalStore: () => ({
    getDisplayInfo: () => INFO,
    getMetadata: () => META,
    isUnread: () => false,
  }),
}));
vi.mock("../../attention/useAttentionFacts", () => ({
  useAttentionFacts: () => ({
    attentionOf: () => ({ klass: "idle", live: false }),
  }),
}));
vi.mock("../../wire", () => ({ encActiveHost: () => "local" }));
vi.mock("./activeRow", () => ({ isActiveRow: () => false }));

import { createDockRowData } from "./dockRowData";
import { useDockRowBag } from "./useDockRowBag";

const ID = "t1" as TerminalId;

it("re-ranking a row with unchanged facts wakes no row reader", () => {
  const harness = createRoot((dispose) => {
    // The keyed `<For>` item signal: a fresh row object per re-rank, same id
    // and same timestamps.
    const [row, setRow] = createSignal({ id: ID, ts: 1_700_000_000_000 });
    const combined = createDockRowData(() => row().id);
    const bag = useDockRowBag()({
      id: () => row().id,
      combined: () => {
        const pair = combined();
        if (pair === null) throw new Error("fixture store always pairs");
        return pair;
      },
      bucket: () => "idle",
      pipBucket: () => "idle",
      recencyAt: () => row().ts,
    });
    let wakes = 0;
    // Stands for the row's `dockRowAttrs` render effect and `RecencyCell`'s
    // reads: both values in one tracking scope, as the row renders them.
    // Solid 2 splits a render effect into a tracked COMPUTE and an untracked
    // write-back; the count lives in the tracked half.
    createRenderEffect(
      () => {
        wakes++;
        return `${bag.pip.variant}:${bag.recency.mode}`;
      },
      () => {},
    );
    return { setRow, dispose, wakes: () => wakes };
  });
  flush();
  expect(harness.wakes()).toBe(1);
  // Five re-ranks — four consecutive equal-but-new publishes is what the dev
  // attribution needs to call a memo's output unstable.
  for (let tick = 1; tick <= 5; tick++) {
    harness.setRow({ id: ID, ts: 1_700_000_000_000 });
    flush();
  }
  expect(harness.wakes()).toBe(1);
  harness.dispose();
});
