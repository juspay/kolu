/**
 * The prefs the chat-only conductor left behind, and the law that keeps
 * them gone.
 *
 * The conversation used to be a column beside a live terminal: a peek pane, a
 * fleet list, and a grip between them whose width was persisted
 * (`kolu-conductor-pane-width`), with the mode itself a device-global
 * boolean (`kolu-conductor-mode`). The view is the chat and nothing else
 * now, and the selection rides the tab row's own value
 * (`kolu-active-chrome-tab`), so both keys are dead.
 *
 * A dead persisted key is not harmless: it is a value a browser still holds
 * and a reader can still be written against, which is how a deleted feature
 * comes back as half of one. A grep law is the cheapest way to say "this key
 * has no home any more" in a way that fails if somebody gives it one — the
 * same shape as `DocLink.test.ts`'s ban on hand-rolled doc URLs.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listGuardSourceFiles } from "../architectureGuardSources.testlib";

const SRC = join(import.meta.dirname, "..");

/** Every persisted key this round retired. */
const RETIRED_KEYS = [
  "kolu-conductor-pane-width",
  "kolu-conductor-mode",
] as const;

/** The modules the chat-only cutover deleted — named here so a re-import is a
 *  failing test rather than a quiet resurrection of the peek. */
const RETIRED_MODULES = [
  "conductorPaneWidth",
  "ConductorPeekHeader",
  "ConductorFleet",
  "fleetRows",
] as const;

describe("the retired conductor prefs", () => {
  it("name no key the client still reads or writes", () => {
    const offenders: string[] = [];
    for (const file of listGuardSourceFiles(SRC)) {
      const text = readFileSync(file, "utf8");
      for (const key of RETIRED_KEYS) {
        if (text.includes(key)) offenders.push(`${file}: ${key}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("leave no module behind for a reader to import", () => {
    const offenders: string[] = [];
    for (const file of listGuardSourceFiles(SRC)) {
      const text = readFileSync(file, "utf8");
      for (const mod of RETIRED_MODULES) {
        if (text.includes(`from "./${mod}"`) || text.includes(`/${mod}"`)) {
          offenders.push(`${file}: ${mod}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
