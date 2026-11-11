/** The Conductor — step definitions.
 *
 *  Every step drives the real chain: the browser writes through
 *  `conductor.prompt` on the KOLU surface, kolu-server's one conversation
 *  writes a `session/prompt` down a pipe to the scripted adapter
 *  (`support/acp-fixture-agent.ts`), and the frames come back the same way.
 *  Nothing here stubs a store, so a step that passes is evidence about the
 *  wire and not about a value somebody put in a signal.
 *
 *  The conversation is reached from its own entry in the chrome tab row — the
 *  `◆ Conductor` pill — never from the view-mode control, which carries
 *  `▦ canvas · ▢ maximized` for host tabs and nothing else.
 */

import assert from "node:assert";
import { Given, Then, When } from "@cucumber/cucumber";
import { pollFor } from "../support/poll.ts";
import { type KoluWorld, MOD_KEY, POLL_TIMEOUT } from "../support/world.ts";

const PANE = '[data-testid="conductor-pane"]';
/** The conversation's OWN entry in the tab row — not a host tab, and not a
 *  segment of the mode control (which no longer has one). */
const TAB = '[data-testid="conductor-tab"]';
const BADGE = `${TAB} [data-testid="conductor-badge"]`;
const CHIP = '[data-testid="conductor-phase"]';
const TRANSCRIPT = '[data-testid="conductor-transcript"]';
const ROW = '[data-testid="conductor-row"]';
const TOOL_CARD = '[data-testid="conductor-tool-card"]';
const INPUT = '[data-testid="conductor-input"]';
const SEND = '[data-testid="conductor-send"]';
const ASK = '[data-testid="conductor-ask"]';
/** The `⋯` menu button, its portalled panel, and the two-press `New session`
 *  inside it: the button ARMS and the confirm commits. The old one-press
 *  `conductor-new-session` is gone — a wipe is not something a stray click
 *  should be able to do. */
const MENU = '[data-testid="conductor-menu"]';
const MENU_PANEL = '[data-testid="conductor-menu-panel"]';
const MENU_NEW_SESSION = '[data-testid="conductor-menu-new-session"]';
const MENU_NEW_SESSION_CONFIRM =
  '[data-testid="conductor-menu-new-session-confirm"]';
const USER_MARK = '[data-testid="conductor-user-mark"]';
const CHIP_ATTACHMENT = '[data-testid="conductor-attachment-chip"]';
const ROW_ATTACHMENT = '[data-testid="conductor-row-attachment"]';
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
const CONDUCTOR_CHORD = "Meta+Shift+O";

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
async function enterConductor(world: KoluWorld): Promise<void> {
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
      const mark = row.querySelector('[data-testid="conductor-user-mark"]');
      const files = row.querySelectorAll(
        '[data-testid="conductor-row-attachment"]',
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

When("I press the conductor shortcut", async function (this: KoluWorld) {
  await this.page.keyboard.press(CONDUCTOR_CHORD);
});

When("I enter conductor mode", async function (this: KoluWorld) {
  await enterConductor(this);
});

Given(
  "the conductor is on a fresh conversation",
  async function (this: KoluWorld) {
    await enterConductor(this);
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
      "conductor phase after a new session",
      async () =>
        (await this.page.locator(PANE).getAttribute("data-phase")) ?? "absent",
      "idle",
    );
  },
);

When(
  "I send the conductor the prompt {string}",
  async function (this: KoluWorld, text: string) {
    await sendPrompt(this, text);
  },
);

When(
  "I ask the conductor to adopt the terminal",
  async function (this: KoluWorld) {
    // The fixture answers its `lifecycle_create` with the id it was given —
    // qualified by the host, as the fleet grammar requires — so the card names
    // a terminal that really exists in padi's registry and "open tile" lands on
    // a tile that is really there. A made-up id would prove nothing about the
    // join.
    const ids = await this.terminalIds();
    assert.ok(
      ids[0],
      "a terminal must exist before the conductor can adopt one",
    );
    this.adoptedTerminalId = ids[0];
    await sendPrompt(this, `adopt ${ids[0]}`);
  },
);

When(
  "I answer the conductor's question with {string}",
  async function (this: KoluWorld, value: string) {
    const ask = this.page.locator(ASK).last();
    await ask.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await ask
      .locator(`[data-testid="conductor-ask-option"][data-value="${value}"]`)
      .click();
    await ask.locator('[data-testid="conductor-ask-submit"]').click();
  },
);

Then("the conductor pane should be visible", async function (this: KoluWorld) {
  await this.page
    .locator(PANE)
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

Then(
  "the conductor pane should not be visible",
  async function (this: KoluWorld) {
    await this.page
      .locator(PANE)
      .waitFor({ state: "hidden", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the conductor pane should fill the workspace",
  async function (this: KoluWorld) {
    // CHAT ONLY, measured rather than asserted by the absence of a testid: the
    // pane spans the full width and runs from the chrome bar to the bottom of
    // the window. A dock column, a fleet list or a peek pane beside it would
    // take width from this box, and this step would say by how much.
    const pane = await this.page.locator(PANE).boundingBox();
    const bar = await this.page.locator(CHROME_BAR).boundingBox();
    const viewport = this.page.viewportSize();
    assert.ok(pane, "the conductor pane has no box");
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
      `the conductor pane is ${pane.width}px wide in a ${viewport.width}px window — something is beside it (${laidOut})`,
    );
    assert.ok(
      near(pane.y, bar.y + bar.height),
      `the conductor pane starts at y=${pane.y}, the chrome bar ends at y=${bar.y + bar.height} (${laidOut})`,
    );
    assert.ok(
      near(pane.y + pane.height, viewport.height),
      `the conductor pane ends at y=${pane.y + pane.height} in a ${viewport.height}px window (${laidOut})`,
    );
  },
);

Then("the conductor tab should be active", async function (this: KoluWorld) {
  await waitForValue(
    "conductor tab active attribute",
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

Then("no host tab should be the conductor", async function (this: KoluWorld) {
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
    assert.ok(!/conductor/i.test(host), `a host tab is the conductor: ${host}`);
  }
  // The entry lives BESIDE the strip, never inside it — the one structural
  // fact a hue or a label change cannot quietly undo.
  assert.equal(
    await this.page
      .locator(`[data-testid="host-selector-strip"] ${TAB}`)
      .count(),
    0,
    "the conductor entry is mounted inside the host selector strip",
  );
  for (const prefix of ["host-select", "host-dropdown-switcher"]) {
    const options = await this.page
      .locator(`[data-testid="${prefix}"]`)
      .evaluateAll((all) =>
        all.map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim()),
      );
    for (const option of options) {
      assert.ok(
        !/conductor/i.test(option),
        `${prefix} offers the conductor as a host: ${option}`,
      );
    }
  }
});

Then(
  "the conductor tab should show a badge of {int}",
  async function (this: KoluWorld, count: number) {
    await waitForValue(
      "conductor badge",
      async () => (await this.page.locator(BADGE).textContent()) ?? "absent",
      String(count),
    );
  },
);

Then(
  "the conductor tab should show no badge",
  async function (this: KoluWorld) {
    // ABSENT, not "0": a badge element that renders an empty count cannot be
    // told from one that renders the wrong one.
    await waitForCount(this, BADGE, 0);
  },
);

Then(
  "the conductor transcript should show a row of kind {string} saying {string}",
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
  "the conductor transcript should show a {string} tool card",
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
            .locator('[data-testid="conductor-tool-host"]')
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
      `${TOOL_CARD} [data-testid="conductor-tool-open-tile"]`,
    );
  },
);

When("I open that tool card's tile", async function (this: KoluWorld) {
  await this.page
    .locator(`${TOOL_CARD}[data-tool-kind="create"]`)
    .last()
    .locator('[data-testid="conductor-tool-open-tile"]')
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
  "I paste an image into the conductor composer",
  async function (this: KoluWorld) {
    // Keep what the browser says from here on. A send that is refused before a
    // row exists leaves nothing in the transcript to read, and the console is
    // where the refusal's own sentence turns up — so the assertion downstream
    // can say WHY nothing was minted rather than only that nothing was.
    const said: string[] = [];
    this.conductorConsole = said;
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
  "the conductor composer should show a settled attachment chip",
  async function (this: KoluWorld) {
    // SETTLED, not merely present: `data-uploading` comes off only when the
    // bytes are on kolu-server under this attachment's own id. A chip that
    // looks ready with nothing behind it is the failure this waits past.
    await waitForAtLeastOne(this, `${CHIP_ATTACHMENT}:not([data-uploading])`);
  },
);

Then(
  "the conductor transcript should show a user row carrying an image attachment",
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
            `  console: ${(this.conductorConsole ?? []).slice(-20).join("\n            ") || "(nothing)"}`,
        ),
    });
  },
);

Then(
  "the conductor state chip should read {string}",
  async function (this: KoluWorld, phase: string) {
    await waitForValue(
      "conductor state chip",
      async () => (await this.page.locator(CHIP).textContent())?.trim() ?? "",
      phase,
    );
  },
);

Then("the conductor should be asking", async function (this: KoluWorld) {
  await waitForValue(
    "conductor phase",
    async () =>
      (await this.page.locator(PANE).getAttribute("data-phase")) ?? "absent",
    "asking",
  );
});

Then("the conductor should not be asking", async function (this: KoluWorld) {
  await pollFor({
    observe: async () =>
      (await this.page.locator(PANE).getAttribute("data-phase")) ?? "absent",
    isDone: (phase) => phase !== "asking",
    timeoutMs: POLL_TIMEOUT,
    onTimeout: (last, elapsedMs) =>
      new Error(
        `conductor phase stayed ${JSON.stringify(last)} after ${elapsedMs}ms`,
      ),
  });
});

Then(
  "the conductor transcript should mark a user row {string}",
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
  "the conductor transcript should mark no user row {string}",
  async function (this: KoluWorld, mark: string) {
    await waitForCount(this, `${USER_MARK}[data-mark="${mark}"]`, 0);
  },
);

Then(
  "the conductor roster should show {string} as connected",
  async function (this: KoluWorld, server: string) {
    // THE WHOLE FEATURE IN ONE ASSERTION. The conductor's hands are kolu's
    // own MCP server — the FLEET face now, every terminal on every host — and
    // the only way to know the agent actually has hold of them is the agent's
    // own word about it, which arrives at the START OF A TURN, so this must
    // follow one and never a bare bring-up. Before anything has been said the
    // row reads `handed`, which is the honest "kolu gave this over and nobody
    // has reported either way", and a conductor that silently fell back to
    // running shell commands itself would sit at exactly that.
    const row = `[data-testid="conductor-server"][data-server="${server}"]`;
    await waitForValue(
      `${row} standing`,
      async () =>
        (await this.page.locator(row).getAttribute("data-standing")) ??
        "absent",
      "connected",
    );
  },
);

/** The folded body of a generic card — the `<pre>` the minified payload lands
 *  in. It is inside a `<details>`, so it has no layout at all until somebody
 *  opens it: a measurement taken while it is shut measures `display: none`
 *  and would pass against the very bug this file is here to catch. */
const TOOL_DETAIL = '[data-testid="conductor-tool-detail"]';

/** Every box from the payload up to the document, with its own width beside
 *  the width of what is inside it. A box whose `scrollWidth` exceeds its
 *  `clientWidth` is one that failed to contain its content; the FIRST such box
 *  walking up is the link that let the line out, and every box above it is a
 *  consequence. Reported on pass as well as on failure — the numbers are the
 *  evidence, not the verdict. */
async function widthChain(world: KoluWorld): Promise<string> {
  return await world.page
    .locator(TOOL_DETAIL)
    .last()
    .evaluate((el) => {
      const style = getComputedStyle(el);
      const rows: string[] = [
        `payload: ${el.textContent?.length ?? 0} chars, white-space=${style.whiteSpace} overflow-wrap=${style.overflowWrap} overflow-x=${style.overflowX}`,
      ];
      for (
        let node: HTMLElement | null = el;
        node !== null;
        node = node.parentElement
      ) {
        const id = node.dataset.testid ?? node.tagName.toLowerCase();
        rows.push(
          `${id}: client=${node.clientWidth} scroll=${node.scrollWidth} offset=${node.offsetWidth}`,
        );
      }
      return rows.join("\n");
    });
}

When(
  "I open that tool card's folded payload",
  async function (this: KoluWorld) {
    const card = this.page.locator(TOOL_CARD).last();
    await card.locator("summary").last().click();
    await this.page
      .locator(TOOL_DETAIL)
      .last()
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "that tool card should keep the payload inside it",
  async function (this: KoluWorld) {
    const chain = await widthChain(this);
    this.log(`width chain (payload → document):\n${chain}`);
    const box = await this.page
      .locator(TOOL_CARD)
      .last()
      .evaluate((el) => {
        const column = el.parentElement?.parentElement ?? null;
        return {
          client: el.clientWidth,
          scroll: el.scrollWidth,
          offset: el.offsetWidth,
          column: column === null ? -1 : column.clientWidth,
        };
      });
    // A pixel of slack for sub-pixel rounding on a fractional device ratio;
    // the bug this guards is thousands of pixels wide, not one.
    assert.ok(
      box.scroll <= box.client + 1,
      `the card's content is ${box.scroll}px wide inside a ${box.client}px card — the payload escaped it\n${chain}`,
    );
    // AND the card itself did not simply GROW to hold the line: a card as wide
    // as its payload contains it perfectly and still pushes the transcript,
    // the pane and the document — the failure the assertion above cannot see.
    assert.ok(
      box.column > 0 && box.offset <= box.column + 1,
      `the card is ${box.offset}px wide in a ${box.column}px transcript — the payload widened the card itself\n${chain}`,
    );
  },
);

Then(
  "that tool card's payload should be readable without scrolling sideways",
  async function (this: KoluWorld) {
    // CONTAINED IS NOT ENOUGH. A block with `overflow-x: auto` holds a 5 KB
    // unbroken line perfectly — 25 000 px of it, reachable only by dragging a
    // scrollbar inside a 970 px card — and a block with `overflow: hidden`
    // simply CUTS it, which loses what the agent read. Both pass the
    // containment assertions above and neither is a readable payload, so this
    // pins the third thing: the line WRAPPED, so every character is on screen.
    const blocks = await this.page
      .locator(`${TOOL_CARD} pre`)
      .evaluateAll((all) =>
        all.map((el) => ({
          id: (el as HTMLElement).dataset.testid ?? "progress",
          client: el.clientWidth,
          scroll: el.scrollWidth,
        })),
      );
    assert.ok(blocks.length > 0, "the card has no payload block at all");
    for (const block of blocks) {
      assert.ok(
        block.scroll <= block.client + 1,
        `${block.id} is ${block.scroll}px wide inside a ${block.client}px block — it did not wrap, so it is readable only by scrolling the block sideways (or, with a hidden overflow, not at all)`,
      );
    }
  },
);

/** WHAT IS STICKING OUT, by name. A document that scrolls sideways says only
 *  that something does; the fix needs the element, so this walks every box and
 *  reports the ones whose right edge is past the window — innermost first,
 *  which is where the line actually escaped. */
async function pastTheWindow(world: KoluWorld): Promise<string> {
  return await world.page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      const right = el.getBoundingClientRect().right;
      if (right <= width + 1) continue;
      const id = el.dataset.testid ?? el.tagName.toLowerCase();
      out.push(
        `${id} (${(el.getAttribute("class") ?? "").slice(0, 80)}): right=${Math.round(right)} offset=${el.offsetWidth}`,
      );
    }
    return out.length === 0
      ? "(nothing)"
      : out.reverse().slice(0, 12).join("\n");
  });
}

Then(
  "the page should be no wider than the window",
  async function (this: KoluWorld) {
    const doc = await this.page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    this.log(`past the window (${doc.scroll} vs ${doc.client})`);
    assert.equal(
      doc.scroll,
      doc.client,
      `the document scrolls to ${doc.scroll}px in a ${doc.client}px window — something inside the pane is pushing it wider\n${await pastTheWindow(this)}\n${await widthChain(this)}`,
    );
  },
);

/** THE CHROME BAR'S OWN ARITHMETIC, measured. The row is a flex line whose
 *  only shrinkable member is the host strip; everything else — the identity
 *  rail, the `◆ Conductor beta` pill, the control cluster — is `shrink-0`. So
 *  two facts matter and this step pins both: the row FITS the window, and the
 *  strip's own measured width (the budget `computeVisibleHosts` folds tabs
 *  against) is exactly what is LEFT once the others have taken theirs. The
 *  second is the premise the fold rests on — a conductor entry that stopped
 *  being counted would make the strip claim room it does not have and the
 *  tabs would collide with the pill instead of folding. */
Then("the chrome bar should fit the window", async function (this: KoluWorld) {
  const bar = await this.page.locator(CHROME_BAR).evaluate((el) => {
    const style = getComputedStyle(el);
    const kids = [...el.children].map((child) => child as HTMLElement);
    return {
      client: el.clientWidth,
      scroll: el.scrollWidth,
      // The row's own geometry, read off the element rather than copied
      // from the markup: padding and the flex gap are what separate the
      // members, and a step that assumed them would pass through a restyle.
      chrome:
        Number.parseFloat(style.paddingLeft) +
        Number.parseFloat(style.paddingRight) +
        Number.parseFloat(style.columnGap) * (kids.length - 1),
      parts: kids.map((kid) => ({
        id:
          kid.dataset.testid ??
          (kid.querySelector("[data-testid]") as HTMLElement | null)?.dataset
            .testid ??
          kid.tagName.toLowerCase(),
        width: kid.getBoundingClientRect().width,
      })),
    };
  });
  const seated = bar.parts.reduce((sum, part) => sum + part.width, 0);
  const report = `chrome bar: client=${bar.client} scroll=${bar.scroll} chrome=${bar.chrome} parts=${bar.parts
    .map((part) => `${part.id}=${Math.round(part.width)}`)
    .join(" ")}`;
  // A host tab's own rendered width, logged beside the budget: it is the
  // number the fold arithmetic is fed, and the one a unit test asserting the
  // five-host fold has to use if it is to mean anything.
  const chip = await this.page
    .locator(HOST_TAB)
    .first()
    .evaluate((el) => Math.round(el.getBoundingClientRect().width))
    .catch(() => -1);
  this.log(`${report} chip=${chip}`);
  assert.ok(
    bar.scroll <= bar.client + 1,
    `the chrome bar's content is ${bar.scroll}px wide in a ${bar.client}px row — ${report}`,
  );
  assert.ok(
    Math.abs(seated + bar.chrome - bar.client) <= 1,
    `the chrome bar's members and its own padding come to ${Math.round(seated + bar.chrome)}px in a ${bar.client}px row — the host strip's budget is not the row's leftover, so the tab fold is computing against room something else is using\n${report}`,
  );
});

/** The terminal's own pill, reused by the conversation: "you are not
 *  following, here is the way back". Scoped under the pane — the same testid
 *  belongs to the scrollback's copy on a host tab. */
const TO_BOTTOM = `${PANE} [data-testid="scroll-to-bottom"]`;

/** The client's own `FOLLOW_SLACK_PX`, which is the number the rule under test
 *  uses. A transcript within a couple of lines of the end IS following; the
 *  failure this file is about leaves it hundreds of pixels short. */
const FOLLOW_SLACK_PX = 48;

/** How far the transcript's last pixel is below the bottom of its view. Zero
 *  (or a line or two) means it is following the conversation. */
async function transcriptGap(world: KoluWorld): Promise<number> {
  return await world.page
    .locator(TRANSCRIPT)
    .evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
}

Then(
  "the conductor transcript should be scrolled to the bottom",
  async function (this: KoluWorld) {
    await pollFor({
      observe: () => transcriptGap(this),
      isDone: (gap) => gap <= FOLLOW_SLACK_PX + 1,
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (last, elapsedMs) =>
        new Error(
          `the transcript is ${last}px below its view after ${elapsedMs}ms — it stopped following the conversation, so the agent is talking off the bottom of the pane`,
        ),
    });
  },
);

When(
  "I scroll the conductor transcript up",
  async function (this: KoluWorld) {
    const box = await this.page.locator(TRANSCRIPT).boundingBox();
    assert.ok(box !== null, "the transcript has no box to scroll over");
    // A REAL WHEEL over the column, not an assignment to `scrollTop`: the
    // client reads the notch itself (to decide intent before the browser has
    // moved anything), and a scripted scroll would skip that half.
    await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await this.page.mouse.wheel(0, -600);
    // Chromium animates the notch, so the view has not arrived when `wheel`
    // resolves. Wait for it to be demonstrably off the end before anything
    // asserts about where it stays.
    await pollFor({
      observe: () => transcriptGap(this),
      isDone: (gap) => gap > FOLLOW_SLACK_PX + 1,
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (last, elapsedMs) =>
        new Error(
          `the wheel left the transcript ${last}px from its end after ${elapsedMs}ms — it never scrolled up`,
        ),
    });
  },
);

Then(
  "the conductor transcript should stay where the reader left it",
  async function (this: KoluWorld) {
    const top = async () =>
      await this.page.locator(TRANSCRIPT).evaluate((el) => el.scrollTop);
    const before = await top();
    const settled = Promise.withResolvers<void>();
    setTimeout(settled.resolve, 750);
    await settled.promise;
    const after = await top();
    assert.equal(
      after,
      before,
      `the transcript moved from ${before} to ${after} on its own — a reader who scrolled up to read something was dragged back`,
    );
  },
);

Then(
  "the conductor should offer the way back to the bottom",
  async function (this: KoluWorld) {
    await this.page
      .locator(TO_BOTTOM)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the conductor should not offer the way back to the bottom",
  async function (this: KoluWorld) {
    await waitForCount(this, TO_BOTTOM, 0);
  },
);

When(
  "I take the way back to the bottom",
  async function (this: KoluWorld) {
    await this.page.locator(TO_BOTTOM).click();
  },
);
