import assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

/**
 * E2e steps for the Debug → Diagnostic info dialog. Drives the dialog
 * through the command palette, asserts that the registry-backed server
 * sections render, and round-trips the Copy JSON button to verify the
 * wire shape.
 */

Then(
  "the diagnostic info dialog should be visible",
  async function (this: KoluWorld) {
    await this.page
      .getByText("Diagnostic info", { exact: true })
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the diagnostic info should show server, resources, and xterm sections",
  async function (this: KoluWorld) {
    for (const id of [
      "diagnostic-server",
      "diagnostic-resources",
      "diagnostic-xterm",
    ]) {
      await this.page
        .locator(`[data-testid="${id}"]`)
        .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    }
    // The Server section must contain Uptime — proves the registry-backed
    // RPC resolved (not just that the dialog mounted with stale fallback).
    await this.page
      .locator('[data-testid="diagnostic-server"]')
      .getByText("Uptime", { exact: true })
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "WebGL recent events should be collapsed",
  async function (this: KoluWorld) {
    // The recent-events <details> only renders when the WebGL tracker has
    // some history; on a freshly-created terminal the section may not be
    // present. Skip the check in that case — the assertion is "if it's
    // there, it's collapsed", not "it must exist".
    const details = this.page.locator('[data-testid="webgl-recent-events"]');
    if ((await details.count()) === 0) return;
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
    // Clipboard reads are async — poll until the copy lands. Bare
    // page.evaluate + assert races on slower runners (see
    // .claude/rules/code-police-rules.md `e2e-poll-async-state`).
    await this.page.waitForFunction(
      async () => {
        try {
          const text = await navigator.clipboard.readText();
          if (!text) return false;
          const parsed = JSON.parse(text) as {
            server?: {
              sampledAt?: number;
              uptimeMs?: number;
              memory?: { rss?: number };
              resources?: unknown[];
              processes?: unknown[];
              activations?: unknown[];
            };
          };
          return (
            !!parsed.server &&
            typeof parsed.server.sampledAt === "number" &&
            typeof parsed.server.uptimeMs === "number" &&
            typeof parsed.server.memory?.rss === "number" &&
            Array.isArray(parsed.server.resources) &&
            Array.isArray(parsed.server.processes) &&
            Array.isArray(parsed.server.activations)
          );
        } catch {
          return false;
        }
      },
      undefined,
      { timeout: POLL_TIMEOUT },
    );
  },
);
