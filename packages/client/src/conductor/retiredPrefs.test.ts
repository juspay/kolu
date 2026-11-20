import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listGuardSourceFiles } from "../architectureGuardSources.testlib";

const SRC = join(import.meta.dirname, "..");

const RETIRED_KEYS = [
  "kolu-conductor-pane-width",
  "kolu-conductor-mode",
] as const;

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
