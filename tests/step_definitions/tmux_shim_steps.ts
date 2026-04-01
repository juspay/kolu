import { Then, When } from "@cucumber/cucumber";
import { KoluWorld } from "../support/world.ts";
import { pollUntilBufferContains } from "../support/buffer.ts";
import * as assert from "node:assert";

Then(
  "the \\/api\\/terminals endpoint should return a JSON array with at least {int} terminal",
  async function (this: KoluWorld, minCount: number) {
    const resp = await this.page.request.fetch("/api/terminals");
    assert.ok(resp.ok(), `GET /api/terminals failed: ${resp.status()}`);
    const body = await resp.json();
    assert.ok(Array.isArray(body), "Expected JSON array");
    assert.ok(
      body.length >= minCount,
      `Expected at least ${minCount} terminals, got ${body.length}`,
    );
    // Verify shape
    const first = body[0];
    assert.ok(first.id, "Terminal should have an id");
    assert.ok(first.pid, "Terminal should have a pid");
    assert.ok(first.meta, "Terminal should have meta");
  },
);

Then(
  "the screen state should not contain {string}",
  async function (this: KoluWorld, unexpected: string) {
    // Small delay to let terminal output render
    await this.waitForFrame();
    const content = await this.page.evaluate(() => {
      const el = document.querySelector("[data-visible] .xterm-screen");
      return el?.textContent ?? "";
    });
    assert.ok(
      !content.includes(unexpected),
      `Screen state should NOT contain "${unexpected}" but it does`,
    );
  },
);

// --- tmux shim integration steps ---

When(
  "I create a sub-terminal via the tmux shim",
  async function (this: KoluWorld) {
    // Use tmux split-window -P -F to create and get the pane ID
    await this.terminalRun(
      "NEW_PANE=$(tmux split-window -h -P -F '#{pane_id}'); echo NEWPANE=$NEW_PANE",
    );
    await pollUntilBufferContains(this.page, "NEWPANE=%");
  },
);

When(
  "I send keys {string} via the tmux shim to the new pane",
  async function (this: KoluWorld, keys: string) {
    // Get terminal list to find the last created pane
    const resp = await this.page.request.fetch("/api/terminals");
    const terminals = await resp.json();
    const lastTerminal = terminals[terminals.length - 1];
    const paneMap = new Map<number, string>();
    terminals.forEach((t: { id: string }, i: number) => paneMap.set(i, t.id));

    // Find the pane index of the last terminal
    const lastIndex = terminals.length - 1;
    await this.terminalRun(`tmux send-keys -t %${lastIndex} -l '${keys}'`);
  },
);

When(
  "I send key Enter via the tmux shim to the new pane",
  async function (this: KoluWorld) {
    const resp = await this.page.request.fetch("/api/terminals");
    const terminals = await resp.json();
    const lastIndex = terminals.length - 1;
    await this.terminalRun(`tmux send-keys -t %${lastIndex} Enter`);
  },
);

When(
  "I wait {int} second(s)",
  async function (this: KoluWorld, seconds: number) {
    await new Promise((r) => setTimeout(r, seconds * 1000));
  },
);

When(
  "I capture the new pane via the tmux shim",
  async function (this: KoluWorld) {
    const resp = await this.page.request.fetch("/api/terminals");
    const terminals = await resp.json();
    const lastIndex = terminals.length - 1;
    await this.terminalRun(
      `tmux capture-pane -p -t %${lastIndex} > /tmp/kolu-tmux-capture-test.txt; echo CAPTURED`,
    );
    await pollUntilBufferContains(this.page, "CAPTURED");
  },
);

Then(
  "the captured text should contain {string}",
  async function (this: KoluWorld, expected: string) {
    const fs = await import("node:fs/promises");
    const text = await fs.readFile("/tmp/kolu-tmux-capture-test.txt", "utf-8");
    assert.ok(
      text.includes(expected),
      `Captured pane text does not contain "${expected}". Got: ${text.slice(0, 500)}`,
    );
  },
);
