/** Deep-link steps — drive the `#/…` hash-URL router (`useDeepLinks.ts`).
 *
 *  Two delivery paths are exercised: a live `hashchange` (set `location.hash`
 *  on the running page — no reload) and a cold boot (set the hash, then reload
 *  so the app's boot parse fires against it). Terminal ids are dynamic, so link
 *  templates carry placeholders the helper expands: `{id1}`/`{id2}` → the Nth
 *  `I create a terminal`, `{sub}` → the remembered sub-terminal. */

import * as assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import { pollFor } from "../support/poll.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

/** Expand `{id1}`/`{id2}`/`{sub}` placeholders in a link template to live ids. */
function expandDeepLink(world: KoluWorld, template: string): string {
  return template
    .replace(/\{id(\d+)\}/g, (_m, n: string) => {
      const id = world.createdTerminalIds[Number(n) - 1];
      assert.ok(
        id,
        `no created terminal #${n} — call "I create a terminal" first`,
      );
      return id;
    })
    .replace(/\{sub\}/g, () => {
      const id = world.rememberedSubTerminalId;
      assert.ok(
        id,
        'no remembered sub-terminal — call "I remember the sub-terminal\'s id" first',
      );
      return id;
    });
}

/** Live navigation — set the hash on the running page (fires `hashchange`). */
When(
  "I follow the live deep link {string}",
  async function (this: KoluWorld, template: string) {
    const hash = expandDeepLink(this, template);
    await this.page.evaluate((h) => {
      window.location.hash = h;
    }, hash);
  },
);

/** Cold boot — set the hash, then reload so the boot parse (onMount) fires
 *  against it, re-attaching to the still-live terminals as it settles. */
When(
  "I open the deep link {string} on a cold boot",
  async function (this: KoluWorld, template: string) {
    const hash = expandDeepLink(this, template);
    const targetId = hash.match(/^#\/t\/[^/]+\/([^/?]+)/)?.[1];
    assert.ok(targetId, `cold-boot terminal link has no target id: ${hash}`);
    const expectedIds = [...this.createdTerminalIds];
    // Install the boot URL without firing `hashchange` in the live app. The
    // reload is the only delivery edge this scenario exercises.
    await this.page.evaluate((h) => {
      history.replaceState(null, "", h);
    }, hash);
    await this.page.reload();
    await this.waitForSettled();
    // `waitForSettled` can return after the first terminal paints. A cold boot
    // is complete only once the route was consumed, every pre-existing
    // terminal is MOUNTED, and the requested one owns focus.
    //
    // Mounted, not attached: since kolu#2362 a desktop tile holds a live feed
    // (and so carries `data-visible`) only while it is on screen, so a
    // restored tile parked off the canvas would never satisfy an
    // attach-shaped wait. What this step is really waiting for is that the
    // restored session's terminals exist and the link's target has focus —
    // and `data-focused` is set on the pane the route landed on, which is the
    // active tile and therefore attached anyway.
    await this.page.waitForFunction(
      ({ target, ids }) => {
        const terminals = Array.from(
          document.querySelectorAll("[data-terminal-id][data-font-size]"),
        );
        const mounted = new Set(
          terminals
            .map((el) => el.getAttribute("data-terminal-id"))
            .filter((id): id is string => id !== null),
        );
        return (
          (history.state as { koluRouted?: boolean } | null)?.koluRouted ===
            true &&
          ids.every((id) => mounted.has(id)) &&
          terminals.some(
            (el) =>
              el.getAttribute("data-terminal-id") === target &&
              el.hasAttribute("data-visible") &&
              el.hasAttribute("data-focused"),
          )
        );
      },
      { target: targetId, ids: expectedIds },
      { timeout: POLL_TIMEOUT },
    );
  },
);

/** A FRESH OPEN at a link — what a new browser tab opened on a shared link
 *  sees: nothing in this tab's `sessionStorage` (so no remembered chrome tab
 *  or host), the link in the address bar, and a cold boot. The terminals the
 *  scenario created are still live on the server, as they would be. */
When(
  "I open the deep link {string} as a fresh open",
  async function (this: KoluWorld, template: string) {
    const hash = expandDeepLink(this, template);
    await this.page.evaluate((h) => {
      sessionStorage.clear();
      history.replaceState(null, "", h);
    }, hash);
    await this.page.reload();
    await this.waitForSettled();
  },
);

/** The terminal a person is looking at: the one terminal screen on screen.
 *  Read from the panes' own geometry, so a tile mounted but off screen or
 *  under a covering layer does not count. */
Then(
  "the terminal on screen should be {string}",
  async function (this: KoluWorld, template: string) {
    const expected = expandDeepLink(this, template);
    await pollFor({
      observe: () =>
        this.page.evaluate(() => {
          const onScreen: string[] = [];
          for (const el of document.querySelectorAll<HTMLElement>(
            "[data-visible][data-terminal-id]:not([data-sub-terminal])",
          )) {
            const r = el.getBoundingClientRect();
            const shown =
              r.width > 0 &&
              r.height > 0 &&
              r.right > 0 &&
              r.bottom > 0 &&
              r.left < window.innerWidth &&
              r.top < window.innerHeight &&
              el.checkVisibility();
            const id = el.getAttribute("data-terminal-id");
            if (shown && id) onScreen.push(id);
          }
          return onScreen;
        }),
      isDone: (ids) => ids.length === 1 && ids[0] === expected,
      onTimeout: (last, ms) =>
        new Error(
          `after ${ms}ms the terminals on screen are ${JSON.stringify(last)}, not ["${expected}"]`,
        ),
      timeoutMs: POLL_TIMEOUT,
    });
  },
);

/** Capture the current split's terminal id so a later link can target it after
 *  focus has moved to another tile. The sub pane carries both attributes on one
 *  element (`Terminal.tsx`). */
When("I remember the sub-terminal's id", async function (this: KoluWorld) {
  const el = this.page.locator("[data-sub-terminal][data-terminal-id]").first();
  await el.waitFor({ state: "attached", timeout: POLL_TIMEOUT });
  const subId = await el.getAttribute("data-terminal-id");
  assert.ok(subId, "expected a sub-terminal carrying data-terminal-id");
  this.rememberedSubTerminalId = subId;
});

/** The hash is left in place after a handled route (durability — a bookmark
 *  re-navigates on reload; we never strip it). */
Then(
  "the URL hash should still be {string}",
  async function (this: KoluWorld, template: string) {
    const expected = expandDeepLink(this, template);
    const actual = await this.page.evaluate(() => window.location.hash);
    assert.strictEqual(actual, expected);
  },
);

/** Snapshot the top-level `history.length` so a later step can pin that
 *  deep-link routing pushed NO entries (srid's ruling: a routed link must not
 *  record history that ordinary in-app navigation doesn't — otherwise
 *  mouse-back replays stale teleports). */
When("I note the page history length", async function (this: KoluWorld) {
  this.pageHistoryLength = await this.page.evaluate(() => history.length);
});

Then(
  "the page history length should be unchanged",
  async function (this: KoluWorld) {
    assert.ok(
      this.pageHistoryLength !== null,
      'no snapshot — call "I note the page history length" first',
    );
    const now = await this.page.evaluate(() => history.length);
    assert.strictEqual(
      now,
      this.pageHistoryLength,
      `deep-link routing pushed ${now - this.pageHistoryLength} history entr(y/ies) — mouse-back would replay stale teleports`,
    );
  },
);

/** Browser-history traversal — the mouse-back/forward gesture. Driven via
 *  `history.back()/forward()` (a same-document hash traversal; `hashchange`
 *  fires exactly as for the real buttons). Await the traversal's own
 *  `hashchange` (the gate — or a wrongful route — runs synchronously inside
 *  that dispatch), then one frame for paint. Bounded: a traversal that fires
 *  no `hashchange` (no adjacent entry, or a same-hash neighbour) rejects with
 *  a named error instead of hanging into the opaque cucumber step timeout. */
async function traverseHistory(
  world: KoluWorld,
  direction: "back" | "forward",
): Promise<void> {
  await world.page.evaluate(
    (d) =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () =>
            reject(
              new Error(
                `history.${d}() produced no hashchange — no adjacent entry, or its hash is identical`,
              ),
            ),
          5000,
        );
        window.addEventListener(
          "hashchange",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
        if (d === "back") history.back();
        else history.forward();
      }),
    direction,
  );
  await world.waitForFrame();
}

When("I go back in browser history", async function (this: KoluWorld) {
  await traverseHistory(this, "back");
});

When("I go forward in browser history", async function (this: KoluWorld) {
  await traverseHistory(this, "forward");
});
