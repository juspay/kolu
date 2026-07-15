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
