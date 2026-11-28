// @vitest-environment happy-dom
/** THE TRIPWIRE ON THE TOASTER'S UNGATED LISTS.
 *
 *  `<Toaster>` keeps its toasts in a store and derives four lists from it: the
 *  toasts this toaster shows, the set of positions they occupy, and the
 *  per-position toast and height slices. kolu mounts one toaster per document
 *  — `App.tsx` or `conductor/reader/ReaderWindow.tsx`, whichever `index.tsx`
 *  renders for this window — each with a static `position`, so that second
 *  list is `["bottom-right"]` for the whole life of the app, and a toaster
 *  that rebuilds it on every publish commits a new-but-equal array each time
 *  and wakes the `<For>` over the positions and everything under it for
 *  nothing.
 *
 *  `solid-sonner` 1.0.0 derives all four with no `equals` option, so four
 *  consecutive republishes of an equivalent array are what Solid's
 *  attribution engine raises `UNSTABLE_MEMO_OUTPUT` on. The repair is
 *  wobsoriano/solid-sonner#56, unreleased; until a release carries it, the
 *  e2e dev lane allows exactly that finding
 *  (`isSonnerToasterListMemo`, `kolu-common/solidDiagnostics`).
 *
 *  SO THIS FILE IS INVERTED. It drives the publishes, takes the diagnostics
 *  off `@kolu/solid-test-setup`'s collector so its `afterEach` has none to
 *  throw with, and holds that what it took is AT LEAST ONE finding and
 *  NOTHING but the allowed toaster memos — the same predicate both lanes
 *  judge by. A finding the allowance does not cover fails here. And when a
 *  `solid-sonner` release carries #56 the warning stops coming, the
 *  at-least-one assertion fails, and that is the signal to delete the
 *  allowance with its tests and this inversion with it: the toasts shown are
 *  the part of this file that survives. */

import { render } from "@solidjs/web";
import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { isSonnerToasterListMemo } from "kolu-common/solidDiagnostics";
import { flush } from "solid-js";
import { Toaster, toast } from "solid-sonner";
import { expect, it, onTestFinished } from "vitest";

/** TAKE WHAT THE TOASTER RAISED, AND JUDGE IT. Draining is what keeps the
 *  setup's `afterEach` from failing a test whose whole subject is a
 *  diagnostic; the two assertions are the tripwire. An unexpected finding is
 *  printed in full, since the point of failing is to name it. */
const expectOnlyToasterMemos = (): void => {
  const raised = takeSolidDiagnostics();
  const unexpected = raised.filter((event) => !isSonnerToasterListMemo(event));
  expect(
    unexpected.map(
      (event) =>
        `[${event.severity}] ${event.code} on "${event.nodeName}" in ${(event.ownerPath ?? []).join(" > ")}: ${event.message}`,
    ),
  ).toEqual([]);
  // AT LEAST ONE, so a release carrying wobsoriano/solid-sonner#56 fails here
  // and takes the e2e allowance out with it.
  expect(raised.length).toBeGreaterThan(0);
};

/** The toaster's store write runs in a microtask (Solid 2 rejects a write
 *  while a component renders), so each publish needs the queue drained and the
 *  graph flushed before the next one. */
const settle = async () => {
  for (let pass = 0; pass < 4; pass++) {
    await Promise.resolve();
    flush();
  }
};

it("raises the toaster's list warning, and only that, across unchanged publishes", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(
    () => <Toaster position="bottom-right" richColors />,
    host,
  );
  onTestFinished(() => {
    dispose();
    host.remove();
  });
  await settle();

  // Five publishes. Each changes the toast list — and leaves the set of
  // positions, which is all the static `position` prop can make it, alone.
  for (let index = 0; index < 5; index++) {
    toast(`toast ${index}`);
    await settle();
  }

  // The toasts are on screen: the missing gate costs a republish, not a
  // render.
  expect(document.querySelectorAll("[data-sonner-toast]")).toHaveLength(5);
  expectOnlyToasterMemos();
});

it("raises the per-position list warning when another position publishes", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(
    () => <Toaster position="bottom-right" richColors />,
    host,
  );
  onTestFinished(() => {
    dispose();
    host.remove();
  });
  await settle();

  // One toast at the toaster's own position. The toast state is module-global
  // and outlives a `<Toaster>`, so what the `bottom-right` slice holds is
  // whatever this file published before, plus this one — the count that must
  // not move once the other position starts publishing.
  toast("the steady one");
  await settle();
  const at = (y: string) =>
    document
      .querySelector(`ol[data-sonner-toaster][data-y-position="${y}"]`)
      ?.querySelectorAll("[data-sonner-toast]").length ?? 0;
  const steady = at("bottom");

  // Five publishes that land at ANOTHER position. Each one changes the
  // toaster's filtered list, so the `bottom-right` row's `toastsByPosition`
  // and `heightsByPosition` recompute — and each time they produce the same
  // toasts they produced before. With no equality gate on those two memos
  // (`solid-sonner`'s `index.jsx` per-position slices), the fourth republish
  // of an equal list is what `UNSTABLE_MEMO_OUTPUT` names — raised under the
  // `<For>` the slices feed.
  for (let index = 0; index < 5; index++) {
    toast(`elsewhere ${index}`, { position: "top-left" });
    await settle();
  }

  // Both positions are on screen: the missing gate costs a republish, not a
  // render.
  expect(at("top")).toBe(5);
  expect(at("bottom")).toBe(steady);
  expectOnlyToasterMemos();
});
