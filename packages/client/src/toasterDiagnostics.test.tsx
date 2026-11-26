// @vitest-environment happy-dom
/** THE TOASTER'S DERIVED LISTS, ACROSS PUBLISHES THAT CHANGED NOTHING ABOUT THEM.
 *
 *  `<Toaster>` keeps its toasts in a store and derives four lists from it: the
 *  toasts this toaster shows, the set of positions they occupy, and the
 *  per-position toast and height slices. kolu mounts one toaster with a static
 *  `position`, so that second list is `["bottom-right"]` for the whole life of
 *  the app — and a toaster that rebuilds it on every publish commits a
 *  new-but-equal array each time and wakes the `<For>` over the positions and
 *  everything under it for nothing.
 *
 *  Four consecutive republishes of an equivalent array are what Solid's
 *  attribution engine raises `UNSTABLE_MEMO_OUTPUT` on, and
 *  `@kolu/solid-test-setup`'s `afterEach` fails this test over it. So this is
 *  what says the grafted `solid-sonner` — the one whose memos carry an equality
 *  gate (`nix/packages/solid-sonner.nix`) — is the copy installed here, rather
 *  than the registry's 1.0.0, which has none. */

import { render } from "@solidjs/web";
import { flush } from "solid-js";
import { Toaster, toast } from "solid-sonner";
import { expect, it, onTestFinished } from "vitest";

/** The toaster's store write runs in a microtask (Solid 2 rejects a write
 *  while a component renders), so each publish needs the queue drained and the
 *  graph flushed before the next one. */
const settle = async () => {
  for (let pass = 0; pass < 4; pass++) {
    await Promise.resolve();
    flush();
  }
};

it("keeps the toaster's derived lists stable across unchanged publishes", async () => {
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

  // The toasts are on screen: the gate withholds a republish, not a render.
  expect(document.querySelectorAll("[data-sonner-toast]")).toHaveLength(5);
});

it("keeps the per-position lists stable when another position publishes", async () => {
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
  // toasts they produced before. Without an equality gate on those two
  // memos (`solid-sonner`'s `index.jsx` per-position slices) the fourth
  // republish of an equal list is what `UNSTABLE_MEMO_OUTPUT` names, and the
  // setup's `afterEach` fails the test over it.
  for (let index = 0; index < 5; index++) {
    toast(`elsewhere ${index}`, { position: "top-left" });
    await settle();
  }

  // Both positions are on screen: the gate withholds a republish, not a render.
  expect(at("top")).toBe(5);
  expect(at("bottom")).toBe(steady);
});
