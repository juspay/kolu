import { Then, When } from "@cucumber/cucumber";
import type { Locator } from "playwright";
import {
  type IdentityChipTestid,
  identityChipSelector,
  openActiveHostDiagnostics,
} from "../support/hostChip.ts";
import type { KoluWorld } from "../support/world.ts";

/** Memory details live on the actual identity chip tooltip/aria-label rather
 *  than hidden test-only DOM. The figure only appears once a real value lands —
 *  server/client are present immediately under Chromium; padi/kaval fill in once
 *  padi's sampler poll is folded into the rail cell (padi owns kaval now).
 *  Padi/Kaval marks live in the host diagnostics popover (quiet-strip redesign). */
async function assertChipMemoryLabel(
  world: KoluWorld,
  testid: IdentityChipTestid,
  pattern: RegExp,
): Promise<void> {
  if (testid !== "kolu-identity-chip") {
    await openActiveHostDiagnostics(world.page);
  }
  const selector = identityChipSelector(testid);
  const chip = world.page.locator(selector);
  await assertLabelEventually(chip, pattern, selector);
}

async function assertLabelEventually(
  locator: Locator,
  pattern: RegExp,
  selector: string,
): Promise<void> {
  await locator.waitFor({ state: "attached", timeout: 15_000 });
  await locator.page().waitForFunction(
    ({ sel, source, flags }) => {
      const text =
        document.querySelector(sel)?.getAttribute("aria-label") ?? "";
      return new RegExp(source, flags).test(text);
    },
    {
      sel: selector,
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
  "the identity rail details include padi memory usage",
  async function (this: KoluWorld) {
    // padi has its own rail chip now, so its RSS reads out on the Padi chip
    // (mirroring kaval), not folded into the Kolu chip's tooltip.
    await assertChipMemoryLabel(this, "padi-identity-chip", /RSS \d+\s*MB/);
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

When("I open the Kaval details dialog", async function (this: KoluWorld) {
  await openActiveHostDiagnostics(this.page);
  await this.page.locator(identityChipSelector("kaval-identity-chip")).click();
});

Then(
  "the Kaval details show kaval memory usage",
  async function (this: KoluWorld) {
    // The daemon's RSS lands once padi's first `system.processMemory` poll is
    // folded into the rail cell, so poll the dialog row until a real MB figure
    // replaces "unavailable".
    const memory = this.page.locator('[data-testid="kaval-dialog-memory"]');
    await memory.waitFor({ state: "visible", timeout: 15_000 });
    await this.page.waitForFunction(
      () =>
        /\d+\s*MB/.test(
          document.querySelector('[data-testid="kaval-dialog-memory"]')
            ?.textContent ?? "",
        ),
      undefined,
      { timeout: 15_000 },
    );
  },
);
