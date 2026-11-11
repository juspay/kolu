/** The Orchestrator — step definitions.
 *
 *  Every step drives the real chain: the browser writes through
 *  `orchestrator.prompt` on the KOLU surface, kolu-server's one conversation
 *  writes a `session/prompt` down a pipe to the scripted adapter
 *  (`support/acp-fixture-agent.ts`), and the frames come back the same way.
 *  Nothing here stubs a store, so a step that passes is evidence about the
 *  wire and not about a value somebody put in a signal.
 *
 *  The conversation is reached from its own entry in the chrome tab row — the
 *  `◆ Orchestrator` pill — never from the view-mode control, which carries
 *  `▦ canvas · ▢ maximized` for host tabs and nothing else.
 */

import assert from "node:assert";
import { Given, Then, When } from "@cucumber/cucumber";
import { pollFor } from "../support/poll.ts";
import { type KoluWorld, MOD_KEY, POLL_TIMEOUT } from "../support/world.ts";

const PANE = '[data-testid="orchestrator-pane"]';
/** The conversation's OWN entry in the tab row — not a host tab, and not a
 *  segment of the mode control (which no longer has one). */
const TAB = '[data-testid="orchestrator-tab"]';
const BADGE = `${TAB} [data-testid="orchestrator-badge"]`;
const CHIP = '[data-testid="orchestrator-phase"]';
const TRANSCRIPT = '[data-testid="orchestrator-transcript"]';
const ROW = '[data-testid="orchestrator-row"]';
const TOOL_CARD = '[data-testid="orchestrator-tool-card"]';
const INPUT = '[data-testid="orchestrator-input"]';
const SEND = '[data-testid="orchestrator-send"]';
const ASK = '[data-testid="orchestrator-ask"]';
/** The `⋯` menu button, its portalled panel, and the two-press `New session`
 *  inside it: the button ARMS and the confirm commits. The old one-press
 *  `orchestrator-new-session` is gone — a wipe is not something a stray click
 *  should be able to do. */
const MENU = '[data-testid="orchestrator-menu"]';
const MENU_PANEL = '[data-testid="orchestrator-menu-panel"]';
const MENU_NEW_SESSION = '[data-testid="orchestrator-menu-new-session"]';
const MENU_NEW_SESSION_CONFIRM =
  '[data-testid="orchestrator-menu-new-session-confirm"]';
const USER_MARK = '[data-testid="orchestrator-user-mark"]';
const CHIP_ATTACHMENT = '[data-testid="orchestrator-attachment-chip"]';
const ROW_ATTACHMENT = '[data-testid="orchestrator-row-attachment"]';
const CHROME_BAR = '[data-testid="chrome-bar"]';
/** The REAL host tabs. `host-chip` also matches the hidden measuring twin the
 *  strip keeps for its overflow computation, so every count of "the hosts"
 *  scopes under the visible row. */
const HOST_TAB = '[data-testid="host-chip-row"] [data-testid="host-chip"]';
const CANVAS_TILE = '[data-testid="canvas-tile"]';

/** The mode's own chord, as `input/actions.ts` spells it: `modifier: "app"`,
 *  which is Meta on every platform — `cmdOrCtrl` would resolve to
 *  `Ctrl+Shift+O`, a chord `prohibitedKeybinds.ts` reserves for the agent
 *  running inside a PTY. Typing the reserved form here would pass against a
 *  build that had made exactly that mistake. */
const ORCHESTRATOR_CHORD = "Meta+Shift+O";

/** One waiting shape for every assertion in this file, so a failure says what
 *  was expected, what was actually there, and how long it waited — rather than
 *  Playwright's bare "locator not found". */
async function waitForValue(
  what: string,
  observe: () => Promise<string>,
  want: string,
): Promise<void> {
  await pollFor({
    observe,
    isDone: (seen) => seen === want,
    timeoutMs: POLL_TIMEOUT,
    onTimeout: (last, elapsedMs) =>
      new Error(
        `${what}: expected ${JSON.stringify(want)}, last saw ${JSON.stringify(last)} after ${elapsedMs}ms`,
      ),
  });
}

async function waitForCount(
  world: KoluWorld,
  selector: string,
  want: number,
): Promise<void> {
  await waitForValue(
    `${selector} count`,
    async () => String(await world.page.locator(selector).count()),
    String(want),
  );
}

async function waitForAtLeastOne(
  world: KoluWorld,
  selector: string,
): Promise<void> {
  await pollFor({
    observe: () => world.page.locator(selector).count(),
    isDone: (seen) => seen > 0,
    timeoutMs: POLL_TIMEOUT,
    onTimeout: (_last, elapsedMs) =>
      new Error(`nothing matched ${selector} after ${elapsedMs}ms`),
  });
}

/** IDEMPOTENT, because the selected tab is persisted per device: a reload comes
 *  back in the conversation, and a step that pressed the entry unconditionally
 *  would LEAVE it exactly in the scenario that reloads. */
async function enterOrchestrator(world: KoluWorld): Promise<void> {
  const tab = world.page.locator(TAB);
  await tab.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  if ((await tab.getAttribute("data-active")) === null) await tab.click();
  await world.page
    .locator(PANE)
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
}

async function sendPrompt(world: KoluWorld, text: string): Promise<void> {
  const input = world.page.locator(INPUT);
  await input.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await input.click();
  await input.fill(text);
  await world.page.locator(SEND).click();
}

/** WHAT THE TRANSCRIPT ACTUALLY HOLDS, for a failure message. Row kind, the
 *  mark if it wears one, and how many attachments it carries — the three facts
 *  that tell "no row was minted at all" apart from "a row is there and it
 *  carries nothing". */
async function transcriptInventory(world: KoluWorld): Promise<string> {
  const rows = await world.page.locator(ROW).evaluateAll((all) =>
    all.map((row) => {
      const kind = row.getAttribute("data-row-kind");
      const mark = row.querySelector('[data-testid="orchestrator-user-mark"]');
      const files = row.querySelectorAll(
        '[data-testid="orchestrator-row-attachment"]',
      );
      const text = (row.textContent ?? "").replace(/\s+/g, " ").trim();
      return `${kind}${mark === null ? "" : `(${mark.getAttribute("data-mark")})`}[${files.length} attached] ${JSON.stringify(text.slice(0, 60))}`;
    }),
  );
  return rows.length === 0 ? "(no rows)" : rows.join(" | ");
}

/** Every toast on screen. A prompt refused BEFORE a row exists — an attachment
 *  this agent was never told it could take, a message over the cap — has no row
 *  to land on, and the toast is its only face. So a missing user row is only
 *  half an observation without this. */
async function toastInventory(world: KoluWorld): Promise<string[]> {
  return world.page
    .locator("[data-sonner-toaster] li")
    .evaluateAll((all) =>
      all.map((toast) => (toast.textContent ?? "").replace(/\s+/g, " ").trim()),
    );
}

When("I press the orchestrator shortcut", async function (this: KoluWorld) {
  await this.page.keyboard.press(ORCHESTRATOR_CHORD);
});

When("I enter orchestrator mode", async function (this: KoluWorld) {
  await enterOrchestrator(this);
});

Given(
  "the orchestrator is on a fresh conversation",
  async function (this: KoluWorld) {
    await enterOrchestrator(this);
    await this.page.locator(MENU).click();
    // The panel is PORTALLED, so it is waited for rather than assumed: a click
    // on an arming row that has not mounted yet is a click on nothing, and the
    // confirm below would then time out three lines away from the cause.
    await waitForAtLeastOne(this, MENU_PANEL);
    await this.page.locator(MENU_NEW_SESSION).click();
    await this.page.locator(MENU_NEW_SESSION_CONFIRM).click();
    // A confirmed new session WIPES: the rows go, rather than a `— new
    // session —` divider landing under the old ones. So the arrangement is
    // proved by an EMPTY transcript plus an idle conversation — waiting on
    // what the product does rather than on a timer.
    await waitForCount(this, `${TRANSCRIPT} ${ROW}`, 0);
    await waitForValue(
      "orchestrator phase after a new session",
      async () =>
        (await this.page.locator(PANE).getAttribute("data-phase")) ?? "absent",
      "idle",
    );
  },
);

When(
  "I send the orchestrator the prompt {string}",
  async function (this: KoluWorld, text: string) {
    await sendPrompt(this, text);
  },
);

When(
  "I ask the orchestrator to adopt the terminal",
  async function (this: KoluWorld) {
    // The fixture answers its `lifecycle_create` with the id it was given —
    // qualified by the host, as the fleet grammar requires — so the card names
    // a terminal that really exists in padi's registry and "open tile" lands on
    // a tile that is really there. A made-up id would prove nothing about the
    // join.
    const ids = await this.terminalIds();
    assert.ok(
      ids[0],
      "a terminal must exist before the orchestrator can adopt one",
    );
    this.adoptedTerminalId = ids[0];
    await sendPrompt(this, `adopt ${ids[0]}`);
  },
);

When(
  "I answer the orchestrator's question with {string}",
  async function (this: KoluWorld, value: string) {
    const ask = this.page.locator(ASK).last();
    await ask.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await ask
      .locator(`[data-testid="orchestrator-ask-option"][data-value="${value}"]`)
      .click();
    await ask.locator('[data-testid="orchestrator-ask-submit"]').click();
  },
);

Then(
  "the orchestrator pane should be visible",
  async function (this: KoluWorld) {
    await this.page
      .locator(PANE)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the orchestrator pane should not be visible",
  async function (this: KoluWorld) {
    await this.page
      .locator(PANE)
      .waitFor({ state: "hidden", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the orchestrator pane should fill the workspace",
  async function (this: KoluWorld) {
    // CHAT ONLY, measured rather than asserted by the absence of a testid: the
    // pane spans the full width and runs from the chrome bar to the bottom of
    // the window. A dock column, a fleet list or a peek pane beside it would
    // take width from this box, and this step would say by how much.
    const pane = await this.page.locator(PANE).boundingBox();
    const bar = await this.page.locator(CHROME_BAR).boundingBox();
    const viewport = this.page.viewportSize();
    assert.ok(pane, "the orchestrator pane has no box");
    assert.ok(bar, "the chrome bar has no box");
    assert.ok(viewport, "the page has no viewport size");
    // HOW it is laid out, not only how big it came out: a pane that covers the
    // workspace does it by being taken out of the flow, so a box that came up
    // short says whether it is an overlay that was squeezed or an element that
    // is in the flow beside the canvas — two different bugs with one symptom.
    const laidOut = await this.page.locator(PANE).evaluate((el) => {
      const style = getComputedStyle(el);
      const parent = el.parentElement;
      return `position: ${style.position}, parent ${parent?.className ?? "(none)"} is ${parent === null ? "?" : Math.round(parent.getBoundingClientRect().width)}px wide`;
    });
    // A pixel of slack, because a fractional device-pixel ratio can land a
    // full-bleed box a hair off an integer viewport.
    const near = (a: number, b: number): boolean => Math.abs(a - b) <= 1;
    assert.ok(
      near(pane.width, viewport.width),
      `the orchestrator pane is ${pane.width}px wide in a ${viewport.width}px window — something is beside it (${laidOut})`,
    );
    assert.ok(
      near(pane.y, bar.y + bar.height),
      `the orchestrator pane starts at y=${pane.y}, the chrome bar ends at y=${bar.y + bar.height} (${laidOut})`,
    );
    assert.ok(
      near(pane.y + pane.height, viewport.height),
      `the orchestrator pane ends at y=${pane.y + pane.height} in a ${viewport.height}px window (${laidOut})`,
    );
  },
);

Then("the orchestrator tab should be active", async function (this: KoluWorld) {
  await waitForValue(
    "orchestrator tab active attribute",
    async () =>
      (await this.page.locator(TAB).getAttribute("data-active")) ?? "absent",
    "",
  );
});

When("I note the active host tab", async function (this: KoluWorld) {
  const key = await this.page
    .locator(`${HOST_TAB}[data-active]`)
    .getAttribute("data-host");
  assert.ok(key, "no host tab is active");
  this.notedHostKey = key;
});

Then(
  "the active host tab should be the one I noted",
  async function (this: KoluWorld) {
    const noted = this.notedHostKey;
    assert.ok(noted, "no host tab was noted");
    await waitForValue(
      "active host tab after the round trip",
      async () =>
        (await this.page
          .locator(`${HOST_TAB}[data-active]`)
          .getAttribute("data-host")) ?? "absent",
      noted,
    );
  },
);

Then(
  "no host tab should be the orchestrator",
  async function (this: KoluWorld) {
    // The conversation is NOT a host: it has no host key and no entry in the
    // host map, so it must appear nowhere the UI enumerates hosts — not as a
    // chip in the tab row, not as a row in the switcher the narrow layout
    // mounts, not inside the host strip at all.
    const hosts = await this.page
      .locator(HOST_TAB)
      .evaluateAll((all) =>
        all.map(
          (chip) =>
            `${chip.getAttribute("data-host")}=${(chip.textContent ?? "").replace(/\s+/g, " ").trim()}`,
        ),
      );
    assert.ok(hosts.length > 0, "the host tab row is empty");
    for (const host of hosts) {
      assert.ok(
        !/orchestrator/i.test(host),
        `a host tab is the orchestrator: ${host}`,
      );
    }
    // The entry lives BESIDE the strip, never inside it — the one structural
    // fact a hue or a label change cannot quietly undo.
    assert.equal(
      await this.page
        .locator(`[data-testid="host-selector-strip"] ${TAB}`)
        .count(),
      0,
      "the orchestrator entry is mounted inside the host selector strip",
    );
    for (const prefix of ["host-select", "host-dropdown-switcher"]) {
      const options = await this.page
        .locator(`[data-testid="${prefix}"]`)
        .evaluateAll((all) =>
          all.map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim()),
        );
      for (const option of options) {
        assert.ok(
          !/orchestrator/i.test(option),
          `${prefix} offers the orchestrator as a host: ${option}`,
        );
      }
    }
  },
);

Then(
  "the orchestrator tab should show a badge of {int}",
  async function (this: KoluWorld, count: number) {
    await waitForValue(
      "orchestrator badge",
      async () => (await this.page.locator(BADGE).textContent()) ?? "absent",
      String(count),
    );
  },
);

Then(
  "the orchestrator tab should show no badge",
  async function (this: KoluWorld) {
    // ABSENT, not "0": a badge element that renders an empty count cannot be
    // told from one that renders the wrong one.
    await waitForCount(this, BADGE, 0);
  },
);

Then(
  "the orchestrator transcript should show a row of kind {string} saying {string}",
  async function (this: KoluWorld, kind: string, text: string) {
    // PRESENCE, not a count: a turn can repeat a sentence within one
    // conversation (a retry, a queued prompt answered twice), so a scenario
    // asserting "exactly one agent row ever said this" would be asserting
    // something about the shape of the turn rather than about the answer.
    await waitForAtLeastOne(
      this,
      `${TRANSCRIPT} ${ROW}[data-row-kind="${kind}"]:has-text(${JSON.stringify(text)})`,
    );
  },
);

Then(
  "the orchestrator transcript should show a {string} tool card",
  async function (this: KoluWorld, toolKind: string) {
    await waitForAtLeastOne(this, `${TOOL_CARD}[data-tool-kind="${toolKind}"]`);
  },
);

Then(
  "that tool card should name the terminal {string}",
  async function (this: KoluWorld, name: string) {
    await waitForAtLeastOne(
      this,
      `${TOOL_CARD}:has-text(${JSON.stringify(name)})`,
    );
  },
);

Then(
  "that tool card should name the host {string}",
  async function (this: KoluWorld, host: string) {
    // The card's own host mark, not the card's text: the terminal's name, its
    // cwd and the folded JSON all pass a text match, and the point of this
    // assertion is the column that says WHICH MACHINE.
    await waitForValue(
      "the create card's host mark",
      async () =>
        (
          await this.page
            .locator(`${TOOL_CARD}[data-tool-kind="create"]`)
            .last()
            .locator('[data-testid="orchestrator-tool-host"]')
            .textContent()
        )?.trim() ?? "absent",
      host,
    );
  },
);

Then(
  "that tool card should offer to open its tile",
  async function (this: KoluWorld) {
    await waitForAtLeastOne(
      this,
      `${TOOL_CARD} [data-testid="orchestrator-tool-open-tile"]`,
    );
  },
);

When("I open that tool card's tile", async function (this: KoluWorld) {
  await this.page
    .locator(`${TOOL_CARD}[data-tool-kind="create"]`)
    .last()
    .locator('[data-testid="orchestrator-tool-open-tile"]')
    .click();
});

Then(
  "the adopted terminal should be the focused tile",
  async function (this: KoluWorld) {
    const adopted = this.adoptedTerminalId;
    assert.ok(adopted, "no terminal was adopted in this scenario");
    await waitForValue(
      "the active canvas tile after opening the card's tile",
      async () =>
        (await this.page
          .locator(`${CANVAS_TILE}[data-active]`)
          .getAttribute("data-terminal-id")) ?? "absent",
      adopted,
    );
  },
);

When(
  "I paste an image into the orchestrator composer",
  async function (this: KoluWorld) {
    // Keep what the browser says from here on. A send that is refused before a
    // row exists leaves nothing in the transcript to read, and the console is
    // where the refusal's own sentence turns up — so the assertion downstream
    // can say WHY nothing was minted rather than only that nothing was.
    const said: string[] = [];
    this.orchestratorConsole = said;
    this.page.on("console", (message) => {
      said.push(`${message.type()}: ${message.text()}`);
    });

    const input = this.page.locator(INPUT);
    await input.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await input.click();
    // A REAL clipboard image, written with the page's own permissions, so the
    // paste the composer handles is a browser paste carrying a `File` — the
    // same event a person's ⌘V produces. Only clipboard-write is needed: the
    // paste event hands the data over without a read.
    await this.page.evaluate(async () => {
      const canvas = new OffscreenCanvas(1, 1);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("OffscreenCanvas getContext('2d') unavailable");
      ctx.fillStyle = "red";
      ctx.fillRect(0, 0, 1, 1);
      const blob = await canvas.convertToBlob({ type: "image/png" });
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob }),
      ]);
    });
    await this.page.keyboard.press(`${MOD_KEY}+v`);
  },
);

Then(
  "the orchestrator composer should show a settled attachment chip",
  async function (this: KoluWorld) {
    // SETTLED, not merely present: `data-uploading` comes off only when the
    // bytes are on kolu-server under this attachment's own id. A chip that
    // looks ready with nothing behind it is the failure this waits past.
    await waitForAtLeastOne(this, `${CHIP_ATTACHMENT}:not([data-uploading])`);
  },
);

Then(
  "the orchestrator transcript should show a user row carrying an image attachment",
  async function (this: KoluWorld) {
    const want = `${TRANSCRIPT} ${ROW}[data-row-kind="user"] ${ROW_ATTACHMENT}[data-mime="image/png"]`;
    let rows = "(not observed)";
    // Toasts are ACCUMULATED, not snapshotted. A refusal's toast lives about
    // four seconds and the deadline here is twenty, so the last tick's reading
    // would be an empty screen in exactly the failure this message exists to
    // explain — "no toast" has to mean no toast ever, not none at the end.
    const toasts = new Set<string>();
    await pollFor({
      observe: () => this.page.locator(want).count(),
      isDone: (seen) => seen > 0,
      timeoutMs: POLL_TIMEOUT,
      onTick: async () => {
        rows = await transcriptInventory(this);
        for (const said of await toastInventory(this)) toasts.add(said);
      },
      onTimeout: (_last, elapsedMs) =>
        new Error(
          `no user row carried an image after ${elapsedMs}ms.\n` +
            `  transcript: ${rows}\n` +
            `  toasts: ${toasts.size === 0 ? "(none, ever)" : [...toasts].join(" | ")}\n` +
            `  console: ${(this.orchestratorConsole ?? []).slice(-20).join("\n            ") || "(nothing)"}`,
        ),
    });
  },
);

Then(
  "the orchestrator state chip should read {string}",
  async function (this: KoluWorld, phase: string) {
    await waitForValue(
      "orchestrator state chip",
      async () => (await this.page.locator(CHIP).textContent())?.trim() ?? "",
      phase,
    );
  },
);

Then("the orchestrator should be asking", async function (this: KoluWorld) {
  await waitForValue(
    "orchestrator phase",
    async () =>
      (await this.page.locator(PANE).getAttribute("data-phase")) ?? "absent",
    "asking",
  );
});

Then("the orchestrator should not be asking", async function (this: KoluWorld) {
  await pollFor({
    observe: async () =>
      (await this.page.locator(PANE).getAttribute("data-phase")) ?? "absent",
    isDone: (phase) => phase !== "asking",
    timeoutMs: POLL_TIMEOUT,
    onTimeout: (last, elapsedMs) =>
      new Error(
        `orchestrator phase stayed ${JSON.stringify(last)} after ${elapsedMs}ms`,
      ),
  });
});

Then(
  "the orchestrator transcript should mark a user row {string}",
  async function (this: KoluWorld, mark: string) {
    let inventoryAtTimeout = "(not observed)";
    // On timeout, quote what the transcript ACTUALLY holds — the row kinds and
    // the marks that are there. "No row was marked refused" names a symptom;
    // "the rows are user, notice and nothing is marked" names the cause.
    await pollFor({
      observe: () =>
        this.page.locator(`${USER_MARK}[data-mark="${mark}"]`).count(),
      isDone: (seen) => seen > 0,
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (_last, elapsedMs) =>
        new Error(
          `no user row was marked ${JSON.stringify(mark)} after ${elapsedMs}ms; the transcript holds: ${inventoryAtTimeout}`,
        ),
      onTick: async () => {
        inventoryAtTimeout = await transcriptInventory(this);
      },
    });
  },
);

Then(
  "the orchestrator transcript should mark no user row {string}",
  async function (this: KoluWorld, mark: string) {
    await waitForCount(this, `${USER_MARK}[data-mark="${mark}"]`, 0);
  },
);

Then(
  "the orchestrator roster should show {string} as connected",
  async function (this: KoluWorld, server: string) {
    // THE WHOLE FEATURE IN ONE ASSERTION. The orchestrator's hands are kolu's
    // own MCP server — the FLEET face now, every terminal on every host — and
    // the only way to know the agent actually has hold of them is the agent's
    // own word about it, which arrives at the START OF A TURN, so this must
    // follow one and never a bare bring-up. Before anything has been said the
    // row reads `handed`, which is the honest "kolu gave this over and nobody
    // has reported either way", and an orchestrator that silently fell back to
    // running shell commands itself would sit at exactly that.
    const row = `[data-testid="orchestrator-server"][data-server="${server}"]`;
    await waitForValue(
      `${row} standing`,
      async () =>
        (await this.page.locator(row).getAttribute("data-standing")) ??
        "absent",
      "connected",
    );
  },
);
