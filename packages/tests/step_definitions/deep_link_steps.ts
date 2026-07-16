/** Deep-link steps — drive the `#/…` hash-URL router (`useDeepLinks.ts`).
 *
 *  Two delivery paths are exercised: a live `hashchange` (set `location.hash`
 *  on the running page — no reload) and a cold boot (set the hash, then reload
 *  so the app's boot parse fires against it). Terminal ids are dynamic, so link
 *  templates carry placeholders the helper expands: `{id1}`/`{id2}` → the Nth
 *  `I create a terminal`, `{sub}` → the remembered sub-terminal. */

import * as assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
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
    await this.page.evaluate((h) => {
      window.location.hash = h;
    }, hash);
    await this.page.reload();
    await this.waitForSettled();
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
 *  fires exactly as for the real buttons). A deliberate NON-reaction has no
 *  signal to poll — pin it with a settle beat, then waitForFrame. */
const TRAVERSAL_SETTLE_MS = 500;

async function traverseHistory(
  world: KoluWorld,
  direction: "back" | "forward",
): Promise<void> {
  await world.page.evaluate(
    (d) => (d === "back" ? history.back() : history.forward()),
    direction,
  );
  await world.page.waitForTimeout(TRAVERSAL_SETTLE_MS);
  await world.waitForFrame();
}

When("I go back in browser history", async function (this: KoluWorld) {
  await traverseHistory(this, "back");
});

When("I go forward in browser history", async function (this: KoluWorld) {
  await traverseHistory(this, "forward");
});
