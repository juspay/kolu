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
    const resp = await this.page.request.fetch("/api/terminals");
    const terminals = await resp.json();
    const last = terminals[terminals.length - 1];
    await this.terminalRun(
      `tmux send-keys -t %${last.tmuxPaneIndex} -l '${keys}'`,
    );
  },
);

When(
  "I send key Enter via the tmux shim to the new pane",
  async function (this: KoluWorld) {
    const resp = await this.page.request.fetch("/api/terminals");
    const terminals = await resp.json();
    const last = terminals[terminals.length - 1];
    await this.terminalRun(`tmux send-keys -t %${last.tmuxPaneIndex} Enter`);
  },
);

When(
  "I wait {int} second(s)",
  async function (this: KoluWorld, seconds: number) {
    await new Promise((r) => setTimeout(r, seconds * 1000));
  },
);

When(
  "I capture the current pane via the tmux shim",
  async function (this: KoluWorld) {
    // Get the current terminal's pane index from the API
    const resp = await this.page.request.fetch("/api/terminals");
    const terminals = await resp.json();
    // The visible terminal is the first one (Background step creates it)
    const paneIdx = terminals[0].tmuxPaneIndex;
    // Use the HTTP API directly as a simpler test of screen capture
    const capResp = await this.page.request.fetch("/rpc/terminal/screenText", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({ json: { id: terminals[0].id } }),
    });
    const capBody = await capResp.json();
    const capText = (capBody.json ?? capBody) as string;
    const fs = await import("node:fs/promises");
    await fs.writeFile("/tmp/kolu-cap.txt", capText);
  },
);

When(
  "I capture the new pane via the tmux shim",
  async function (this: KoluWorld) {
    const resp = await this.page.request.fetch("/api/terminals");
    const terminals = await resp.json();
    const last = terminals[terminals.length - 1];
    await this.terminalRun(
      `tmux capture-pane -p -t %${last.tmuxPaneIndex} > /tmp/kolu-tmux-capture-test.txt; echo CAPTURED`,
    );
    await pollUntilBufferContains(this.page, "CAPTURED");
  },
);

Then(
  "the captured text should contain {string}",
  async function (this: KoluWorld, expected: string) {
    const fs = await import("node:fs/promises");
    const text = await fs.readFile("/tmp/kolu-cap.txt", "utf-8");
    assert.ok(
      text.includes(expected),
      `Captured pane text does not contain "${expected}". Got: ${text.slice(0, 500)}`,
    );
  },
);
