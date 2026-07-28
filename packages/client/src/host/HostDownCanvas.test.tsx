// @vitest-environment happy-dom
/** The host-down card SURFACES the failed episode's retained output instead of dropping it —
 * the regression `HostDownCanvas.tsx`'s header tells in full.
 *
 * SCOPE (the `BootStalledCanvas.test.tsx` idiom): a COMPONENT render pin, not an App-`<Switch>`
 * integration test — `../wire` is mocked so the surface stack never boots. `HostDownCanvas`
 * takes no props (it reads its own episode off `activeEntryState()`/`failedEpisode()`, like
 * `HostDiagnosticsPopover`), so `../kaval/useDaemonStatus` is mocked too, the same way
 * `kaval/useCanvasMode.test.ts` already stubs that module — rendering the REAL App.tsx (or
 * importing the real `useDaemonStatus.ts`, whose top level opens several app-lifetime
 * subscriptions) drags the whole live socket stack.
 */

import type { HostKey } from "kolu-common/hostKey";
import type { EntryFailedCause } from "kolu-common/surfacesWithPadi";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LogLine } from "../ui/logTailChrome";

type FailedEntry = {
  kind: "failed";
  failure: { cause: EntryFailedCause; reason: string };
  /** The failure record's own EVIDENCE — the retained tail surface-map staples on at
   *  classification. REQUIRED, exactly as on the real `EntryStatus`: a failed entry
   *  whose output "we cannot see" is no longer a state that exists. */
  evidence: readonly LogLine[];
};
// The one non-`failed` shape these tests need — `HostDownCanvas` only ever mounts from
// App.tsx's `host-failed` <Match> arm, so any other kind here is a routing bug, not a real
// UI state; see the "throws" test below.
type OtherEntry = { kind: "not-a-member" };

const h = vi.hoisted(() => ({
  host: { kind: "ssh", host: "zest" } as unknown as HostKey,
  entry: {
    kind: "failed",
    failure: { cause: "link-failed", reason: "" },
    evidence: [],
  } as FailedEntry | OtherEntry,
}));
vi.mock("../wire", () => ({
  activeHost: () => h.host,
  setActiveHost: () => {},
  client: { hosts: { reconnect: () => Promise.resolve() } },
}));
// Mirrors the real `failedEpisode` (`kaval/useDaemonStatus.ts`) exactly — `undefined` for any
// non-`failed` entry, and otherwise the episode with its `log` read off the failure record's
// `evidence` (never the live `connection`, which the liveness floor drops). Kept in lockstep
// with production, since what these tests pin is that the evidence reaches the card.
vi.mock("../kaval/useDaemonStatus", () => ({
  activeEntryState: () => h.entry,
  failedEpisode: (entry: FailedEntry | OtherEntry) =>
    entry.kind !== "failed"
      ? undefined
      : {
          cause: entry.failure.cause,
          reason: entry.failure.reason,
          log: entry.evidence,
        },
}));

// Imported AFTER the mocks so it binds them.
const { default: HostDownCanvas } = await import("./HostDownCanvas");

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = "";
});

const TAIL = '[data-testid="host-down-log"]';

const mount = (props: {
  reason: string;
  log: readonly LogLine[];
  cause?: EntryFailedCause;
}): void => {
  h.entry = {
    kind: "failed",
    failure: { cause: props.cause ?? "link-failed", reason: props.reason },
    evidence: props.log,
  };
  dispose = render(() => <HostDownCanvas />, document.body);
};

describe("HostDownCanvas surfaces the failed episode's output", () => {
  it("renders every retained line, so the cause is readable without a rebuild", () => {
    // The real tail from the zest provisioning failure this fix came from: the one-line
    // `reason` says only that nix exited 1; the `nix log` pointer is what names the cause.
    mount({
      reason: "zest: 'nix build' exited with code 1",
      log: [
        { line: " ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  kolu-client typecheck" },
        { line: "For full logs, run:" },
        { line: "  nix log /nix/store/25f3nqdl-kolu-typecheck-2.0.0.drv" },
      ],
    });
    const tail = document.querySelector(TAIL);
    expect(tail).not.toBeNull();
    // Every line, not a truncated head — the useful one is usually last.
    expect(tail?.textContent).toContain("ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL");
    expect(tail?.textContent).toContain(
      "nix log /nix/store/25f3nqdl-kolu-typecheck-2.0.0.drv",
    );
  });

  it("still shows the one-line reason alongside the tail", () => {
    mount({
      reason: "zest: 'nix build' exited with code 1",
      log: [{ line: "error: Cannot build '/nix/store/i8wlxn7a-kolu.drv'." }],
    });
    expect(document.body.textContent).toContain(
      "zest: 'nix build' exited with code 1",
    );
  });

  it("renders no tail block when the failure produced no output", () => {
    // Data absence, not a flag: a cause that never ran a build (a contract refusal)
    // renders exactly the pre-fix card. `[]` is the ONLY absence this arm can carry now —
    // the old sibling case ("we cannot see the output", the floored-away live tail) is
    // unrepresentable here, because the evidence rides the failure record past the floor.
    mount({ reason: "zest: another kolu owns this host", log: [] });
    expect(document.querySelector(TAIL)).toBeNull();
    expect(
      document.querySelector('[data-testid="host-down-canvas"]'),
    ).not.toBeNull();
  });

  it("keeps the recovery verbs reachable below a full tail", () => {
    mount({
      reason: "zest: 'nix build' exited with code 1",
      log: Array.from({ length: 20 }, (_, i) => ({ line: `line ${i}` })),
    });
    expect(
      document.querySelector('[data-testid="host-reconnect"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-testid="switch-to-local"]'),
    ).not.toBeNull();
    // happy-dom does no layout, so "below" is not observable — assert the CLASSES that
    // encode the invariant instead, which is what actually keeps a 20-line tail from
    // pushing the verbs off-screen.
    const cls = document.querySelector(TAIL)?.className ?? "";
    expect(cls).toContain("max-h-40");
    expect(cls).toContain("overflow-y-auto");
  });

  it("throws if mounted while the active entry isn't failed (fail loud, same as requireKind)", () => {
    // Unrepresentable in the real app — App.tsx only ever mounts this card from the
    // `host-failed` <Match> arm, which is keyed on the active entry actually being `failed`.
    // Pinned here (never via App.tsx, which this file deliberately doesn't mount) because
    // it's the one behavior a props-only render pin couldn't have exercised, and the one
    // that a `createMemo` misplaced at App.tsx's top level (instead of here) turned into an
    // eager crash on every ordinary boot.
    h.entry = { kind: "not-a-member" };
    expect(() => render(() => <HostDownCanvas />, document.body)).toThrowError(
      /HostDownCanvas: entry is not-a-member/,
    );
  });
});
