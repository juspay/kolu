/** What a timed-out unread wait reports, so a red run tells apart padi not
 *  having opened its feed (`settled: false`), a turn that finished with no
 *  mark raised, and a turn that had not finished: padi's own `urgency` read
 *  off its socket, every dock row's agent state, pip, unread mark and active
 *  flag in `page`, whether that page has focus, and this browser's saved
 *  attention record per host (`kolu-attention:<host>` in `localStorage`) —
 *  the page's memory that decides whether a finished, unwatched turn raises a
 *  mark. */

import type { Page } from "playwright";
import { readPadiDirect } from "./hooks.ts";

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
