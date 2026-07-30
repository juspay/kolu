import { dirname } from "node:path";
import Conf from "conf";
import { DEFAULT_PREFERENCES, type Preferences } from "kolu-common/surface";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { store } from "./state.ts";

beforeEach(() => store.set("preferences", DEFAULT_PREFERENCES));
afterEach(() => store.set("preferences", DEFAULT_PREFERENCES));

describe("preference persistence", () => {
  it("round-trips scroll lock and attention alerts through a fresh Conf reader", () => {
    store.set("preferences", {
      ...store.get("preferences"),
      scrollLock: false,
      attentionAlerts: false,
    });

    // A new Conf instance is the server-restart boundary. Reading the same
    // on-disk config proves these are persisted fields, not module memory.
    const restarted = new Conf<{ preferences: Preferences }>({
      cwd: dirname(store.path),
      defaults: { preferences: DEFAULT_PREFERENCES },
    });

    expect(restarted.get("preferences").scrollLock).toBe(false);
    expect(restarted.get("preferences").attentionAlerts).toBe(false);
  });
});
