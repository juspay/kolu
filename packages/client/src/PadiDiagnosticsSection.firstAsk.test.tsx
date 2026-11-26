// @vitest-environment happy-dom
/**
 * The padi section's FIRST ask, pinned against Solid 2's forbidden-scope rule.
 *
 * `createPadiDiagnosticsFetch` asks once as the dialog comes up, and the two
 * reads that question needs — the active host, and whether that host's padi is
 * connected — go through the keyed-entry cache, which pairs its subscription
 * ref-count with an `onCleanup` taken under the READING scope
 * (`@kolu/surface/solid/keyedSubscriptionCache`). Asked from a settle
 * callback, that scope forbids children: `onCleanup` raises
 * `CLEANUP_IN_FORBIDDEN_SCOPE` and throws, the ask unwinds before it is made,
 * and the section paints "Asking padi…" for the rest of the dialog's life —
 * which is what killed `features/diagnostics.feature:6`.
 *
 * So the stub entry below registers an `onCleanup` from `state()`, exactly as
 * the real keyed read does, and the test asserts the whole ask: `loading` with
 * no host before it, `loading` with the host while it is in flight, then the
 * answer — and the ref-count released when the dialog goes away, which is the
 * lifetime the owning scope buys. A dev diagnostic raised on the way fails
 * this test by itself (`@kolu/solid-test-setup`).
 */

import type { PadiDiagnostics } from "@kolu/padi-client/surface";
import { render } from "@solidjs/web";
import { Effect } from "effect";
import type { HostKey } from "kolu-common/hostKey";
import { createSignal, flush, onCleanup } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import type {
  PadiDiagnosticsFetch,
  PadiDiagnosticsFetcher,
} from "./PadiDiagnosticsSection";

const LOCAL: HostKey = { kind: "local" };

const SUMMARY = { count: 2, medianMs: 1.5, p99Ms: 4, maxMs: 9, sumMs: 3 };

const ANSWER: PadiDiagnostics = {
  process: { pid: 4242, uptimeMs: 61_000 },
  memory: {
    rssBytes: 180_000_000,
    heapUsedBytes: 40_000_000,
    heapTotalBytes: 60_000_000,
    externalBytes: 5_000_000,
    nonHeapBytes: 120_000_000,
  },
  stalls: {
    resolutionMs: 10,
    lastMinute: { kind: "unmeasured", reason: "no minute has completed yet" },
    current: {
      summary: { kind: "measured", value: SUMMARY },
      elapsedMs: 1_000,
    },
  },
  children: { windowMs: 60_000, rows: [] },
  calls: { windowMs: 60_000, rows: [] },
  watchers: { rows: [] },
  kernelWatches: {
    kind: "measured",
    value: { total: 3, perInstance: [{ fd: 7, watches: 3 }] },
  },
};

/** The ref-count the keyed read keeps, the asks the stub procedure has taken,
 *  and the answer it is holding back until a test releases it. */
let reads = 0;
let releases = 0;
let asks = 0;
/** The entry's own publish count — the keyed status is a fresh record per
 *  publish, so a test can republish the SAME status. A test installs it. */
let republish: () => number = () => 0;
let pending = Promise.withResolvers<PadiDiagnostics>();

vi.mock("./wire", () => ({
  activeHost: () => LOCAL,
  padiMap: {
    entry: () => ({
      state: () => {
        // What the keyed-subscription cache does on every read: take the
        // ref-count, and give it back when the reading scope is disposed.
        reads++;
        onCleanup(() => {
          releases++;
        });
        republish();
        // A FRESH record, which is what the cache's store publishes.
        return { kind: "connected" };
      },
      procedures: {
        diagnostics: {
          read: () => {
            asks++;
            return Effect.promise(() => pending.promise);
          },
        },
      },
    }),
  },
}));

// Dynamic, because the mock above must be registered before the module under
// test resolves `./wire`.
const { createPadiDiagnosticsFetch } = await import("./PadiDiagnosticsSection");

let dispose: (() => void) | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  host?.remove();
  dispose = undefined;
  host = undefined;
  reads = 0;
  releases = 0;
  asks = 0;
  republish = () => 0;
  pending = Promise.withResolvers<PadiDiagnostics>();
});

/** Mount a view that holds the fetch the way the dialog does — in a component
 *  body, under the dialog's owner. */
function mount(): PadiDiagnosticsFetcher {
  host = document.createElement("div");
  document.body.append(host);
  let fetcher: PadiDiagnosticsFetcher | undefined;
  dispose = render(() => {
    fetcher = createPadiDiagnosticsFetch();
    return <div>padi</div>;
  }, host);
  if (!fetcher) throw new Error("the view never built a fetch");
  return fetcher;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve();
  flush();
  for (let i = 0; i < 4; i++) await Promise.resolve();
  flush();
}

it("puts the dialog's first question to padi and keeps the answer", async () => {
  const fetch = mount();
  // The ask is away by the end of the mount's own flush: the host is named,
  // so the section is waiting on padi rather than waiting to be asked. The
  // hostless `loading` the signal starts at is never painted.
  expect(fetch.state()).toEqual<PadiDiagnosticsFetch>({
    kind: "loading",
    host: LOCAL,
  });
  expect(reads).toBeGreaterThan(0);

  pending.resolve(ANSWER);
  await settle();
  expect(fetch.state()).toEqual<PadiDiagnosticsFetch>({
    kind: "answer",
    host: LOCAL,
    answer: ANSWER,
  });
});

it("releases the entry's ref-count with the dialog", async () => {
  mount();
  await settle();
  expect(releases).toBe(0);

  dispose?.();
  dispose = undefined;
  expect(releases).toBe(reads);
});

it("a status the entry republishes unchanged moves no target", async () => {
  // Five publishes of the SAME status — a reconnect probe landing, a health
  // poll answering — each a fresh record off the keyed store. The question's
  // two inputs have not moved, so the memo between the status and the ask
  // must not republish; ungated it mints an equal-but-new pair every time,
  // which Solid's dev attribution reports as UNSTABLE_MEMO_OUTPUT (object).
  const [publishes, setPublishes] = createSignal(0);
  republish = publishes;
  const fetch = mount();
  expect(asks).toBe(1);

  for (let pass = 1; pass <= 5; pass++) {
    setPublishes(pass);
    flush();
  }

  // One question still, and the host it was put to is unchanged.
  expect(asks).toBe(1);
  expect(fetch.state()).toEqual<PadiDiagnosticsFetch>({
    kind: "loading",
    host: LOCAL,
  });
  pending.resolve(ANSWER);
  await settle();
  expect(asks).toBe(1);
});
