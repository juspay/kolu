/**
 * A WORK'S DETAILS, end to end: the worktree the work keeps on its own record
 * outliving its terminal, the Worktree part saying which folder and branch, and
 * a work's row keeping its title readable beside the sidebar at any width.
 */

import assert from "node:assert";
import * as path from "node:path";
import { When, Then } from "@cucumber/cucumber";
import { Effect } from "effect";
import { connectPtyHost } from "kaval-tui/src/connect.ts";
import { kavalSocketPath } from "../support/hooks.ts";
import { pollFor } from "../support/poll.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";
import { pickToRead, workCard, workRepo } from "./conductor_steps.ts";

const COLUMN = '[data-testid="work-column"]';

/** THE IMPLEMENTOR'S TERMINAL GOES AWAY — its PTY killed where it lives, in
 *  kaval, as a crash or a closed window would end it. Nothing in kolu is
 *  told first: the work learns it the way it learns of any terminal ending. */
When("the implementor's terminal goes away", async function (this: KoluWorld) {
  const id = this.memberTerminalId;
  assert.ok(id, "no implementor terminal was started in this scenario");
  // One dial, one kill, the dial closed with the scope.
  await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(connectPtyHost(kavalSocketPath()), (conn) =>
        conn.client.surface.terminal.kill({ id }),
      ),
    ),
  );
});

/** NOTHING RUNNING IN IT, said on the work's details — and the work still
 *  open. */
Then("the work should have no terminals", async function (this: KoluWorld) {
  const putBack = await pickToRead(this);
  await workCard(this)
    .locator('[data-testid="work-no-terminals"]')
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await putBack();
});

/** THE WORKTREE PART, once for the work: the folder it keeps on its record —
 *  the scenario's repository — and a branch beside it. The same answer with a
 *  terminal up and with none: the folder is the work's, not a terminal's. */
Then(
  "the work's worktree part should show the work's folder and its branch",
  async function (this: KoluWorld) {
    const folder = path.basename(workRepo(this));
    const putBack = await pickToRead(this);
    const part = workCard(this).locator('[data-testid="work-worktree"]');
    const read = async () => ({
      directory:
        (await part
          .locator('[data-testid="inspector-directory"]')
          .textContent({ timeout: 500 })
          .catch(() => null)) ?? "",
      branch:
        (await part
          .locator('[data-testid="inspector-branch"]')
          .textContent({ timeout: 500 })
          .catch(() => null)) ?? "",
    });
    await pollFor({
      observe: read,
      isDone: (seen) =>
        seen.directory.trim().endsWith(folder) && seen.branch.trim() !== "",
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (last, ms) =>
        new Error(
          `the worktree part never showed the folder ${JSON.stringify(folder)} with a branch after ${ms}ms; it shows ${JSON.stringify(last)}`,
        ),
    });
    await putBack();
  },
);

/** THE SIDEBAR AT ITS WIDEST — its stored width set past its bound, then the
 *  page reloaded, so the sidebar clamps it to the widest it may be beside the
 *  works. The same memory a drag of its edge writes. */
When("the works sidebar is at its widest", async function (this: KoluWorld) {
  await this.page.evaluate(() =>
    localStorage.setItem("kolu-conductor-sidebar-width", "10000"),
  );
  await this.page.reload();
  await this.waitForReady();
});

/** A WORK'S ROW FITS ITS COLUMN: nothing of the card runs past the works
 *  column's right edge, and its title has room to be read — at least the
 *  first dozen or so characters, or the whole of a shorter one. */
Then(
  "every work's row should fit its column, with room for its title",
  async function (this: KoluWorld) {
    const measure = () =>
      this.page.evaluate((column) => {
        const host = document.querySelector(column);
        if (host === null) return ["no works column"];
        const right = host.getBoundingClientRect().right;
        const cards = host.querySelectorAll<HTMLElement>(
          '[data-testid="works-board"] [data-testid="work-card"]',
        );
        if (cards.length === 0) return ["no work on the board"];
        const wrong: string[] = [];
        for (const card of cards) {
          const box = card.getBoundingClientRect();
          if (box.right > right + 0.5)
            wrong.push(`a card runs ${box.right - right}px past the column`);
          if (card.scrollWidth > card.clientWidth + 1)
            wrong.push(
              `a card's content is ${card.scrollWidth}px in a ${card.clientWidth}px box`,
            );
          const title = card.querySelector<HTMLElement>(
            '[data-testid="work-card-title"]',
          );
          if (title === null) {
            wrong.push("a card has no title");
            continue;
          }
          const wants = Math.min(title.scrollWidth, 120);
          if (title.clientWidth < wants)
            wrong.push(
              `"${title.textContent}" has ${title.clientWidth}px for a title that wants ${wants}px`,
            );
        }
        return wrong;
      }, COLUMN);
    await pollFor({
      observe: measure,
      isDone: (wrong) => wrong.length === 0,
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (last) =>
        new Error(`a work's row does not fit: ${(last ?? []).join("; ")}`),
    });
  },
);
