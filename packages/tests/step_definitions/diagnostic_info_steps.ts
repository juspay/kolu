import assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

const DIAGNOSTIC_DIALOG = '[data-testid="diagnostic-server"]';

Then(
  "the diagnostic info dialog should be visible",
  async function (this: KoluWorld) {
    await this.page
      .getByText("Diagnostic info", { exact: true })
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the diagnostic info should show server and xterm groups",
  async function (this: KoluWorld) {
    await this.page
      .locator('[data-testid="diagnostic-xterm"]')
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const server = this.page.locator(DIAGNOSTIC_DIALOG);
    await server.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await server
      .getByText("Uptime", { exact: true })
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await server
      .getByText("Active file system watches", { exact: true })
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "WebGL recent events should be collapsed",
  async function (this: KoluWorld) {
    const details = this.page.locator('[data-testid="webgl-recent-events"]');
    await details.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const isOpen = await details.evaluate((el) => el.hasAttribute("open"));
    assert.strictEqual(isOpen, false, "Expected recent events to be collapsed");
  },
);

When("I copy diagnostic info JSON", async function (this: KoluWorld) {
  await this.page.locator('[data-testid="diagnostic-copy-json"]').click();
  await this.waitForFrame();
});

Then(
  "the copied diagnostic info JSON should include server diagnostics",
  async function (this: KoluWorld) {
    const text = await this.page.evaluate(() => navigator.clipboard.readText());
    const parsed = JSON.parse(text) as {
      server?: {
        uptimeMs?: number;
        memory?: { rss?: number };
        resources?: unknown[];
        processes?: unknown[];
      };
    };
    assert.ok(parsed.server, "Expected copied JSON to include server");
    assert.strictEqual(typeof parsed.server.uptimeMs, "number");
    assert.strictEqual(typeof parsed.server.memory?.rss, "number");
    assert.ok(Array.isArray(parsed.server.resources));
    assert.ok(Array.isArray(parsed.server.processes));
  },
);
