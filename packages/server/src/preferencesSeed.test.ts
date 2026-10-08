/**
 * `--preferences-seed` — the seed FILE's reader/checks (`preferencesSeed.ts`) and
 * the store's "initial means initial" rule (`state.ts`'s `applyPreferencesSeed`).
 *
 * The seed is a preferences PATCH, so the loader must accept every key the wire
 * accepts and refuse — naming the file — everything else: bad JSON, an unknown
 * key, a wrong value type, a profile this build does not ship. The store half is
 * driven against a REAL `Conf` under an ephemeral `KOLU_STATE_DIR`.
 *
 * The store cases import `./state.ts` DYNAMICALLY, on purpose: the store is
 * constructed once at module load (reading `KOLU_STATE_DIR` then), and each case
 * needs that construction re-run against its own temp dir — a boundary a static
 * import cannot cross. `vi.resetModules()` drops the cached instance first.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentDistroListing } from "@kolu/agent-distro/listing";
import { DEFAULT_PREFERENCES } from "kolu-common/surface";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertSeededAgentProfile,
  loadPreferencesSeed,
} from "./preferencesSeed.ts";

const dirs: string[] = [];
const originalStateDir = process.env.KOLU_STATE_DIR;

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
  if (originalStateDir === undefined) delete process.env.KOLU_STATE_DIR;
  else process.env.KOLU_STATE_DIR = originalStateDir;
});

/** A fresh temp dir, tracked for cleanup. */
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** A seed file holding exactly `text`, tracked for cleanup. */
function seedFile(text: string): string {
  const path = join(tempDir("kolu-seed-file-"), "prefs.json");
  writeFileSync(path, text);
  return path;
}

/** The build's listing, as a real one arrives: two shipped profiles. */
const LISTING: AgentDistroListing = {
  kind: "available",
  profiles: [
    { name: "vanilla", description: "stock agents", harnesses: [] },
    { name: "juspay", description: "Juspay's agents", harnesses: [] },
  ],
};

describe("loadPreferencesSeed — the seed file's reader", () => {
  it("loads every key a preferences patch accepts, `seenTips` and `rightPanel` included", () => {
    const path = seedFile(
      JSON.stringify({
        colorScheme: "light",
        seenTips: ["dock-drag"],
        rightPanel: { size: 0.4 },
        agentDistro: { enabled: true, profile: "juspay" },
      }),
    );
    expect(loadPreferencesSeed(path)).toEqual({
      colorScheme: "light",
      seenTips: ["dock-drag"],
      rightPanel: { size: 0.4 },
      agentDistro: { enabled: true, profile: "juspay" },
    });
  });

  it("refuses invalid JSON, naming the file", () => {
    const path = seedFile("{ not json");
    expect(() => loadPreferencesSeed(path)).toThrow(
      new RegExp(`preferences-seed ${path}: not valid JSON`),
    );
  });

  it("refuses an unknown key, naming the file — never silently dropping it", () => {
    const path = seedFile(JSON.stringify({ colourScheme: "light" }));
    expect(() => loadPreferencesSeed(path)).toThrow(
      new RegExp(`preferences-seed ${path}:`),
    );
  });

  it("refuses a wrong value type, naming the file", () => {
    const path = seedFile(JSON.stringify({ colorScheme: "blue" }));
    expect(() => loadPreferencesSeed(path)).toThrow(
      new RegExp(`preferences-seed ${path}:`),
    );
  });

  it("refuses a missing file, naming the file", () => {
    const path = join(tempDir("kolu-seed-absent-"), "prefs.json");
    expect(() => loadPreferencesSeed(path)).toThrow(
      new RegExp(`preferences-seed ${path}: cannot read the file`),
    );
  });
});

describe("assertSeededAgentProfile — a seeded profile must be one this build ships", () => {
  it("passes a profile the listing ships", () => {
    expect(() =>
      assertSeededAgentProfile(
        "/seed.json",
        { agentDistro: { enabled: true, profile: "juspay" } },
        LISTING,
      ),
    ).not.toThrow();
  });

  it("passes a patch that names no agents at all", () => {
    expect(() =>
      assertSeededAgentProfile("/seed.json", { colorScheme: "light" }, LISTING),
    ).not.toThrow();
  });

  it("refuses a profile this kolu does not ship, naming the file and the profiles it does", () => {
    expect(() =>
      assertSeededAgentProfile(
        "/seed.json",
        { agentDistro: { enabled: true, profile: "juspayy" } },
        LISTING,
      ),
    ).toThrow(/juspayy.*vanilla, juspay/s);
  });

  it("skips the check in a build with no baked listing — there is nothing to check against", () => {
    expect(() =>
      assertSeededAgentProfile(
        "/seed.json",
        { agentDistro: { enabled: true, profile: "anything" } },
        { kind: "unavailable" },
      ),
    ).not.toThrow();
  });
});

describe("applyPreferencesSeed — the seed applies only while the store is unwritten", () => {
  /** Re-import `state.ts` so its module-init `Conf` construction runs against the
   *  `KOLU_STATE_DIR` the caller just set. Dynamic, not a static import: the store
   *  is built once at module load, and every case needs its own instance over its
   *  own temp dir — a boundary a static import cannot cross. */
  async function freshState() {
    vi.resetModules();
    return await import("./state.ts");
  }

  it("seeds a fresh store, and the seeded value is what lands on disk", async () => {
    const dir = tempDir("kolu-seed-fresh-");
    process.env.KOLU_STATE_DIR = dir;
    const { applyPreferencesSeed, store } = await freshState();

    applyPreferencesSeed({
      colorScheme: "light",
      seenTips: ["dock-drag"],
      rightPanel: { size: 0.4 },
      agentDistro: { enabled: true, profile: "juspay" },
    });

    const preferences = store.get("preferences");
    expect(preferences.colorScheme).toBe("light");
    expect(preferences.seenTips).toEqual(["dock-drag"]);
    // `rightPanel` is deep-merged onto the defaults, not replaced whole.
    expect(preferences.rightPanel).toEqual({
      size: 0.4,
      codeTabTreeSize: DEFAULT_PREFERENCES.rightPanel.codeTabTreeSize,
    });
    expect(preferences.agentDistro).toEqual({
      enabled: true,
      profile: "juspay",
    });
    // On disk, so the next boot reads it as a written preference.
    const onDisk = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
    expect(onDisk.preferences.colorScheme).toBe("light");
  });

  it("ignores the seed once `preferences` was written — the user's value wins", async () => {
    const dir = tempDir("kolu-seed-written-");
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        preferences: { ...DEFAULT_PREFERENCES, colorScheme: "light" },
        hosts: [],
        viewerMode: "dark",
      }),
    );
    process.env.KOLU_STATE_DIR = dir;
    const { applyPreferencesSeed, store } = await freshState();

    applyPreferencesSeed({ colorScheme: "dark" });

    expect(store.get("preferences").colorScheme).toBe("light");
  });

  it("ignores the seed on a later boot, after an earlier seed was written", async () => {
    const dir = tempDir("kolu-seed-second-boot-");
    process.env.KOLU_STATE_DIR = dir;

    const first = await freshState();
    first.applyPreferencesSeed({ colorScheme: "light" });

    // A restart: a NEW module instance over the same state dir.
    const second = await freshState();
    second.applyPreferencesSeed({ colorScheme: "dark" });

    expect(second.store.get("preferences").colorScheme).toBe("light");
  });
});
