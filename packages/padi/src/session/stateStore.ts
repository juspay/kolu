/**
 * padi's OWN persistent store — the `Conf` under padi's state-root that backs the
 * `session`, `activityFeed`, and `lastPairedDaemon` cells. Until W2.2 these three
 * were kolu-server's `Conf` keys, INJECTED into padi (`confStores.ts`); now the
 * padi PROCESS owns them, on the host, keyed by its state-root identity.
 *
 * padi does NOT import `packages/server/src/state.ts` (the dependency arrow points
 * OUT) — it builds its own `Conf`, a small twin of the server's, holding only the
 * three keys padi owns. **`preferences` stays kolu-server's** (a koluSurface cell,
 * user-scoped, not padi's); it never moves here.
 *
 * No migration ladder: kolu-server ran its own ladder at boot, so the one-shot
 * import (W2.2 stage 2) hands padi a current-schema blob; a fresh padi starts from
 * the defaults below. (Owning the session/activityFeed migrations here is a
 * follow-up once the import stops being the only writer.)
 */

import Conf from "conf";
import { confStore } from "@kolu/surface/server";
import type { CellStore } from "@kolu/surface/server";
import type { PairedDaemon } from "./pairedDaemon.ts";
import type { ActivityFeed, SavedSession } from "../vocab.ts";

/** padi's on-disk shape — the three keys padi owns under its state-root, plus the
 *  one-shot import marker. */
interface PadiPersistedState {
  session: SavedSession | null;
  activityFeed: ActivityFeed;
  lastPairedDaemon: PairedDaemon | null;
  /** Set true once the legacy kolu-config import has run (exactly-once guard). An
   *  internal flag, never a served cell. */
  importedLegacyConfig: boolean;
}

/** padi's state schema version — bump when padi grows its own migration ladder. */
export const PADI_STATE_SCHEMA_VERSION = "1.0.0";

/** The three `CellStore`s padi injects at boot, plus the underlying `Conf` (which
 *  the one-shot import writes into raw). */
export interface PadiStateStores {
  session: CellStore<SavedSession | null>;
  activityFeed: CellStore<ActivityFeed>;
  lastPairedDaemon: CellStore<PairedDaemon | null>;
  /** The raw store — the state-root Conf, exposed so the one-shot import can seed
   *  keys directly (and so a boot can inspect emptiness before importing). */
  conf: PadiConf;
}

/** The padi state-root `Conf` type — narrowed to the read/write surface the
 *  one-shot import needs (import stays decoupled from the full `Conf` API). */
export type PadiConf = Conf<PadiPersistedState>;

/** Open padi's state-root `Conf` (`<stateRoot>/config.json`) and return the three
 *  cell stores it backs. The stores are `confStore` adapters over the one `Conf`,
 *  exactly as kolu-server built them — so the cells behave byte-identically, only
 *  the file moved. */
export function openPadiStateStores(stateRoot: string): PadiStateStores {
  const conf = new Conf<PadiPersistedState>({
    cwd: stateRoot,
    projectVersion: PADI_STATE_SCHEMA_VERSION,
    defaults: {
      session: null,
      activityFeed: { recentRepos: [], recentAgents: [] },
      lastPairedDaemon: null,
      importedLegacyConfig: false,
    },
  });
  return {
    session: confStore<SavedSession | null>(conf, "session"),
    activityFeed: confStore<ActivityFeed>(conf, "activityFeed"),
    lastPairedDaemon: confStore<PairedDaemon | null>(conf, "lastPairedDaemon"),
    conf,
  };
}
