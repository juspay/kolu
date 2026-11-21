/** STEPS FOR A REPLY AND THE MESSAGE IT ANSWERS — where a message sent while
 *  the Conductor is still writing its reply is drawn, and where the rest of
 *  that reply goes. Every step reads the transcript in the order it is DRAWN
 *  (the order of its rows on the page), which is the whole subject: `seq`
 *  puts the message before the rest of the reply, and the page must not. */

import { Then, When } from "@cucumber/cucumber";
import { pollFor } from "../support/poll.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";
import { showChat } from "./conductor_steps.ts";

const TRANSCRIPT = '[data-testid="conductor-transcript"]';
const ROW = `${TRANSCRIPT} [data-testid="conductor-row"]`;
const STOP = '[data-testid="conductor-stop"]';

/** One drawn row: its kind, its words, and the mark a message wears. */
interface Drawn {
  readonly kind: string;
  readonly text: string;
  readonly mark: string | null;
}

/** Every row of the transcript, top to bottom as drawn. */
async function drawnRows(world: KoluWorld): Promise<Drawn[]> {
  await showChat(world);
  return world.page.locator(ROW).evaluateAll((all) =>
    all.map((row) => ({
      kind: row.getAttribute("data-row-kind") ?? "",
      text: (row.textContent ?? "").replace(/\s+/g, " ").trim(),
      mark:
        row
          .querySelector('[data-testid="conductor-user-mark"]')
          ?.getAttribute("data-mark") ?? null,
    })),
  );
}

/** For a failure message: what the transcript held, in drawn order. */
const inventory = (rows: readonly Drawn[] | undefined): string =>
  rows === undefined || rows.length === 0
    ? "(no rows)"
    : rows
        .map(
          (row) =>
            `${row.kind}${row.mark === null ? "" : `(${row.mark})`} ${JSON.stringify(row.text.slice(0, 70))}`,
        )
        .join(" | ");

/** Wait until the drawn rows satisfy `holds`, quoting them on timeout. */
async function untilDrawn(
  world: KoluWorld,
  holds: (rows: readonly Drawn[]) => boolean,
  what: string,
): Promise<void> {
  await pollFor({
    observe: () => drawnRows(world),
    isDone: holds,
    timeoutMs: POLL_TIMEOUT,
    onTimeout: (last, elapsedMs) =>
      new Error(
        `${what} — not after ${elapsedMs}ms; the transcript draws: ${inventory(last)}`,
      ),
  });
}

/** The index of my message saying `text`, or -1. */
const mine = (rows: readonly Drawn[], text: string): number =>
  rows.findIndex((row) => row.kind === "user" && row.text.includes(text));

When("I stop the conductor's turn", async function (this: KoluWorld) {
  const stop = this.page.locator(STOP);
  await stop.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await stop.click();
});

Then(
  "the conductor transcript's last row should be my message {string}, marked {string}",
  async function (this: KoluWorld, text: string, mark: string) {
    await untilDrawn(
      this,
      (rows) => {
        const last = rows.at(-1);
        return (
          last !== undefined &&
          last.kind === "user" &&
          last.text.includes(text) &&
          last.mark === mark
        );
      },
      `my message ${JSON.stringify(text)} is not the last row, marked ${JSON.stringify(mark)}`,
    );
  },
);

Then(
  "the conductor's reply should be one row saying {string}, above my message {string}",
  async function (this: KoluWorld, reply: string, text: string) {
    await untilDrawn(
      this,
      (rows) => {
        const at = rows.findIndex(
          (row) => row.kind === "agent" && row.text.includes(reply),
        );
        return at !== -1 && at < mine(rows, text);
      },
      `no one row says ${JSON.stringify(reply)} above my message ${JSON.stringify(text)}`,
    );
  },
);

Then(
  "the row after my message {string} should be the conductor saying {string}",
  async function (this: KoluWorld, text: string, reply: string) {
    await untilDrawn(
      this,
      (rows) => {
        const at = mine(rows, text);
        const next = at === -1 ? undefined : rows[at + 1];
        return (
          next !== undefined &&
          next.kind === "agent" &&
          next.text.includes(reply)
        );
      },
      `the row after my message ${JSON.stringify(text)} does not say ${JSON.stringify(reply)}`,
    );
  },
);
