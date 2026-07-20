import {
  decodeHostKey,
  encodeHostKey,
  type HostKey,
  LOCAL_HOST,
} from "kolu-common/hostKey";
import { describe, expect, it } from "vitest";
import { persistedPref } from "../persistedPref.ts";
import {
  activeHostStorage,
  launchedStandalone,
  type StandaloneSignals,
} from "./activeHostStorage.ts";

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

/** Build the window slice `launchedStandalone` reads from two injected booleans —
 *  the standard `display-mode: standalone` media query and the legacy iOS
 *  `navigator.standalone` — so a unit pins the launch context without a real PWA. */
function fakeWindow(opts: {
  displayModeStandalone?: boolean;
  iosStandalone?: boolean;
}): StandaloneSignals {
  return {
    matchMedia: (query) => ({
      matches:
        query === "(display-mode: standalone)" &&
        opts.displayModeStandalone === true,
    }),
    navigator: { standalone: opts.iosStandalone },
  };
}

/** `launchedStandalone` — the pure detector: is THIS window an installed / standalone
 *  surface (whose relaunch is the same "session" to the user) or a plain browser tab? */
describe("launchedStandalone — the launch-context detector", () => {
  it("standalone display-mode → true (Chromium / Android / desktop PWA)", () => {
    expect(
      launchedStandalone(fakeWindow({ displayModeStandalone: true })),
    ).toBe(true);
  });

  it("legacy iOS navigator.standalone → true (Safari home-screen web app)", () => {
    // iOS Safari never adopted the display-mode media query for home-screen apps;
    // it exposes the non-standard `navigator.standalone` instead. Honor both.
    expect(launchedStandalone(fakeWindow({ iosStandalone: true }))).toBe(true);
  });

  it("plain browser tab (neither signal) → false", () => {
    expect(launchedStandalone(fakeWindow({}))).toBe(false);
    expect(
      launchedStandalone(
        fakeWindow({ displayModeStandalone: false, iosStandalone: false }),
      ),
    ).toBe(false);
  });
});

/** `activeHostStorage` — the storage-backend decision: standalone context → the
 *  survive-relaunch backend (localStorage), tab context → per-tab (sessionStorage). */
describe("activeHostStorage — pick the backend from the launch context", () => {
  const local = fakeStorage();
  const session = fakeStorage();

  it("standalone context selects localStorage (survives relaunch)", () => {
    expect(
      activeHostStorage(fakeWindow({ displayModeStandalone: true }), {
        local,
        session,
      }),
    ).toBe(local);
  });

  it("legacy iOS standalone context selects localStorage", () => {
    expect(
      activeHostStorage(fakeWindow({ iosStandalone: true }), {
        local,
        session,
      }),
    ).toBe(local);
  });

  it("regular tab context selects sessionStorage (per-tab isolation)", () => {
    expect(activeHostStorage(fakeWindow({}), { local, session })).toBe(session);
  });
});

/** The whole point: in a standalone relaunch — a FRESH (empty) sessionStorage but a
 *  populated localStorage — the active-host pref must boot on the REMEMBERED host, not
 *  silently revert to LOCAL_HOST. This wires the real `persistedPref` over the backend
 *  `activeHostStorage` chooses, exactly as wire.ts does. */
describe("active-host pref survives a standalone relaunch", () => {
  it("standalone boot with empty sessionStorage + remembered localStorage → remembered host", () => {
    // A prior standalone session left the encoded remote host in localStorage; the
    // relaunch handed the window a brand-new, empty sessionStorage.
    const local = fakeStorage({ "kolu-active-host": encodeHostKey(zest) });
    const session = fakeStorage();
    const storage = activeHostStorage(
      fakeWindow({ displayModeStandalone: true }),
      { local, session },
    );

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
    const storage = activeHostStorage(fakeWindow({}), { local, session });

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
