import {
  decodeHostKey,
  encodeHostKey,
  type HostKey,
  LOCAL_HOST,
} from "kolu-common/hostKey";
import { describe, expect, it } from "vitest";
import { persistedPref } from "../persistedPref.ts";
import { activeHostStorage } from "./activeHostStorage.ts";

const zest: HostKey = { kind: "remote", target: "zest" };

/** A minimal synchronous in-memory `Storage` — enough for `makePersisted` to read
 *  and write, mirroring persistedPref.test.ts's fake. */
function fakeStorage(seed?: Record<string, string>): Storage {
  const m = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => {
      m.delete(k);
    },
    setItem: (k, v) => {
      m.set(k, v);
    },
  };
}

/** `activeHostStorage` — the storage-backend decision: an installed launch context → the
 *  survive-relaunch backend (localStorage), a regular tab → per-tab (sessionStorage). We
 *  pin only that mapping, over the install verdict as a boolean. Whether a given launch IS
 *  installed (display-mode / iOS `navigator.standalone`) is surface-app's
 *  `isInstalledFromEnv`, tested in its own `install.test.ts`; we do not re-test it here. */
describe("activeHostStorage — pick the backend from the launch context", () => {
  const local = fakeStorage();
  const session = fakeStorage();

  it("installed selects localStorage (survives relaunch)", () => {
    expect(activeHostStorage(true, { local, session })).toBe(local);
  });

  it("regular tab context selects sessionStorage (per-tab isolation)", () => {
    expect(activeHostStorage(false, { local, session })).toBe(session);
  });
});

/** The whole point: in a standalone relaunch — a FRESH (empty) sessionStorage but a
 *  populated localStorage — the active-host pref must boot on the REMEMBERED host, not
 *  silently revert to LOCAL_HOST. This wires the real `persistedPref` over the backend
 *  `activeHostStorage` chooses, exactly as wire.ts does. */
describe("active-host pref survives a standalone relaunch", () => {
  it("installed boot with empty sessionStorage + remembered localStorage → remembered host", () => {
    // A prior standalone session left the encoded remote host in localStorage; the
    // relaunch handed the window a brand-new, empty sessionStorage.
    const local = fakeStorage({ "kolu-active-host": encodeHostKey(zest) });
    const session = fakeStorage();
    const storage = activeHostStorage(true, { local, session });

    const [activeHost] = persistedPref<HostKey>({
      name: "kolu-active-host",
      fallback: LOCAL_HOST,
      parse: (raw) => decodeHostKey(raw),
      serialize: encodeHostKey,
      storage,
    });

    // Booted on the remembered host — NOT the LOCAL_HOST fallback (the amnesia bug).
    expect(activeHost()).toEqual(zest);
  });

  it("regular-tab boot ignores localStorage and starts from the per-tab default", () => {
    // Same populated localStorage, but a plain tab reads the (empty) sessionStorage and
    // so starts at the local default — per-tab isolation is unchanged.
    const local = fakeStorage({ "kolu-active-host": encodeHostKey(zest) });
    const session = fakeStorage();
    const storage = activeHostStorage(false, { local, session });

    const [activeHost] = persistedPref<HostKey>({
      name: "kolu-active-host",
      fallback: LOCAL_HOST,
      parse: (raw) => decodeHostKey(raw),
      serialize: encodeHostKey,
      storage,
    });

    expect(activeHost()).toEqual(LOCAL_HOST);
  });
});
