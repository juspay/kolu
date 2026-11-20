import * as assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

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

When(
  "I follow the live deep link {string}",
  async function (this: KoluWorld, template: string) {
    const hash = expandDeepLink(this, template);
    await this.page.evaluate((h) => {
      window.location.hash = h;
    }, hash);
  },
);

async function waitForColdBootRestore(
  world: KoluWorld,
  targetId: string,
  mountedIds: readonly string[],
): Promise<void> {
  await world.page.waitForFunction(
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
    { target: targetId, ids: [...mountedIds] },
    { timeout: POLL_TIMEOUT },
  );
}

When(
  "I open the deep link {string} on a cold boot",
  async function (this: KoluWorld, template: string) {
    const hash = expandDeepLink(this, template);
    const targetId = hash.match(/^#\/t\/[^/]+\/([^/?]+)/)?.[1];
    assert.ok(targetId, `cold-boot terminal link has no target id: ${hash}`);
    const expectedIds = [...this.createdTerminalIds];
    await this.page.evaluate((h) => {
      history.replaceState(null, "", h);
    }, hash);
    await this.page.reload();
    await this.waitForSettled();
    await waitForColdBootRestore(this, targetId, expectedIds);
  },
);

When("I remember the sub-terminal's id", async function (this: KoluWorld) {
  const el = this.page.locator("[data-sub-terminal][data-terminal-id]").first();
  await el.waitFor({ state: "attached", timeout: POLL_TIMEOUT });
  const subId = await el.getAttribute("data-terminal-id");
  assert.ok(subId, "expected a sub-terminal carrying data-terminal-id");
  this.rememberedSubTerminalId = subId;
});

Then(
  "the URL hash should still be {string}",
  async function (this: KoluWorld, template: string) {
    const expected = expandDeepLink(this, template);
    const actual = await this.page.evaluate(() => window.location.hash);
    assert.strictEqual(actual, expected);
  },
);

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
