/** The attention scenarios' waits on a page's dock rows, shared by the
 *  one-page and the two-page steps. */

import type { Page } from "playwright";
import { readPadiDirect } from "./hooks.ts";
import { pollFor } from "./poll.ts";
import { POLL_TIMEOUT } from "./world.ts";

/** Wait until a row matching `rowSelector` in `page` shows padi's verdict
 *  that its agent's turn is over — still, in the post-turn paint
 *  (`linger/none`). padi publishes that verdict only once it has looked, so a
 *  check after this one is about what the page did with padi's word, not a
 *  page that has not heard it yet. `what` names the row in the error. */
export async function waitForFinishedTurn(
  page: Page,
  rowSelector: string,
  what: string,
): Promise<void> {
  await pollFor({
    observe: () =>
      page.evaluate(
        (selector) =>
          [
            ...document.querySelectorAll(
              `${selector} [data-testid="state-pip"]`,
            ),
          ].map(
            (pip) =>
              `${pip.getAttribute("data-pip")}/${pip.getAttribute("data-motion")}`,
          ),
        rowSelector,
      ),
    isDone: (pips) => pips.includes("linger/none"),
    timeoutMs: POLL_TIMEOUT,
    onTimeout: (pips, ms) =>
      new Error(
        `after ${ms}ms ${what} had not shown a finished turn (pips: ${JSON.stringify(pips)})`,
      ),
  });
}

/** What a timed-out unread wait reports, so a red run tells apart padi not
 *  having opened its feed (`settled: false`), a turn that finished with no
 *  mark raised, and a turn that had not finished: padi's own `urgency` read
 *  off its socket, every dock row's agent state, pip, unread mark and active
 *  flag in `page`, whether that page has focus, and this browser's saved
 *  attention record per host (`kolu-attention:<host>` in `localStorage`) —
 *  the page's memory that decides whether a finished, unwatched turn raises a
 *  mark. */
async function attentionDiagnosis(page: Page): Promise<string> {
  const urgency = await readPadiDirect().then(
    ({ urgency }) => JSON.stringify(urgency),
    (err: unknown) => `unreadable: ${(err as Error).message}`,
  );
  const seen = await page.evaluate(() => ({
    hasFocus: document.hasFocus(),
    saved: Object.fromEntries(
      Object.keys(localStorage)
        .filter((key) => key.startsWith("kolu-attention:"))
        .map((key) => [key, localStorage.getItem(key)]),
    ),
    rows: [...document.querySelectorAll('[data-testid="dock-row"]')].map(
      (row) => {
        const pip = row.querySelector('[data-testid="state-pip"]');
        return {
          id: row.getAttribute("data-terminal-id"),
          agent: row.getAttribute("data-agent-state"),
          pip: pip
            ? `${pip.getAttribute("data-pip")}/${pip.getAttribute("data-motion")}`
            : null,
          unread: row.hasAttribute("data-unread"),
          active: row.hasAttribute("data-active"),
        };
      },
    ),
  }));
  return [
    `padi urgency: ${urgency}`,
    `page has focus: ${seen.hasFocus}`,
    `dock rows: ${JSON.stringify(seen.rows)}`,
    `saved attention: ${JSON.stringify(seen.saved)}`,
  ].join("\n");
}

/** Run an unread wait on `page`; when it throws, rethrow its message with the
 *  diagnosis of that page appended. */
export async function withAttentionDiagnosis(
  page: Page,
  wait: () => Promise<unknown>,
): Promise<void> {
  try {
    await wait();
  } catch (err) {
    throw new Error(
      `${(err as Error).message}\n${await attentionDiagnosis(page)}`,
    );
  }
}
