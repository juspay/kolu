import { Then } from "@cucumber/cucumber";
import type { Locator } from "playwright";
import type { KoluWorld } from "../support/world.ts";

/** Memory details live on the actual identity chip tooltip/aria-label rather
 *  than hidden test-only DOM. The figure only appears once a real value lands —
 *  server/client are present immediately under Chromium; kaval fills in once the
 *  daemon's first `system.processMemory` poll returns. */
async function assertChipMemoryLabel(
  world: KoluWorld,
  testid: "kolu-identity-chip" | "kaval-identity-chip",
  pattern: RegExp,
): Promise<void> {
  const chip = world.page.locator(`[data-testid="${testid}"]`);
  await assertLabelEventually(chip, pattern, testid);
}

async function assertLabelEventually(
  locator: Locator,
  pattern: RegExp,
  testid: string,
): Promise<void> {
  await locator.waitFor({ state: "attached", timeout: 15_000 });
  await locator.page().waitForFunction(
    ({ selector, source, flags }) => {
      const text =
        document.querySelector(selector)?.getAttribute("aria-label") ?? "";
      return new RegExp(source, flags).test(text);
    },
    {
      selector: `[data-testid="${testid}"]`,
      source: pattern.source,
      flags: pattern.flags,
    },
    { timeout: 15_000 },
  );
}

Then(
  "the identity rail details include server memory usage",
  async function (this: KoluWorld) {
    await assertChipMemoryLabel(
      this,
      "kolu-identity-chip",
      /server RSS \d+\s*MB/,
    );
  },
);

Then(
  "the identity rail details include client memory usage",
  async function (this: KoluWorld) {
    await assertChipMemoryLabel(
      this,
      "kolu-identity-chip",
      /client heap \d+\s*MB/,
    );
  },
);

Then(
  "the identity rail details include kaval memory usage",
  async function (this: KoluWorld) {
    await assertChipMemoryLabel(this, "kaval-identity-chip", /RSS \d+\s*MB/);
  },
);
