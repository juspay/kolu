/** THREE HOST SWITCHES, THROUGH THE REAL TRAIL AND THE REAL HOST ROWS.
 *
 *  `createHostRecency`'s recording effect writes the trail from an effect's
 *  apply arm, keyed on the active host. The palette's root index folds BOTH
 *  legs of that one switch in a single memo — `deps.activeHost()` and, inside
 *  `hostRootActions`, the trail itself (`commands.tsx:254-256` →
 *  `palette/hostActions.ts:39`). A reader of both is exactly what an unsettled
 *  effect-origin write tears: the memo answers once in the flush where the host
 *  changed (new host, STALE trail — ⌘⇧H lands on the wrong row) and again after
 *  the recording effect relays the switch into the trail.
 *
 *  So the victim here is that fold, narrowed to its two reads and run through
 *  the REAL rows and the REAL default-highlight rule: what ⌘⇧H would land on.
 *  Three switches, because an advisory tear escalates to a warning on the third
 *  — and the assertion is an EMPTY diagnostics list, `info` included, so the
 *  first sighting is already the failure.
 *
 *  The `./wire` stand-in is the one from `hostRecency.test.ts`: a bare signal
 *  for the active-host pref plus the real encoded memo over it, so a switch is
 *  driven the way every surface drives it — by writing the active host. */

import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import { createEffect, createMemo, createRoot, flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";

const bag = vi.hoisted(() => ({
  // Both set inside the mock factory (hoisted above the imports it needs).
  active: (): HostKey => ({ kind: "local" }),
  setActive: (_h: HostKey) => {},
}));

vi.mock("../wire", async () => {
  const { createSignal, createMemo, createRoot } = await import("solid-js");
  const { encodeHostKey } = await import("kolu-common/hostKey");
  const [active, setActive] = createSignal<HostKey>({ kind: "local" });
  bag.active = active;
  bag.setActive = (h: HostKey) => {
    setActive(h);
  };
  return {
    // The trail keys on the ENCODED memo, as `wire.ts` exposes it — so a
    // fresh-but-equal `HostKey` write is not a host change, as production sees
    // it. The raw signal below is the ROOT both legs of the fold share.
    encActiveHost: createRoot(() => createMemo(() => encodeHostKey(active()))),
    // Every pool host reads connected — the row's status text, not the rank.
    padiMap: { entry: () => ({ state: () => ({ kind: "connected" }) }) },
  };
});

import { hostRootActions } from "../palette/hostActions";
import { defaultSelectionIndex } from "../palette/rootIndex";

const LOCAL: HostKey = { kind: "local" };
const GPU: HostKey = { kind: "remote", target: "gpu-box" };
const BUILDER: HostKey = { kind: "remote", target: "builder" };
// Membership order, which is the order the rows paint in — deliberately NOT the
// visit order, so a pass by accident of position can't happen.
const POOL = [LOCAL, GPU, BUILDER];

const diagnostics = (): string[] =>
  takeSolidDiagnostics().map(
    (event) => `[${event.severity}] ${event.code} ${event.message}`,
  );

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
});

it("records three switches with no host-row reader left torn", () => {
  /** What the victim answered, one entry per run. */
  const runs: (string | undefined)[] = [];
  const built = createRoot((disposeRoot) => {
    dispose = disposeRoot;
    // THE VICTIM, as the root index folds it: the host rows are built from the
    // pool and the ACTIVE host, each row carrying its stamp from the trail, and
    // the default highlight is read off them. Both legs — the switch and the
    // trail it is recorded in — in one memo.
    const landing = createMemo(
      () => {
        const active = bag.active();
        const rows = hostRootActions(POOL, active, () => {});
        const name =
          rows[
            defaultSelectionIndex(
              rows,
              { hostKey: encodeHostKey(active), terminalId: null },
              "",
            )
          ]?.name;
        runs.push(name);
        return name;
      },
      { name: "commands.hostRows" },
    );
    // STANDING, as an open palette holds it: a memo nobody reads never re-runs,
    // and a reader that never re-runs cannot be torn.
    createEffect(landing, () => {});
    return { landing };
  });
  flush();
  // The boot host's own recording is not this case's subject.
  takeSolidDiagnostics();
  runs.length = 0;

  // Each switch, and the host it must leave highlighted — the way back, so
  // Enter toggles the last two. The third is where an advisory tear escalates.
  const rounds = [
    [GPU, "local"],
    [BUILDER, "gpu-box"],
    [GPU, "builder"],
  ] as const;
  for (const [to, back] of rounds) {
    bag.setActive(to);
    flush();

    // THE TRAIL'S PUBLISHED ANSWER: ⌘⇧H highlights the host you came from, and
    // the victim's last answer is the settled one.
    expect(built.landing()).toBe(back);
    expect(runs.at(-1)).toBe(back);
    // RED AT THE FIRST SIGHTING: an advisory relay tear is a finding here.
    expect(diagnostics()).toEqual([]);
  }
});
